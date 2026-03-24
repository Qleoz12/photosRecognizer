"""
Obtiene o calcula embeddings CLIP por archivo. Persiste en file_clip_embeddings
para reutilizar en todos los álbums y no reprocesar.
"""
from pathlib import Path

import numpy as np

from indexer.db import FileClipEmbedding, bytes_to_embedding, embedding_to_bytes
from indexer.region_embedder import embed_full_image


def get_or_compute_file_embedding(session, file_id: int, file_path: Path) -> np.ndarray | None:
    """
    Obtiene el embedding CLIP del archivo. Si ya existe en file_clip_embeddings, lo devuelve.
    Si no, lo calcula, lo persiste y lo devuelve.
    """
    row = session.get(FileClipEmbedding, file_id)
    if row:
        return bytes_to_embedding(row.embedding)

    emb = embed_full_image(file_path)
    if emb is None:
        return None

    session.add(FileClipEmbedding(file_id=file_id, embedding=embedding_to_bytes(emb)))
    session.flush()  # para que el commit posterior incluya esto
    return emb
