"""
CRUD operations for storing and retrieving embeddings, files, and faces from SQLite.
"""
import json
import struct
from datetime import datetime
from pathlib import Path
from typing import List, Optional, Tuple

import numpy as np
from sqlalchemy.orm import Session

from .db import File, Face, Cluster, embedding_to_bytes, bytes_to_embedding


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
        session.flush()
        return existing

    file_obj = File(
        path=path,
        file_hash=file_hash,
        mtime=mtime,
        file_type=file_type,
        exif_date=exif_date,
        exif_lat=exif_lat,
        exif_lon=exif_lon,
        thumbnail_path=thumbnail_path,
        width=width,
        height=height,
    )
    session.add(file_obj)
    session.flush()
    return file_obj


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


def get_cluster_centroids(session: Session) -> dict[int, np.ndarray]:
    """
    Compute centroid (mean embedding) per cluster.
    Returns {cluster_id: embedding_512}.
    Only uses canonical faces (is_canonical=1) for the centroid.
    """
    from .db import bytes_to_embedding

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

    centroids = {}
    for cid, embs in by_cluster.items():
        stack = np.stack(embs)
        centroids[cid] = stack.mean(axis=0).astype(np.float32)
    return centroids


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
