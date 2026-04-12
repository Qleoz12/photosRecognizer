"""
CRUD operations for storing and retrieving embeddings, files, and faces from SQLite.
"""
import json
import os
import struct
import threading
import time
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import numpy as np
from sqlalchemy import text
from sqlalchemy.orm import Session

from .db import File, Face, Cluster, embedding_to_bytes, bytes_to_embedding

_centroid_lock = threading.RLock()
_centroid_cache: Optional[Dict[int, np.ndarray]] = None
_centroid_cache_token: Optional[tuple] = None
_centroid_cache_mono: float = 0.0


def _centroid_cache_ttl_sec() -> float:
    try:
        return max(30.0, float(os.environ.get("CLUSTER_CENTROID_CACHE_TTL_SEC", "300")))
    except ValueError:
        return 300.0


def invalidate_cluster_centroids_cache() -> None:
    """Invalidar cache en memoria de centroides (tras mutar caras/clusters o re-cluster)."""
    global _centroid_cache, _centroid_cache_token, _centroid_cache_mono
    with _centroid_lock:
        _centroid_cache = None
        _centroid_cache_token = None
        _centroid_cache_mono = 0.0


def _centroid_cache_fingerprint(session: Session) -> tuple:
    """Huella ligera para detectar cambios de cardinalidad (indexación, merges, etc.)."""
    row = session.execute(
        text(
            """
            SELECT
                (SELECT COUNT(*) FROM faces WHERE cluster_id IS NOT NULL AND is_canonical = 1),
                (SELECT COALESCE(MAX(id), 0) FROM faces),
                (SELECT COUNT(*) FROM clusters)
            """
        )
    ).one()
    return (int(row[0]), int(row[1]), int(row[2]))


def upsert_file(
    session: Session,
    path: str,
    file_hash: str,
    mtime: float,
    file_type: str,
    exif_date: Optional[datetime] = None,
    exif_lat: Optional[float] = None,
    exif_lon: Optional[float] = None,
    thumbnail_path: Optional[str] = None,
    width: Optional[int] = None,
    height: Optional[int] = None,
    duration: Optional[float] = None,
    content_hash: Optional[str] = None,
) -> File:
    """Insert or update a file record. Returns the File ORM object."""
    existing = session.query(File).filter_by(path=path).first()
    if existing:
        existing.file_hash = file_hash
        existing.mtime = mtime
        existing.file_type = file_type
        existing.exif_date = exif_date
        existing.exif_lat = exif_lat
        existing.exif_lon = exif_lon
        existing.thumbnail_path = thumbnail_path
        existing.width = width
        existing.height = height
        if duration is not None:
            existing.duration = duration
        if content_hash is not None:
            existing.content_hash = content_hash
        session.flush()
        return existing

    file_obj = File(
        path=path,
        file_hash=file_hash,
        content_hash=content_hash,
        mtime=mtime,
        file_type=file_type,
        exif_date=exif_date,
        exif_lat=exif_lat,
        exif_lon=exif_lon,
        thumbnail_path=thumbnail_path,
        width=width,
        height=height,
        duration=duration,
    )
    session.add(file_obj)
    session.flush()
    return file_obj


def find_by_content_hash(session: Session, content_hash: str, file_type: str) -> Optional[File]:
    """Find file by content_hash and file_type. Used to skip re-processing when file was moved."""
    return session.query(File).filter(
        File.content_hash == content_hash,
        File.file_type == file_type,
    ).first()


def find_by_file_hash(session: Session, file_hash: str, file_type: str) -> Optional[File]:
    """Find file by file_hash (content-based for small files). Fallback for records without content_hash."""
    return session.query(File).filter(
        File.file_hash == file_hash,
        File.file_type == file_type,
    ).first()


def update_file_path(session: Session, file_id: int, new_path: str, new_mtime: float):
    """Update path and mtime for a moved file. Keeps faces, thumbnails, etc."""
    session.query(File).filter_by(id=file_id).update({
        "path": new_path,
        "mtime": new_mtime,
    })
    session.flush()


def add_face(
    session: Session,
    file_id: int,
    bbox: List[float],
    embedding: np.ndarray,
    det_score: float,
) -> Face:
    """Insert a face record."""
    face = Face(
        file_id=file_id,
        bbox_json=json.dumps(bbox),
        embedding=embedding_to_bytes(embedding),
        det_score=det_score,
        cluster_id=None,
    )
    session.add(face)
    session.flush()
    return face


def delete_faces_for_file(session: Session, file_id: int):
    """Remove all face records for a file (used on re-index)."""
    session.query(Face).filter_by(file_id=file_id).delete()
    session.flush()


def get_all_embeddings(session: Session) -> Tuple[List[int], np.ndarray]:
    """
    Load all face embeddings from DB.
    Returns (face_ids list, embeddings array of shape [N, 512]).
    """
    rows = session.query(Face.id, Face.embedding).all()
    if not rows:
        return [], np.empty((0, 512), dtype=np.float32)

    face_ids = [r.id for r in rows]
    embeddings = np.stack([bytes_to_embedding(r.embedding) for r in rows])
    return face_ids, embeddings


def _compute_cluster_centroids_uncached(session: Session) -> Dict[int, np.ndarray]:
    rows = session.query(Face.cluster_id, Face.embedding).filter(
        Face.cluster_id.isnot(None),
        Face.is_canonical == 1,
    ).all()

    by_cluster: dict[int, list] = {}
    for cid, emb_bytes in rows:
        if cid is None:
            continue
        emb = bytes_to_embedding(emb_bytes)
        by_cluster.setdefault(cid, []).append(emb)

    centroids: Dict[int, np.ndarray] = {}
    for cid, embs in by_cluster.items():
        stack = np.stack(embs)
        centroids[cid] = stack.mean(axis=0).astype(np.float32)
    return centroids


def get_cluster_centroids(session: Session) -> Dict[int, np.ndarray]:
    """
    Centroides por cluster (caras canónicas). Resultado cacheado en proceso con TTL
    (CLUSTER_CENTROID_CACHE_TTL_SEC, default 300). Tras mutaciones, llamar
    invalidate_cluster_centroids_cache().
    """
    global _centroid_cache, _centroid_cache_token, _centroid_cache_mono
    token = _centroid_cache_fingerprint(session)
    now = time.monotonic()
    ttl = _centroid_cache_ttl_sec()
    with _centroid_lock:
        if (
            _centroid_cache is not None
            and _centroid_cache_token == token
            and (now - _centroid_cache_mono) < ttl
        ):
            return {k: v.copy() for k, v in _centroid_cache.items()}
    data = _compute_cluster_centroids_uncached(session)
    with _centroid_lock:
        _centroid_cache = {k: v.copy() for k, v in data.items()}
        _centroid_cache_token = token
        _centroid_cache_mono = time.monotonic()
    return {k: v.copy() for k, v in data.items()}


def update_face_cluster(session: Session, face_id: int, cluster_id: Optional[int]):
    session.query(Face).filter_by(id=face_id).update({"cluster_id": cluster_id})


def create_or_update_cluster(
    session: Session,
    cluster_id: int,
    size: int,
    label: Optional[str] = None,
    cover_face_id: Optional[int] = None,
) -> Cluster:
    existing = session.query(Cluster).filter_by(id=cluster_id).first()
    if existing:
        existing.size = size
        if label is not None:
            existing.label = label
        if cover_face_id is not None:
            existing.cover_face_id = cover_face_id
        session.flush()
        return existing

    cluster = Cluster(id=cluster_id, size=size, label=label, cover_face_id=cover_face_id)
    session.add(cluster)
    session.flush()
    return cluster


def clear_all_clusters(session: Session):
    """Remove all cluster assignments before re-clustering."""
    session.query(Face).update({"cluster_id": None})
    session.query(Cluster).delete()
    session.flush()
