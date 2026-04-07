"""
Shared FastAPI dependencies: DB session factory.
"""
import os

from sqlalchemy.orm import Session
from indexer.db import get_engine

_engine = None

# read = pool de lectura (SQLite mode=ro). Sin definir = instancia única lectura+escritura (desarrollo o sin gateway).
_API_MODE = os.environ.get("PHOTOS_API_MODE", "").strip().lower()


def get_engine_cached():
    global _engine
    if _engine is None:
        _engine = get_engine(read_only=(_API_MODE == "read"))
    return _engine


def get_session():
    with Session(get_engine_cached()) as session:
        yield session
