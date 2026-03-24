"""
/photos  — file-centric endpoints
"""
import json
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, joinedload

from api.deps import get_session
from api.models import FileOut, FaceOut, FileUpdateIn
from indexer.db import File, Face

router = APIRouter(prefix="/photos", tags=["photos"])


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
    )


@router.get("/", response_model=List[FileOut])
def list_photos(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    file_type: Optional[str] = Query(None, pattern="^(photo|video)$"),
    date_from: Optional[datetime] = None,
    date_to: Optional[datetime] = None,
    session: Session = Depends(get_session),
):
    q = session.query(File).options(joinedload(File.faces))
    if file_type:
        q = q.filter(File.file_type == file_type)
    if date_from:
        q = q.filter(File.exif_date >= date_from)
    if date_to:
        q = q.filter(File.exif_date <= date_to)
    q = q.order_by(File.exif_date.desc().nullsfirst(), File.mtime.desc().nullslast())
    files = q.offset(skip).limit(limit).all()
    return [_file_to_out(f) for f in files]


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


@router.get("/{photo_id}", response_model=FileOut)
def get_photo(photo_id: int, session: Session = Depends(get_session)):
    f = session.get(File, photo_id)
    if not f:
        raise HTTPException(404, "Photo not found")
    return _file_to_out(f)


@router.patch("/{photo_id}", response_model=FileOut)
def update_photo(
    photo_id: int,
    body: FileUpdateIn,
    session: Session = Depends(get_session),
):
    """Update photo metadata (e.g. set date manually when EXIF is missing)."""
    f = session.get(File, photo_id)
    if not f:
        raise HTTPException(404, "Photo not found")
    if body.exif_date is not None:
        f.exif_date = body.exif_date
    session.commit()
    session.refresh(f)
    return _file_to_out(f)


@router.get("/{photo_id}/date-metadata")
def get_photo_date_metadata(photo_id: int, session: Session = Depends(get_session)):
    """
    Return all available date metadata for a photo: file system dates + EXIF dates.
    Use "Usar esta fecha" buttons to set the photo date from any of these.
    """
    from pathlib import Path
    from indexer.exif_reader import extract_all_exif_dates

    f = session.get(File, photo_id)
    if not f or not Path(f.path).exists():
        raise HTTPException(404, "Photo not found")

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


@router.get("/stats/summary")
def get_stats(session: Session = Depends(get_session)):
    total_files = session.query(File).count()
    total_photos = session.query(File).filter_by(file_type="photo").count()
    total_videos = session.query(File).filter_by(file_type="video").count()
    total_faces = session.query(Face).count()
    unassigned_faces = session.query(Face).filter(Face.cluster_id.is_(None)).count()
    return {
        "total_files": total_files,
        "total_photos": total_photos,
        "total_videos": total_videos,
        "total_faces": total_faces,
        "unassigned_faces": unassigned_faces,
    }
