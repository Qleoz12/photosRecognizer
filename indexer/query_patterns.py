"""
Patrones de eager-load para no leer columnas pesadas (p. ej. embeddings) en listados.
"""
from sqlalchemy.orm import joinedload, load_only

from indexer.db import Cluster, Face, File


def eager_load_file_faces_metadata():
    """File.faces con metadatos para API; omite Face.embedding (LargeBinary)."""
    return joinedload(File.faces).load_only(
        Face.id,
        Face.file_id,
        Face.bbox_json,
        Face.det_score,
        Face.cluster_id,
        Face.is_canonical,
    )


def eager_load_cluster_cover_thumbnail():
    """Cluster → cover_face → file.thumbnail_path sin cargar embeddings."""
    return (
        joinedload(Cluster.cover_face)
        .load_only(Face.id, Face.file_id)
        .joinedload(Face.file)
        .load_only(File.id, File.thumbnail_path)
    )
