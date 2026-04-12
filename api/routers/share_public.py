"""
Enlaces públicos temporales: ver una recopilación de personas (miniaturas / originales) con token secreto.
Sin autenticación: quien tenga el enlace ve las fotos hasta que caduque.

Seguridad (resumen):
- El token es secreto URL-safe (~43 chars, 32 bytes); no adivinable por fuerza bruta razonable.
- Si exponés el API a Internet (ngrok al 8732, etc.), definí PHOTOS_SHARE_CREATE_SECRET y el mismo valor en
  VITE_PHOTOS_SHARE_CREATE_SECRET para que POST /api/share/create no sea público.
- El manifiesto puede filtrar nombres de archivo (metadatos); SHARE_MANIFEST_REDACT_FILENAMES=1 los omite.
- Quien tiene el enlace puede reenviarlo; TTL acota el riesgo. No hay revocación salvo borrar la fila en BD.
"""
import json
import os
import secrets
from datetime import datetime, timedelta
from io import BytesIO
from pathlib import Path
from typing import Annotated, List, Optional, Set

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from fastapi.responses import FileResponse, Response
from PIL import Image, ImageOps
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from api.deps import get_session
from api.video_stream import stream_video_file
from indexer.db import Cluster, Face, File as FileModel, ShareCollection

# Prefijo /api/share para no chocar con el SPA: GET /{full_path:path} captura /share/… y puede dar 405 en POST /share/create.
router = APIRouter(prefix="/api/share", tags=["share"])

_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
THUMBNAILS_DIR = _PROJECT_ROOT / "data" / "thumbnails"

MAX_PERSONS = 20
MAX_TTL_HOURS = 168
MAX_MANIFEST_FILES = 2500

_SHARE_CREATE_SECRET = os.environ.get("PHOTOS_SHARE_CREATE_SECRET", "").strip()
_REDACT_SHARE_FILENAMES = os.environ.get("SHARE_MANIFEST_REDACT_FILENAMES", "").strip().lower() in (
    "1",
    "true",
    "yes",
)


def _require_share_create_secret(
    x_secret: Annotated[Optional[str], Header(alias="X-Photos-Share-Secret")] = None,
) -> None:
    if not _SHARE_CREATE_SECRET:
        return
    if not x_secret or x_secret != _SHARE_CREATE_SECRET:
        raise HTTPException(status_code=403, detail="Creación de enlaces compartidos no autorizada")


class ShareCreateIn(BaseModel):
    person_ids: List[int] = Field(..., min_length=1, max_length=MAX_PERSONS)
    ttl_hours: int = Field(default=24, ge=1, le=MAX_TTL_HOURS)


class ShareCreateOut(BaseModel):
    token: str
    expires_at: str
    path_prefix: str


def _utcnow() -> datetime:
    return datetime.utcnow()


def _load_share(session: Session, token: str) -> ShareCollection:
    row = session.query(ShareCollection).filter(ShareCollection.token == token).first()
    if not row:
        raise HTTPException(status_code=404, detail="Enlace no válido")
    if row.expires_at <= _utcnow():
        raise HTTPException(status_code=410, detail="Enlace caducado")
    return row


def _person_ids_from_row(row: ShareCollection) -> List[int]:
    try:
        return [int(x) for x in json.loads(row.person_ids_json)]
    except (json.JSONDecodeError, TypeError, ValueError):
        return []


def _allowed_file_ids(session: Session, person_ids: List[int]) -> Set[int]:
    if not person_ids:
        return set()
    q = (
        session.query(FileModel.id)
        .join(Face, Face.file_id == FileModel.id)
        .filter(
            Face.cluster_id.in_(person_ids),
            FileModel.archived == 0,
        )
        .distinct()
    )
    return {r[0] for r in q.all()}


@router.post("/create", response_model=ShareCreateOut)
def create_share_collection(
    body: ShareCreateIn,
    _: Annotated[None, Depends(_require_share_create_secret)],
    session: Session = Depends(get_session),
):
    """Genera token y caducidad. La UI abre /share/<token> (misma base que el API en producción)."""
    pids = list(dict.fromkeys(body.person_ids))
    for pid in pids:
        c = session.get(Cluster, pid)
        if not c:
            raise HTTPException(status_code=400, detail=f"Persona {pid} no existe")
    token = secrets.token_urlsafe(32)
    expires_at = _utcnow() + timedelta(hours=body.ttl_hours)
    row = ShareCollection(
        token=token,
        person_ids_json=json.dumps(pids),
        expires_at=expires_at,
        created_at=_utcnow(),
    )
    session.add(row)
    session.commit()
    return ShareCreateOut(
        token=token,
        expires_at=expires_at.isoformat() + "Z",
        path_prefix=f"/api/share/{token}",
    )


@router.get("/{token}/manifest")
def share_manifest(token: str, session: Session = Depends(get_session)):
    row = _load_share(session, token)
    pids = _person_ids_from_row(row)
    persons_out = []
    for pid in pids:
        c = session.get(Cluster, pid)
        if c:
            persons_out.append({
                "id": c.id,
                "label": c.label,
                "size": c.size,
            })
    q = (
        session.query(FileModel)
        .join(Face, Face.file_id == FileModel.id)
        .filter(Face.cluster_id.in_(pids), FileModel.archived == 0)
        .distinct()
        .order_by(FileModel.exif_date.desc().nulls_last(), FileModel.id.asc())
    )
    rows = q.limit(MAX_MANIFEST_FILES + 1).all()
    truncated = len(rows) > MAX_MANIFEST_FILES
    if truncated:
        rows = rows[:MAX_MANIFEST_FILES]
    items = []
    for f in rows:
        items.append({
            "file_id": f.id,
            "file_type": f.file_type,
            "name": "" if _REDACT_SHARE_FILENAMES else Path(f.path).name,
            "thumb_path": f"/api/share/{token}/thumb/{f.id}",
            "original_path": f"/api/share/{token}/original/{f.id}",
        })
    return {
        "expires_at": row.expires_at.isoformat() + "Z" if row.expires_at else None,
        "persons": persons_out,
        "items": items,
        "truncated": truncated,
        "max_files": MAX_MANIFEST_FILES,
    }


def _validate_file_in_share(session: Session, row: ShareCollection, file_id: int) -> FileModel:
    pids = _person_ids_from_row(row)
    allowed = _allowed_file_ids(session, pids)
    if file_id not in allowed:
        raise HTTPException(status_code=404, detail="Archivo no incluido en esta colección")
    f = session.get(FileModel, file_id)
    if not f or not Path(f.path).exists():
        raise HTTPException(status_code=404, detail="Archivo no encontrado")
    return f


@router.get("/{token}/thumb/{file_id}")
def share_thumb(token: str, file_id: int, session: Session = Depends(get_session)):
    row = _load_share(session, token)
    f = _validate_file_in_share(session, row, file_id)
    if f.thumbnail_path:
        name = Path(f.thumbnail_path).name
        tp = THUMBNAILS_DIR / name
        if tp.is_file():
            return FileResponse(
                str(tp),
                media_type="image/jpeg",
                headers={"Cache-Control": "private, max-age=3600"},
            )
    if f.file_type != "photo":
        raise HTTPException(status_code=404, detail="Sin miniatura")
    fpath = Path(f.path)
    try:
        img = Image.open(str(fpath))
        img.load()
        img = ImageOps.exif_transpose(img)
        if img.mode not in ("RGB", "L"):
            img = img.convert("RGB")
        img.thumbnail((480, 480))
        buf = BytesIO()
        img.save(buf, format="JPEG", quality=82)
        return Response(
            content=buf.getvalue(),
            media_type="image/jpeg",
            headers={"Cache-Control": "private, max-age=3600"},
        )
    except Exception:
        raise HTTPException(status_code=422, detail="No se pudo generar miniatura")


@router.get("/{token}/original/{file_id}")
def share_original(token: str, file_id: int, request: Request, session: Session = Depends(get_session)):
    row = _load_share(session, token)
    f = _validate_file_in_share(session, row, file_id)
    fpath = Path(f.path)
    suffix = fpath.suffix.lower()
    if suffix in {".mp4", ".mov", ".mkv", ".avi", ".m4v", ".3gp", ".wmv", ".webm"}:
        return stream_video_file(fpath, request)
    if f.file_type != "photo":
        return FileResponse(
            str(fpath),
            filename=fpath.name,
            headers={"Cache-Control": "private, max-age=300"},
        )
    try:
        img = Image.open(str(fpath))
        img.load()
        img = ImageOps.exif_transpose(img)
        if img.mode not in ("RGB", "L"):
            img = img.convert("RGB")
        buf = BytesIO()
        img.save(buf, format="JPEG", quality=90)
        return Response(
            content=buf.getvalue(),
            media_type="image/jpeg",
            headers={"Cache-Control": "private, max-age=300"},
        )
    except Exception:
        return FileResponse(
            str(fpath),
            filename=fpath.name,
            headers={"Cache-Control": "private, max-age=300"},
        )
