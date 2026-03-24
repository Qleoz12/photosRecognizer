"""
Cluster all face embeddings using HDBSCAN (preferred) or DBSCAN.
Assigns cluster_id to every face in the database.
Manual clusters (created via merge/rename in UI) are preserved and never overwritten.

Usage:
    python -m clustering.cluster_faces
    python -m clustering.cluster_faces --algorithm dbscan --eps 0.6
"""
import argparse
import sys
from datetime import datetime
from typing import List


def _log(msg: str, file=sys.stdout) -> None:
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    print(f"[{ts}] {msg}", file=file, flush=True)

import numpy as np
from sqlalchemy.orm import Session

from indexer.db import get_engine, Face, Cluster, File
from indexer.embeddings_store import (
    update_face_cluster,
    create_or_update_cluster,
)


def cluster_faces(algorithm: str = "hdbscan", eps: float = 0.6, min_samples: int = 2):
    engine = get_engine()

    with Session(engine) as session:
        # Load manual clusters — faces in these are left untouched
        manual_cluster_ids = {
            c.id for c in session.query(Cluster).filter(Cluster.is_manual == 1).all()
        }
        if manual_cluster_ids:
            _log(f"Preserving {len(manual_cluster_ids)} manual cluster(s) from UI merges/renames.")

        # Only auto-cluster faces NOT already in a manual cluster
        all_faces = session.query(Face).all()
        free_faces = [f for f in all_faces if f.cluster_id not in manual_cluster_ids]
        manual_face_ids = {f.id for f in all_faces if f.cluster_id in manual_cluster_ids}

        face_ids = [f.id for f in free_faces]
        embeddings_list = []
        from indexer.db import bytes_to_embedding
        for f in free_faces:
            embeddings_list.append(bytes_to_embedding(f.embedding))

        det_scores = {f.id: (f.det_score or 0.0) for f in free_faces}

        # Also clear stale auto clusters (not manual) before reassigning
        auto_cluster_ids = {
            c.id for c in session.query(Cluster).filter(Cluster.is_manual == 0).all()
        }
        # Reset free faces cluster assignment
        for fid in face_ids:
            update_face_cluster(session, fid, None)
        # Delete stale auto clusters
        session.query(Cluster).filter(
            Cluster.is_manual == 0
        ).delete(synchronize_session=False)
        session.flush()

    if not face_ids:
        _log("No free faces to cluster (all are in manual clusters).")
        return

    embeddings = np.stack(embeddings_list)
    _log(f"Clustering {len(face_ids)} face embeddings with {algorithm.upper()}...")

    labels = _run_clustering(embeddings, algorithm, eps, min_samples)

    noise_count = int((labels == -1).sum())
    cluster_count = len(set(labels) - {-1})
    _log(f"Found {cluster_count} clusters, {noise_count} noise faces.")

    # Promote high-quality lone faces to solo clusters
    labels = labels.copy()
    next_id = cluster_count
    for i, (face_id, label) in enumerate(zip(face_ids, labels)):
        if label == -1 and det_scores.get(face_id, 0.0) >= 0.7:
            labels[i] = next_id
            next_id += 1

    kept_noise = int((labels == -1).sum())
    solo = next_id - cluster_count
    if solo:
        _log(f"Added {solo} solo clusters for high-quality lone faces. {kept_noise} low-quality faces remain as noise.")

    # Offset auto cluster IDs to avoid collisions with any existing manual IDs
    with Session(engine) as session:
        # Find the max existing cluster id to avoid collisions
        max_existing = session.query(Cluster.id).order_by(Cluster.id.desc()).first()
        id_offset = (max_existing[0] + 1) if max_existing else 0

        cluster_sizes: dict[int, List[int]] = {}
        for face_id, label in zip(face_ids, labels):
            if label == -1:
                update_face_cluster(session, face_id, None)
            else:
                real_id = int(label) + id_offset
                update_face_cluster(session, face_id, real_id)
                cluster_sizes.setdefault(real_id, []).append(face_id)

        for cluster_id, fids in cluster_sizes.items():
            # Prefer photo faces over video faces for cover (better crop support)
            def _is_photo(fid):
                face = session.get(Face, fid)
                if not face:
                    return False
                f = session.get(File, face.file_id)
                return f and f.file_type == "photo"

            sorted_fids = sorted(fids, key=lambda fid: (0 if _is_photo(fid) else 1))
            cover = sorted_fids[0] if sorted_fids else None
            create_or_update_cluster(
                session,
                cluster_id=cluster_id,
                size=len(fids),
                cover_face_id=cover,
            )

        # Update sizes of manual clusters (faces may have been added by new indexing)
        for cid in manual_cluster_ids:
            c = session.get(Cluster, cid)
            if c:
                c.size = session.query(Face).filter(Face.cluster_id == cid).count()

        session.commit()

    total_auto = len(cluster_sizes)
    _log(f"Clustering saved. Auto groups: {total_auto}, Manual groups preserved: {len(manual_cluster_ids)}")


def _run_clustering(embeddings: np.ndarray, algorithm: str, eps: float, min_samples: int) -> np.ndarray:
    norms = np.linalg.norm(embeddings, axis=1, keepdims=True)
    norms = np.where(norms == 0, 1, norms)
    normed = embeddings / norms

    if algorithm == "hdbscan":
        try:
            import hdbscan
            clusterer = hdbscan.HDBSCAN(
                min_cluster_size=2,
                min_samples=1,
                metric="euclidean",
                cluster_selection_epsilon=eps,
            )
            return clusterer.fit_predict(normed)
        except ImportError:
            _log("hdbscan not available, falling back to DBSCAN.", file=sys.stderr)

    from sklearn.cluster import DBSCAN
    clusterer = DBSCAN(eps=eps, min_samples=min_samples, metric="cosine", n_jobs=-1)
    return clusterer.fit_predict(normed)


def main():
    parser = argparse.ArgumentParser(description="Cluster face embeddings")
    parser.add_argument("--algorithm", choices=["hdbscan", "dbscan"], default="hdbscan")
    parser.add_argument("--eps", type=float, default=0.6,
                        help="Cluster selection epsilon — higher = more faces grouped together")
    parser.add_argument("--min-samples", type=int, default=2)
    args = parser.parse_args()
    cluster_faces(args.algorithm, args.eps, args.min_samples)


if __name__ == "__main__":
    main()
