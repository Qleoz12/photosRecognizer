"""
Database models and initialization.
Tables: files, faces, clusters
"""
import sqlite3
import struct
from pathlib import Path
from datetime import datetime as dt
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
    content_hash = Column(String(80), nullable=True, index=True)  # survives move; used for skip-when-moved
    mtime = Column(Float, nullable=False)
    file_type = Column(String(10), nullable=False)  # 'photo' | 'video'
    exif_date = Column(DateTime, nullable=True)
    exif_lat = Column(Float, nullable=True)
    exif_lon = Column(Float, nullable=True)
    thumbnail_path = Column(Text, nullable=True)
    width = Column(Integer, nullable=True)
    height = Column(Integer, nullable=True)
    duration = Column(Float, nullable=True)  # seconds, for videos
    # 1 = archivada (oculta en galería principal; ver / desarchivar con PIN)
    archived = Column(Integer, nullable=False, default=0)

    faces = relationship("Face", back_populates="file", cascade="all, delete-orphan")


class Cluster(Base):
    __tablename__ = "clusters"

    id = Column(Integer, primary_key=True, autoincrement=True)
    label = Column(String(255), nullable=True)
    cover_face_id = Column(Integer, ForeignKey("faces.id"), nullable=True)
    size = Column(Integer, default=0)
    # 1 = created/merged/renamed manually by user; survives re-clustering
    is_manual = Column(Integer, default=0, nullable=False)
    # 1 = oculto en listado Personas (no se pide en GET /people salvo include_hidden)
    is_hidden = Column(Integer, default=0, nullable=False)

    faces = relationship("Face", back_populates="cluster", foreign_keys="Face.cluster_id")
    cover_face = relationship("Face", foreign_keys=[cover_face_id])


class Memory(Base):
    """Recuerdos: agrupaciones manuales de fotos (sin detección)."""
    __tablename__ = "memories"

    id = Column(Integer, primary_key=True, autoincrement=True)
    label = Column(String(255), nullable=False)
    cluster_id = Column(Integer, ForeignKey("clusters.id"), nullable=True)  # persona asociada opcional
    created_at = Column(DateTime, default=dt.utcnow, nullable=True)


class MemoryFile(Base):
    """N:N recuerdo ↔ archivo."""
    __tablename__ = "memory_files"

    memory_id = Column(Integer, ForeignKey("memories.id"), nullable=False, primary_key=True)
    file_id = Column(Integer, ForeignKey("files.id"), nullable=False, primary_key=True)


class Album(Base):
    """Álbumes: agrupaciones específicas. Tras 10 imgs se usa cluster para encontrar similares."""
    __tablename__ = "albums"

    id = Column(Integer, primary_key=True, autoincrement=True)
    label = Column(String(255), nullable=False)
    created_at = Column(DateTime, default=dt.utcnow, nullable=True)


class AlbumFile(Base):
    """N:N álbum ↔ archivo. sort_order = posición en el álbum (menor = primero)."""
    __tablename__ = "album_files"

    album_id = Column(Integer, ForeignKey("albums.id"), nullable=False, primary_key=True)
    file_id = Column(Integer, ForeignKey("files.id"), nullable=False, primary_key=True)
    sort_order = Column(Integer, nullable=False, default=0)
    use_in_centroid = Column(Integer, nullable=False, default=1)  # 1 = usado para centroide CLIP, 0 = excluida


class FileClipEmbedding(Base):
    """
    Embeddings CLIP por archivo. Se calculan una vez; se reutilizan para todos los álbums.
    Permite recalcular scores al cambiar el centroide sin volver a ejecutar CLIP.
    """
    __tablename__ = "file_clip_embeddings"

    file_id = Column(Integer, ForeignKey("files.id"), nullable=False, primary_key=True)
    embedding = Column(LargeBinary, nullable=False)  # 512 float32
    computed_at = Column(DateTime, default=dt.utcnow, nullable=True)


class AlbumSearchCache(Base):
    """
    Cache de resultados find-similar por álbum (modo CLIP).
    Persiste POSITIVOS (sim >= umbral) y NEGATIVOS (sim < umbral); ninguna foto se reprocesa.
    manual_status: NULL = usar similarity; 1 = forzar positivo; 0 = forzar negativo.
    """
    __tablename__ = "album_search_cache"

    album_id = Column(Integer, ForeignKey("albums.id"), nullable=False, primary_key=True)
    file_id = Column(Integer, ForeignKey("files.id"), nullable=False, primary_key=True)
    similarity = Column(Float, nullable=False)  # 0.0-1.0; >=0.35 = positivo, <0.35 = negativo
    use_clip = Column(Integer, nullable=False, default=1)
    computed_at = Column(DateTime, default=dt.utcnow, nullable=True)
    manual_status = Column(Integer, nullable=True)  # NULL=auto, 1=positivo, 0=negativo


class MemorySearchCache(Base):
    """Cache de resultados find-similar por recuerdo (modo CLIP)."""
    __tablename__ = "memory_search_cache"

    memory_id = Column(Integer, ForeignKey("memories.id"), nullable=False, primary_key=True)
    file_id = Column(Integer, ForeignKey("files.id"), nullable=False, primary_key=True)
    similarity = Column(Float, nullable=False)
    use_clip = Column(Integer, nullable=False, default=1)
    computed_at = Column(DateTime, default=dt.utcnow, nullable=True)


class ShareCollection(Base):
    """
    Enlace temporal para compartir una recopilación de personas (solo lectura: miniaturas / originales vía token).
    """

    __tablename__ = "share_collections"

    id = Column(Integer, primary_key=True, autoincrement=True)
    token = Column(String(64), unique=True, nullable=False, index=True)
    person_ids_json = Column(Text, nullable=False)  # JSON array de cluster ids
    expires_at = Column(DateTime, nullable=False)
    created_at = Column(DateTime, default=dt.utcnow, nullable=True)


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


def _apply_sqlite_schema_and_migrations(engine) -> None:
    """Crear tablas y migraciones incrementales (solo motor de escritura)."""
    Base.metadata.create_all(engine)

    # Migration: add is_manual column to existing databases
    with engine.connect() as conn:
        cols = [r[1] for r in conn.execute(text("PRAGMA table_info(clusters)")).fetchall()]
        if "is_manual" not in cols:
            conn.execute(text(
                "ALTER TABLE clusters ADD COLUMN is_manual INTEGER NOT NULL DEFAULT 0"
            ))
            conn.commit()

    # Migration: clusters.is_hidden (ocultar del listado principal)
    with engine.connect() as conn:
        cols = [r[1] for r in conn.execute(text("PRAGMA table_info(clusters)")).fetchall()]
        if "is_hidden" not in cols:
            conn.execute(text(
                "ALTER TABLE clusters ADD COLUMN is_hidden INTEGER NOT NULL DEFAULT 0"
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

    # Migration: add duration column to files (for videos)
    with engine.connect() as conn:
        cols = [r[1] for r in conn.execute(text("PRAGMA table_info(files)")).fetchall()]
        if "duration" not in cols:
            conn.execute(text("ALTER TABLE files ADD COLUMN duration REAL"))
            conn.commit()

    # Migration: add content_hash column (for skip-when-moved)
    with engine.connect() as conn:
        cols = [r[1] for r in conn.execute(text("PRAGMA table_info(files)")).fetchall()]
        if "content_hash" not in cols:
            conn.execute(text("ALTER TABLE files ADD COLUMN content_hash VARCHAR(80)"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_files_content_hash ON files (content_hash)"))
            conn.commit()

    # Migration: add index on exif_date for faster list ordering
    with engine.connect() as conn:
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_files_exif_date ON files (exif_date)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_files_mtime ON files (mtime)"))
        conn.commit()

    # Migration: file_clip_embeddings (Base.metadata.create_all does it for new tables)

    # Migration: album_search_cache.manual_status
    with engine.connect() as conn:
        try:
            cols = [r[1] for r in conn.execute(text("PRAGMA table_info(album_search_cache)")).fetchall()]
        except Exception:
            cols = []
        if cols and "manual_status" not in cols:
            conn.execute(text("ALTER TABLE album_search_cache ADD COLUMN manual_status INTEGER"))
            conn.commit()

    # Migration: album_files.use_in_centroid
    with engine.connect() as conn:
        cols = [r[1] for r in conn.execute(text("PRAGMA table_info(album_files)")).fetchall()]
        if "use_in_centroid" not in cols:
            conn.execute(text(
                "ALTER TABLE album_files ADD COLUMN use_in_centroid INTEGER NOT NULL DEFAULT 1"
            ))
            conn.commit()

    # Migration: album_files.sort_order for custom order in álbumes
    with engine.connect() as conn:
        cols = [r[1] for r in conn.execute(text("PRAGMA table_info(album_files)")).fetchall()]
        if "sort_order" not in cols:
            conn.execute(text("ALTER TABLE album_files ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0"))
            conn.commit()
            aids = [r[0] for r in conn.execute(text("SELECT DISTINCT album_id FROM album_files")).fetchall()]
            for aid in aids:
                rows = conn.execute(
                    text("SELECT file_id FROM album_files WHERE album_id = :a ORDER BY file_id"),
                    {"a": aid},
                ).fetchall()
                for i, (fid,) in enumerate(rows):
                    conn.execute(
                        text(
                            "UPDATE album_files SET sort_order = :i WHERE album_id = :a AND file_id = :f"
                        ),
                        {"i": i, "a": aid, "f": fid},
                    )
            conn.commit()

    # Migration: files.archived
    with engine.connect() as conn:
        cols = [r[1] for r in conn.execute(text("PRAGMA table_info(files)")).fetchall()]
        if cols and "archived" not in cols:
            conn.execute(text("ALTER TABLE files ADD COLUMN archived INTEGER NOT NULL DEFAULT 0"))
            conn.commit()


def get_engine(db_path: Path = DB_PATH, read_only: bool = False):
    """
    Motor SQLite. Con read_only=True abre la BD en modo solo lectura (URI ?mode=ro), sin migraciones.
    Usado por workers del API cuando PHOTOS_API_MODE=read.
    """
    resolved = db_path.resolve()
    if read_only:
        if not resolved.is_file():
            raise FileNotFoundError(f"SQLite DB no encontrada (modo lectura): {resolved}")
        uri = resolved.as_uri() + "?mode=ro"

        def _connect_ro():
            return sqlite3.connect(uri, uri=True, timeout=60, check_same_thread=False)

        return create_engine("sqlite://", creator=_connect_ro, echo=False)

    resolved.parent.mkdir(parents=True, exist_ok=True)
    engine = create_engine(
        f"sqlite:///{resolved.as_posix()}",
        echo=False,
        connect_args={"check_same_thread": False, "timeout": 60},
    )

    @event.listens_for(engine, "connect")
    def set_wal(dbapi_conn, _):
        cursor = dbapi_conn.cursor()
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA synchronous=NORMAL")
        cursor.execute("PRAGMA busy_timeout=60000")
        cursor.close()

    _apply_sqlite_schema_and_migrations(engine)
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
