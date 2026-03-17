"""
HNSW-based fast approximate nearest-neighbor search over face embeddings.
Builds an in-memory hnswlib index for sub-millisecond kNN queries.

Falls back to brute-force cosine if hnswlib is not installed.
"""
from __future__ import annotations

import numpy as np
from typing import List, Tuple

_DIM = 512


def build_index(embeddings: np.ndarray, ids: List[int]) -> "_HNSWIndex | _BruteForceIndex":
    """Build and return an index from the given (N, 512) embedding matrix."""
    try:
        return _HNSWIndex(embeddings, ids)
    except ImportError:
        return _BruteForceIndex(embeddings, ids)


class _HNSWIndex:
    def __init__(self, embeddings: np.ndarray, ids: List[int]):
        import hnswlib  # type: ignore

        n = len(ids)
        self._ids = ids
        self._index = hnswlib.Index(space="cosine", dim=_DIM)
        self._index.init_index(max_elements=max(n, 1), ef_construction=200, M=16)
        if n > 0:
            self._index.add_items(embeddings.astype(np.float32), list(range(n)))
        self._index.set_ef(50)

    def search(self, query: np.ndarray, top_k: int) -> List[Tuple[int, float]]:
        """Return [(face_id, similarity), ...] sorted by similarity desc."""
        k = min(top_k, len(self._ids))
        if k == 0:
            return []
        labels, distances = self._index.knn_query(
            query.reshape(1, -1).astype(np.float32), k=k
        )
        results = []
        for label, dist in zip(labels[0], distances[0]):
            face_id = self._ids[label]
            # hnswlib cosine distance = 1 - cosine_similarity
            similarity = float(1.0 - dist)
            results.append((face_id, similarity))
        return sorted(results, key=lambda x: x[1], reverse=True)


class _BruteForceIndex:
    def __init__(self, embeddings: np.ndarray, ids: List[int]):
        norms = np.linalg.norm(embeddings, axis=1, keepdims=True)
        norms = np.where(norms == 0, 1, norms)
        self._normed = (embeddings / norms).astype(np.float32)
        self._ids = ids

    def search(self, query: np.ndarray, top_k: int) -> List[Tuple[int, float]]:
        if len(self._ids) == 0:
            return []
        q = query / (np.linalg.norm(query) + 1e-9)
        sims = self._normed @ q.astype(np.float32)
        top = np.argsort(sims)[::-1][:top_k]
        return [(self._ids[i], float(sims[i])) for i in top]
