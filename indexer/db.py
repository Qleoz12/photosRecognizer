"""
Database models and initialization.
Tables: files, faces, clusters
"""
import struct
from pathlib import Path
from sqlalchemy import (
    create_engine, Column, Integer, String, Float, LargeBinary,
    ForeignKey, Text, DateTime, event, text
)
from sqlalchemy.orm import declarative_base, relationship

Base = declarative_base()
DB_PATH = Path(__file__).parent.parent / "data" / "photos.db"


class File(Base):
    __tablename__ = "files"

    id = Column(Integer, primary_key=True, autoincrement=True)
    path = Column(Text, nullable=False, unique=True)
    file_hash = Column(String(64), nullable=False, index=True)
    mtime = Column(Float, nullable=False)
    file_type = Column(String(10), nullable=False)  # 'photo' | 'video'
    exif_date = Column(DateTime, nullable=True)
    exif_lat = Column(Float, nullable=True)
    exif_lon = Column(Float, nullable=True)
    thumbnail_path = Column(Text, nullable=True)
    width = Column(Integer, nullable=True)
    height = Column(Integer, nullable=True)

    faces = relationship("Face", back_populates="file", cascade="all, delete-orphan")


class Cluster(Base):
    __tablename__ = "clusters"

    id = Column(Integer, primary_key=True, autoincrement=True)
    label = Column(String(255), nullable=True)
    cover_face_id = Column(Integer, ForeignKey("faces.id"), nullable=True)
    size = Column(Integer, default=0)
    # 1 = created/merged/renamed manually by user; survives re-clustering
    is_manual = Column(Integer, default=0, nullable=False)

    faces = relationship("Face", back_populates="cluster", foreign_keys="Face.cluster_id")


class Face(Base):
    __tablename__ = "faces"

    id = Column(Integer, primary_key=True, autoincrement=True)
    file_id = Column(Integer, ForeignKey("files.id"), nullable=False, index=True)
    bbox_json = Column(Text, nullable=False)  # JSON [x1,y1,x2,y2]
    embedding = Column(LargeBinary, nullable=False)  # 512 float32 values
    det_score = Column(Float, nullable=True)
    cluster_id = Column(Integer, ForeignKey("clusters.id"), nullable=True, index=True)
    # True = usado para centroide (comparaciones). False = en cluster pero excluido del centroide.
    is_canonical = Column(Integer, default=1, nullable=False)

    file = relationship("File", back_populates="faces")
    cluster = relationship("Cluster", back_populates="faces", foreign_keys=[cluster_id])


def get_engine(db_path: Path = DB_PATH):
    db_path.parent.mkdir(parents=True, exist_ok=True)
    engine = create_engine(
        f"sqlite:///{db_path}",
        echo=False,
        connect_args={"check_same_thread": False, "timeout": 30},
    )

    @event.listens_for(engine, "connect")
    def set_wal(dbapi_conn, _):
        cursor = dbapi_conn.cursor()
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA synchronous=NORMAL")
        cursor.execute("PRAGMA busy_timeout=10000")
        cursor.close()

    Base.metadata.create_all(engine)

    # Migration: add is_manual column to existing databases
    with engine.connect() as conn:
        cols = [r[1] for r in conn.execute(text("PRAGMA table_info(clusters)")).fetchall()]
        if "is_manual" not in cols:
            conn.execute(text(
                "ALTER TABLE clusters ADD COLUMN is_manual INTEGER NOT NULL DEFAULT 0"
            ))
            conn.commit()

    # Migration: add is_canonical column to faces
    with engine.connect() as conn:
        cols = [r[1] for r in conn.execute(text("PRAGMA table_info(faces)")).fetchall()]
        if "is_canonical" not in cols:
            conn.execute(text(
                "ALTER TABLE faces ADD COLUMN is_canonical INTEGER NOT NULL DEFAULT 1"
            ))
            conn.commit()

    return engine


def embedding_to_bytes(embedding) -> bytes:
    """Convert numpy float32 array to bytes."""
    import numpy as np
    arr = np.asarray(embedding, dtype=np.float32)
    return arr.tobytes()


def bytes_to_embedding(data: bytes):
    """Convert bytes back to numpy float32 array."""
    import numpy as np
    return np.frombuffer(data, dtype=np.float32)
