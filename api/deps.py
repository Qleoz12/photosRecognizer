"""
Shared FastAPI dependencies: DB session factory.
"""
from sqlalchemy.orm import Session
from indexer.db import get_engine

_engine = None


def get_engine_cached():
    global _engine
    if _engine is None:
        _engine = get_engine()
    return _engine


def get_session():
    with Session(get_engine_cached()) as session:
        yield session
