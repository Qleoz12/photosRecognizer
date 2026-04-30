"""
/photos  — file-centric endpoints
"""
import json
import logging
import urllib.error
import urllib.request
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Path, Query
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from api.archive_pin import archive_pin_configured, archive_pin_matches
from api.deps import get_session
from api.models import ArchiveIdsIn, BulkExifYearIn, FileOut, FaceOut, FileUpdateIn, PinVerifyIn
from indexer.db import File, Face, FileTag, FileClipEmbedding
from indexer.query_patterns import eager_load_file_faces_metadata

router = APIRouter(prefix="/photos", tags=["photos"])
log = logging.getLogger("photos_recognizer.api")


def _file_to_out(f: File) -> FileOut:
    faces_out = [
        FaceOut(
            id=face.id,
            file_id=face.file_id,
            bbox=json.loads(face.bbox_json),
            det_score=face.det_score,
            cluster_id=face.cluster_id,
            is_canonical=bool(getattr(face, "is_canonical", 1)),
        )
        for face in f.faces
    ]
    file_modified = None
    if f.mtime:
        try:
            file_modified = datetime.fromtimestamp(f.mtime, tz=timezone.utc).isoformat()
        except (OSError, ValueError):
            pass
    return FileOut(
        id=f.id,
        path=f.path,
        file_type=f.file_type,
        exif_date=f.exif_date,
        exif_lat=f.exif_lat,
        exif_lon=f.exif_lon,
        file_modified=file_modified,
        thumbnail_path=f.thumbnail_path,
        width=f.width,
        height=f.height,
        duration=getattr(f, "duration", None),
        faces=faces_out,
        archived=bool(getattr(f, "archived", 0)),
        perceptual_hash=getattr(f, "perceptual_hash", None),
    )


def _file_to_out_safe(f: File) -> Optional[FileOut]:
    """No tumba toda la página si un archivo tiene bbox_json u otro dato corrupto."""
    try:
        return _file_to_out(f)
    except Exception as e:
        log.warning("list_photos: omitiendo file_id=%s (%s): %s", f.id, f.path[:80] if f.path else "", e)
        return None


UNDATED_PAGE_MAX = 500  # máx. ítems por petición cuando solo sin EXIF (galería All Photos)


@router.get("/", response_model=List[FileOut])
def list_photos(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    file_type: Optional[str] = Query(None, pattern="^(photo|video)$"),
    date_from: Optional[datetime] = None,
    date_to: Optional[datetime] = None,
    has_exif_date: Optional[bool] = Query(
        None,
        description="true=solo con fecha EXIF; false=solo sin fecha (máx. 10 por página); null=todos",
    ),
    session: Session = Depends(get_session),
):
    q = session.query(File).options(eager_load_file_faces_metadata())
    if file_type:
        q = q.filter(File.file_type == file_type)
    if date_from:
        q = q.filter(File.exif_date >= date_from)
    if date_to:
        q = q.filter(File.exif_date <= date_to)
    q = q.filter(File.archived == 0)

    if has_exif_date is True:
        q = q.filter(File.exif_date.isnot(None))
        q = q.order_by(File.exif_date.desc(), File.mtime.desc().nullslast())
    elif has_exif_date is False:
        q = q.filter(File.exif_date.is_(None))
        q = q.order_by(File.mtime.desc().nullslast(), File.id.desc())
        limit = min(limit, UNDATED_PAGE_MAX)
    else:
        # Sin filtro: fechas reales primero; sin fecha al final del listado paginado
        q = q.order_by(File.exif_date.desc().nullslast(), File.mtime.desc().nullslast())

    files = q.offset(skip).limit(limit).all()
    out: List[FileOut] = []
    for f in files:
        fo = _file_to_out_safe(f)
        if fo is not None:
            out.append(fo)
    return out


@router.get("/file-extensions")
def get_file_extensions(session: Session = Depends(get_session)):
    """
    Lista extensiones de archivo en la biblioteca con un ejemplo por tipo.
    Para probar visualización de cada extensión (.jpg, .png, .heic, etc.).
    """
    rows = session.query(File.id, File.path, File.file_type).all()
    by_ext: dict[str, list[tuple[int, str]]] = defaultdict(list)
    for fid, path, ftype in rows:
        ext = (Path(path).suffix or "").lower() or "(sin extensión)"
        by_ext[ext].append((fid, ftype))
    return [
        {
            "extension": ext,
            "count": len(items),
            "example_file_id": items[0][0],
            "file_type": items[0][1],
        }
        for ext, items in sorted(by_ext.items(), key=lambda x: -len(x[1]))
    ]


@router.get("/stats/summary")
def get_stats(session: Session = Depends(get_session)):
    row = session.execute(
        text(
            """
            SELECT
                (SELECT COUNT(*) FROM files) AS total_files,
                (SELECT COUNT(*) FROM files WHERE archived = 1) AS archived_count,
                (SELECT COUNT(*) FROM files WHERE archived = 0 AND exif_date IS NOT NULL) AS dated_count,
                (SELECT COUNT(*) FROM files WHERE archived = 0 AND exif_date IS NULL) AS undated_count,
                (SELECT COUNT(*) FROM files WHERE file_type = 'photo') AS total_photos,
                (SELECT COUNT(*) FROM files WHERE file_type = 'video') AS total_videos,
                (SELECT COUNT(*) FROM faces) AS total_faces,
                (SELECT COUNT(*) FROM faces WHERE cluster_id IS NULL) AS unassigned_faces,
                (SELECT COUNT(*) FROM clusters c WHERE IFNULL(c.is_hidden, 0) = 1 AND EXISTS (
                    SELECT 1 FROM faces f WHERE f.cluster_id = c.id
                )) AS hidden_people_count
            """
        )
    ).mappings().one()
    return dict(row)


@router.get("/stats/by-year")
def stats_by_year(session: Session = Depends(get_session)):
    """
    Conteos por año (campo exif_date en BD), no archivados.
    Se agrega en Python para evitar fallos de strftime según cómo SQLite guarde datetimes.
    """
    ctr: Counter[str] = Counter()
    q = session.query(File.exif_date).filter(File.archived == 0, File.exif_date.isnot(None))
    for (d,) in q:
        if d is not None:
            ctr[str(d.year)] += 1
    by_year = [{"year": y, "count": n} for y, n in sorted(ctr.items(), key=lambda x: x[0], reverse=True)]
    return {"by_year": by_year}


@router.post("/batch/exif-year")
def batch_set_exif_year(body: BulkExifYearIn, session: Session = Depends(get_session)):
    """Asigna la misma fecha EXIF (1 de julio del año dado, mediodía) a muchos archivos no archivados."""
    if not body.file_ids:
        return {"updated": 0}
    if body.year < 1900 or body.year > 2100:
        raise HTTPException(400, "Año fuera de rango (1900–2100)")
    target = datetime(body.year, 7, 1, 12, 0, 0)
    n = 0
    for fid in body.file_ids:
        f = session.get(File, fid)
        if f and getattr(f, "archived", 0) == 0:
            f.exif_date = target
            n += 1
    session.commit()
    return {"updated": n}


def _deny_if_archived_without_pin(f: File, x_archive_pin: Optional[str]) -> None:
    if getattr(f, "archived", 0) != 1:
        return
    if archive_pin_matches(x_archive_pin):
        return
    raise HTTPException(404, "Photo not found")


@router.get("/archive/status")
def archive_status():
    """Indica si el servidor tiene ARCHIVE_PIN configurado (7 u 8 dígitos)."""
    return {"configured": archive_pin_configured()}


@router.post("/archive/verify")
def verify_archive_pin(body: PinVerifyIn):
    if not archive_pin_configured():
        raise HTTPException(503, "Archivo no configurado (falta ARCHIVE_PIN en el servidor)")
    p = (body.pin or "").strip()
    if len(p) not in (7, 8) or not p.isdigit():
        raise HTTPException(400, "PIN debe ser 7 u 8 dígitos numéricos")
    if not archive_pin_matches(p):
        raise HTTPException(403, "PIN incorrecto")
    return {"ok": True}


@router.get("/archive/list", response_model=List[FileOut])
def list_archived_photos(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    file_type: Optional[str] = Query(None, pattern="^(photo|video)$"),
    session: Session = Depends(get_session),
    x_archive_pin: Optional[str] = Header(None, alias="X-Archive-Pin"),
):
    if not archive_pin_configured():
        raise HTTPException(503, "Archivo no configurado (falta ARCHIVE_PIN en el servidor)")
    if not archive_pin_matches(x_archive_pin):
        raise HTTPException(401, "PIN requerido o incorrecto (cabecera X-Archive-Pin)")

    q = session.query(File).options(eager_load_file_faces_metadata()).filter(File.archived == 1)
    if file_type:
        q = q.filter(File.file_type == file_type)
    q = q.order_by(File.exif_date.desc().nullsfirst(), File.mtime.desc().nullslast())
    files = q.offset(skip).limit(limit).all()
    out: List[FileOut] = []
    for f in files:
        fo = _file_to_out_safe(f)
        if fo is not None:
            out.append(fo)
    return out


@router.post("/archive")
def archive_files(body: ArchiveIdsIn, session: Session = Depends(get_session)):
    if not archive_pin_configured():
        raise HTTPException(503, "Archivo no configurado (falta ARCHIVE_PIN en el servidor)")
    if not body.file_ids:
        return {"archived": 0}

    n = 0
    with session.no_autoflush:
        for fid in body.file_ids:
            f = session.get(File, fid)
            if f:
                f.archived = 1
                n += 1
    session.commit()
    return {"archived": n}


@router.post("/archive/unarchive")
def unarchive_files(
    body: ArchiveIdsIn,
    session: Session = Depends(get_session),
    x_archive_pin: Optional[str] = Header(None, alias="X-Archive-Pin"),
):
    if not archive_pin_configured():
        raise HTTPException(503, "Archivo no configurado (falta ARCHIVE_PIN en el servidor)")
    if not archive_pin_matches(x_archive_pin):
        raise HTTPException(401, "PIN requerido o incorrecto (cabecera X-Archive-Pin)")
    if not body.file_ids:
        return {"restored": 0}

    n = 0
    with session.no_autoflush:
        for fid in body.file_ids:
            f = session.get(File, fid)
            if f and getattr(f, "archived", 0) == 1:
                f.archived = 0
                n += 1
    session.commit()
    return {"restored": n}


@router.get("/ngrok-tunnels")
def ngrok_local_tunnels() -> Dict[str, Any]:
    """
    Reenvía la API local de ngrok (127.0.0.1:4040) para que el navegador no choque con CORS.
    Si ngrok no está en marcha, devuelve tunnels: [].
    """
    try:
        with urllib.request.urlopen("http://127.0.0.1:4040/api/tunnels", timeout=1.5) as resp:
            return json.loads(resp.read().decode())
    except (urllib.error.URLError, TimeoutError, OSError, json.JSONDecodeError) as e:
        log.debug("ngrok local API no disponible: %s", e)
        return {
            "tunnels": [],
            "uri": "/api/tunnels",
            "_photos_recognizer": {"ok": False, "error": str(e)},
        }


class TaxonomyTagOut(BaseModel):
    id: str
    label: str
    prompt: str


class FileWithTagScoreOut(FileOut):
    tag_score: float


@router.get("/taxonomy/tags", response_model=List[TaxonomyTagOut])
def list_taxonomy_tags():
    """Etiquetas fijas disponibles para búsqueda (CLIP taxonomía)."""
    from indexer.taxonomy import TAXONOMY_TAGS

    return [
        TaxonomyTagOut(id=t["id"], label=t["id"].replace("_", " "), prompt=t["prompt"])
        for t in TAXONOMY_TAGS
    ]


@router.get("/search-by-tag", response_model=List[FileOut])
def search_photos_by_tag(
    tag: str = Query(..., min_length=1, max_length=64),
    min_score: float = Query(0.22, ge=0.0, le=1.0),
    taxonomy_version: int = Query(1, ge=1),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    session: Session = Depends(get_session),
):
    """Fotos con la etiqueta dada por encima de min_score (tabla file_tags)."""
    q = (
        session.query(File)
        .join(FileTag, FileTag.file_id == File.id)
        .options(eager_load_file_faces_metadata())
        .filter(FileTag.tag_id == tag)
        .filter(FileTag.taxonomy_version == taxonomy_version)
        .filter(FileTag.score >= min_score)
        .filter(File.archived == 0)
        .filter(File.file_type == "photo")
        .order_by(FileTag.score.desc(), File.id.desc())
        .offset(skip)
        .limit(limit)
    )
    out: List[FileOut] = []
    for f in q.all():
        fo = _file_to_out_safe(f)
        if fo:
            out.append(fo)
    return out


@router.get("/search-by-text", response_model=List[FileWithTagScoreOut])
def search_photos_by_text_clip(
    q: str = Query(..., min_length=1, max_length=500, description="Texto libre (inglés funciona mejor con CLIP)"),
    skip: int = Query(0, ge=0),
    limit: int = Query(40, ge=1, le=200),
    session: Session = Depends(get_session),
):
    """
    Ordena fotos con embedding CLIP por similitud coseno con el texto (sin índice ANN: escaneo en bloque).
    Para bibliotecas muy grandes usar /search-by-tag o precomputar.
    """
    import numpy as np
    from indexer.region_embedder import embed_text_prompts
    from indexer.db import bytes_to_embedding

    text_emb = embed_text_prompts([q.strip()])
    if text_emb.shape[0] == 0:
        return []
    t = text_emb[0].astype(np.float32)
    t = t / (np.linalg.norm(t) + 1e-9)

    rows = (
        session.query(FileClipEmbedding.file_id, FileClipEmbedding.embedding)
        .join(File, FileClipEmbedding.file_id == File.id)
        .filter(File.archived == 0)
        .filter(File.file_type == "photo")
        .all()
    )
    scored: List[tuple[float, int]] = []
    for fid, blob in rows:
        e = bytes_to_embedding(blob).astype(np.float32)
        e = e / (np.linalg.norm(e) + 1e-9)
        scored.append((float(np.dot(t, e)), fid))
    scored.sort(key=lambda x: x[0], reverse=True)
    out: List[FileWithTagScoreOut] = []
    for sim, fid in scored[skip : skip + limit]:
        f = (
            session.query(File)
            .options(eager_load_file_faces_metadata())
            .filter(File.id == fid)
            .one_or_none()
        )
        if not f:
            continue
        fo = _file_to_out_safe(f)
        if fo:
            out.append(FileWithTagScoreOut(**fo.model_dump(), tag_score=round(sim, 4)))
    return out


@router.get("/by-phash/{phash}", response_model=List[FileOut])
def list_photos_by_perceptual_hash(
    phash: str = Path(..., min_length=8, max_length=32),
    session: Session = Depends(get_session),
):
    """Fotos con el mismo hash perceptual (posibles duplicados / misma imagen redimensionada)."""
    q = (
        session.query(File)
        .options(eager_load_file_faces_metadata())
        .filter(File.perceptual_hash == phash)
        .filter(File.archived == 0)
        .filter(File.file_type == "photo")
        .order_by(File.id.asc())
    )
    out: List[FileOut] = []
    for f in q.limit(200).all():
        fo = _file_to_out_safe(f)
        if fo:
            out.append(fo)
    return out


@router.get("/{photo_id}", response_model=FileOut)
def get_photo(
    photo_id: int,
    session: Session = Depends(get_session),
    x_archive_pin: Optional[str] = Header(None, alias="X-Archive-Pin"),
):
    f = (
        session.query(File)
        .options(eager_load_file_faces_metadata())
        .filter(File.id == photo_id)
        .one_or_none()
    )
    if not f:
        raise HTTPException(404, "Photo not found")
    _deny_if_archived_without_pin(f, x_archive_pin)
    try:
        return _file_to_out(f)
    except Exception as e:
        log.warning("get_photo: file_id=%s metadata corrupta: %s", photo_id, e)
        raise HTTPException(500, "Metadatos de archivo corruptos (caras/JSON)") from e


@router.patch("/{photo_id}", response_model=FileOut)
def update_photo(
    photo_id: int,
    body: FileUpdateIn,
    session: Session = Depends(get_session),
    x_archive_pin: Optional[str] = Header(None, alias="X-Archive-Pin"),
):
    """Update photo metadata (e.g. set date manually when EXIF is missing)."""
    f = session.get(File, photo_id)
    if not f:
        raise HTTPException(404, "Photo not found")
    _deny_if_archived_without_pin(f, x_archive_pin)
    if body.exif_date is not None:
        f.exif_date = body.exif_date
    session.commit()
    f = (
        session.query(File)
        .options(eager_load_file_faces_metadata())
        .filter(File.id == photo_id)
        .one_or_none()
    )
    if not f:
        raise HTTPException(404, "Photo not found")
    return _file_to_out(f)


@router.get("/{photo_id}/date-metadata")
def get_photo_date_metadata(
    photo_id: int,
    session: Session = Depends(get_session),
    x_archive_pin: Optional[str] = Header(None, alias="X-Archive-Pin"),
):
    """
    Return all available date metadata for a photo: file system dates + EXIF dates.
    Use "Usar esta fecha" buttons to set the photo date from any of these.
    """
    from pathlib import Path
    from indexer.exif_reader import extract_all_exif_dates

    f = session.get(File, photo_id)
    if not f or not Path(f.path).exists():
        raise HTTPException(404, "Photo not found")
    _deny_if_archived_without_pin(f, x_archive_pin)

    result = {
        "file_modified": None,
        "file_created": None,
        "exif_date": f.exif_date.isoformat() if f.exif_date else None,
        "exif_datetime_original": None,
        "exif_datetime_digitized": None,
        "exif_image_datetime": None,
    }

    try:
        st = Path(f.path).stat()
        result["file_modified"] = datetime.fromtimestamp(st.st_mtime, tz=timezone.utc).isoformat()
        result["file_created"] = datetime.fromtimestamp(st.st_ctime, tz=timezone.utc).isoformat()
    except (OSError, ValueError):
        pass

    if f.file_type == "photo":
        exif_dates = extract_all_exif_dates(Path(f.path))
        key_map = {
            "datetime_original": "exif_datetime_original",
            "datetime_digitized": "exif_datetime_digitized",
            "image_datetime": "exif_image_datetime",
        }
        for k, v in exif_dates.items():
            if v and k in key_map:
                result[key_map[k]] = v.isoformat()

    return result
