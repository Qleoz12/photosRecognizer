"""
Remove orphaned clusters (clusters with 0 faces).
Run after merges or re-clustering if you see "X fotos" but 0 photos displayed.

Usage:
    python -m scripts.cleanup_orphaned_clusters
"""
from sqlalchemy.orm import Session
from indexer.db import get_engine, Cluster, Face

def main():
    engine = get_engine()
    with Session(engine) as session:
        clusters = session.query(Cluster).all()
        deleted = 0
        synced = 0
        for c in clusters:
            actual = session.query(Face).filter(Face.cluster_id == c.id).count()
            if actual == 0:
                session.delete(c)
                deleted += 1
            elif actual != c.size:
                c.size = actual
                synced += 1
        session.commit()
        print(f"Deleted {deleted} orphaned clusters, synced {synced} sizes.")

if __name__ == "__main__":
    main()
