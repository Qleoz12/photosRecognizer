"""
/memories — recuerdos (agrupaciones manuales de fotos).
"""
import logging
import threading
from pathlib import Path
from typing import List, Optional

import numpy as np

log = logging.getLogger("photos_recognizer.api")

_find_similar_locks: dict[int, threading.Lock] = {}
_locks_mutex = threading.Lock()


def _get_memory_lock(memory_id: int) -> threading.Lock:
    with _locks_mutex:
        if memory_id not in _find_similar_locks:
            _find_similar_locks[memory_id] = threading.Lock()
        return _find_similar_locks[memory_id]
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from api.deps import get_session
from api.models import FileOut
from indexer.db import Face, Memory, MemoryFile, MemorySearchCache, File as FileModel
from indexer.db import bytes_to_embedding
from indexer.region_embedder import embed_full_image

router = APIRouter(prefix="/memories", tags=["memories"])


class MemoryOut(BaseModel):
    id: int
    label: str
    cluster_id: Optional[int]
    file_count: int = 0
    cover_thumbnail: Optional[str] = None

    class Config:
        from_attributes = True


class MemoryCreateIn(BaseModel):
    label: str
    cluster_id: Optional[int] = None


class AddFilesIn(BaseModel):
    file_ids: List[int]


class MemoryRenameIn(BaseModel):
    label: str


class FindSimilarIn(BaseModel):
    file_ids: List[int]
    force_clip: bool = False
    max_new: int = 50  # Máx. fotos nuevas con CLIP por request. 0 = solo cache.


class SimilarResult(BaseModel):
    file_id: int
    similarity: float


class FindSimilarOut(BaseModel):
    use_clip: bool
    sample_count: int
    cached_count: int = 0
    computed_count: int = 0
    results: List[SimilarResult]


@router.get("/", response_model=List[MemoryOut])
def list_memories(session: Session = Depends(get_session)):
    """List all memories."""
    memories = session.query(Memory).order_by(Memory.id.desc()).all()
    out = []
    for m in memories:
        count = session.query(MemoryFile).filter_by(memory_id=m.id).count()
        cover = None
        first = session.query(MemoryFile).filter_by(memory_id=m.id).first()
        if first:
            f = session.get(FileModel, first.file_id)
            if f:
                cover = f.thumbnail_path
        out.append(MemoryOut(
            id=m.id,
            label=m.label,
            cluster_id=m.cluster_id,
            file_count=count,
            cover_thumbnail=cover,
        ))
    return out


@router.post("/", response_model=MemoryOut)
def create_memory(body: MemoryCreateIn, session: Session = Depends(get_session)):
    """Create a new memory."""
    m = Memory(label=body.label, cluster_id=body.cluster_id)
    session.add(m)
    session.commit()
    session.refresh(m)
    return MemoryOut(id=m.id, label=m.label, cluster_id=m.cluster_id, file_count=0)


@router.get("/{memory_id}", response_model=MemoryOut)
def get_memory(memory_id: int, session: Session = Depends(get_session)):
    """Get a memory by ID."""
    m = session.get(Memory, memory_id)
    if not m:
        raise HTTPException(404, "Memory not found")
    count = session.query(MemoryFile).filter_by(memory_id=m.id).count()
    cover = None
    first = session.query(MemoryFile).filter_by(memory_id=m.id).first()
    if first:
        f = session.get(FileModel, first.file_id)
        if f:
            cover = f.thumbnail_path
    return MemoryOut(
        id=m.id,
        label=m.label,
        cluster_id=m.cluster_id,
        file_count=count,
        cover_thumbnail=cover,
    )


@router.patch("/{memory_id}", response_model=MemoryOut)
def rename_memory(
    memory_id: int,
    body: MemoryRenameIn,
    session: Session = Depends(get_session),
):
    """Cambiar el nombre del recuerdo."""
    m = session.get(Memory, memory_id)
    if not m:
        raise HTTPException(404, "Memory not found")
    label = (body.label or "").strip() or "Sin nombre"
    m.label = label
    session.commit()
    session.refresh(m)
    count = session.query(MemoryFile).filter_by(memory_id=memory_id).count()
    cover = None
    first = session.query(MemoryFile).filter_by(memory_id=memory_id).first()
    if first:
        f = session.get(FileModel, first.file_id)
        if f:
            cover = f.thumbnail_path
    return MemoryOut(
        id=m.id,
        label=m.label,
        cluster_id=m.cluster_id,
        file_count=count,
        cover_thumbnail=cover,
    )


@router.post("/{memory_id}/add-files")
def add_files_to_memory(
    memory_id: int,
    body: AddFilesIn,
    session: Session = Depends(get_session),
):
    """Add files to a memory."""
    m = session.get(Memory, memory_id)
    if not m:
        raise HTTPException(404, "Memory not found")
    for fid in body.file_ids:
        f = session.get(FileModel, fid)
        if not f:
            continue
        existing = session.query(MemoryFile).filter_by(
            memory_id=memory_id, file_id=fid
        ).first()
        if not existing:
            session.add(MemoryFile(memory_id=memory_id, file_id=fid))
    session.query(MemorySearchCache).filter_by(memory_id=memory_id).delete()
    session.commit()
    return {"status": "ok"}


@router.delete("/{memory_id}/files/{file_id}")
def remove_file_from_memory(
    memory_id: int,
    file_id: int,
    session: Session = Depends(get_session),
):
    """Remove a file from a memory."""
    mf = session.query(MemoryFile).filter_by(
        memory_id=memory_id, file_id=file_id
    ).first()
    if mf:
        session.delete(mf)
        session.query(MemorySearchCache).filter_by(memory_id=memory_id).delete()
        session.commit()
    return {"status": "ok"}


@router.post("/{memory_id}/find-similar", response_model=FindSimilarOut)
def find_similar_in_page(
    memory_id: int,
    body: FindSimilarIn,
    min_similarity: float = 0.35,
    session: Session = Depends(get_session),
):
    """Fotos similares al recuerdo. Con force_clip=True siempre usa contenido (documentos)."""
    m = session.get(Memory, memory_id)
    if not m:
        raise HTTPException(404, "Memory not found")

    use_clip = bool(body.force_clip)
    lock = _get_memory_lock(memory_id) if use_clip else None
    if lock:
        log.info("[find-similar] memory_id=%s: esperando lock", memory_id)
        lock.acquire()
        log.info("[find-similar] memory_id=%s: lock adquirido", memory_id)

    try:
        return _find_similar_memory_impl(memory_id, body, min_similarity, session)
    finally:
        if lock:
            lock.release()
            log.info("[find-similar] memory_id=%s: lock liberado", memory_id)


def _find_similar_memory_impl(
    memory_id: int, body: FindSimilarIn, min_similarity: float, session: Session
) -> FindSimilarOut:
    mfs = session.query(MemoryFile).filter_by(memory_id=memory_id).all()
    memory_file_ids = [mf.file_id for mf in mfs]
    if not memory_file_ids:
        return FindSimilarOut(use_clip=False, sample_count=0, cached_count=0, computed_count=0, results=[])

    use_clip = bool(body.force_clip)
    memory_embeddings = []

    if not use_clip:
        for fid in memory_file_ids:
            faces = session.query(Face).filter_by(file_id=fid).filter(Face.is_canonical == 1).all()
            for face in faces:
                memory_embeddings.append(bytes_to_embedding(face.embedding))

    if use_clip or not memory_embeddings:
        use_clip = True
        memory_embeddings = []
        for fid in memory_file_ids:
            f = session.get(FileModel, fid)
            if not f or f.file_type != "photo" or not Path(f.path).exists():
                continue
            emb = embed_full_image(Path(f.path))
            if emb is not None:
                memory_embeddings.append(emb)

    if not memory_embeddings:
        return FindSimilarOut(use_clip=use_clip, sample_count=0, cached_count=0, computed_count=0, results=[])

    centroid = np.stack(memory_embeddings).mean(axis=0).astype(np.float32)
    centroid = centroid / (np.linalg.norm(centroid) + 1e-9)

    memory_ids_set = set(memory_file_ids)
    pool_ids = [fid for fid in body.file_ids if fid not in memory_ids_set]
    log.info("[find-similar] memory_id=%s pool=%s modo=%s", memory_id, len(pool_ids), "CLIP" if use_clip else "caras")

    if use_clip:
        cached = {}
        CHUNK = 500
        for i in range(0, len(pool_ids), CHUNK):
            chunk = pool_ids[i : i + CHUNK]
            for row in session.query(MemorySearchCache).filter(
                MemorySearchCache.memory_id == memory_id,
                MemorySearchCache.file_id.in_(chunk),
            ).all():
                cached[row.file_id] = row.similarity
        cached_ids = set(cached.keys())
        uncached_ids = [fid for fid in pool_ids if fid not in cached_ids]
        log.info("[find-similar] memory_id=%s cache=%s pendientes=%s max_new=%s", memory_id, len(cached_ids), len(uncached_ids), body.max_new)

        results = []
        for fid in pool_ids:
            sim = cached.get(fid)
            if sim is not None:
                if sim >= min_similarity:
                    results.append(SimilarResult(file_id=fid, similarity=round(sim, 4)))

        max_new = max(0, body.max_new)
        computed_count = 0
        to_compute = uncached_ids[:max_new] if max_new > 0 else []
        total_to_compute = len(to_compute)
        if total_to_compute > 0:
            log.info("[find-similar] memory_id=%s: procesando CLIP %s/%s fotos", memory_id, total_to_compute, len(uncached_ids))
        for fid in to_compute:
            f = session.get(FileModel, fid)
            if not f or f.file_type != "photo" or not Path(f.path).exists():
                continue
            emb = embed_full_image(Path(f.path))
            if emb is None:
                continue
            emb = emb / (np.linalg.norm(emb) + 1e-9)
            sim = float(np.dot(centroid, emb))
            computed_count += 1
            if computed_count % 10 == 0 or computed_count == total_to_compute:
                log.info("[find-similar] memory_id=%s: procesadas %s/%s", memory_id, computed_count, total_to_compute)
            session.add(MemorySearchCache(memory_id=memory_id, file_id=fid, similarity=sim, use_clip=1))
            if sim >= min_similarity:
                results.append(SimilarResult(file_id=fid, similarity=round(sim, 4)))
        session.commit()
        log.info("[find-similar] memory_id=%s: listo. cache=%s computadas=%s resultados=%s", memory_id, len(cached_ids), computed_count, len(results))

        results.sort(key=lambda x: x.similarity, reverse=True)
        return FindSimilarOut(
            use_clip=True, sample_count=len(memory_embeddings),
            cached_count=len(cached_ids), computed_count=computed_count,
            results=results[:50],
        )

    results = []
    seen = set()
    for fid in pool_ids:
        if fid in seen:
            continue
        f = session.get(FileModel, fid)
        if not f or f.file_type != "photo":
            continue
        best_sim = -1.0
        faces = session.query(Face).filter_by(file_id=fid).all()
        for face in faces:
            emb = bytes_to_embedding(face.embedding)
            emb = emb / (np.linalg.norm(emb) + 1e-9)
            sim = float(np.dot(centroid, emb))
            if sim > best_sim:
                best_sim = sim
        if best_sim >= min_similarity:
            results.append(SimilarResult(file_id=fid, similarity=round(best_sim, 4)))
            seen.add(fid)

    results.sort(key=lambda x: x.similarity, reverse=True)
    return FindSimilarOut(use_clip=False, sample_count=len(memory_embeddings), cached_count=0, computed_count=0, results=results[:50])


@router.get("/{memory_id}/photos", response_model=List[FileOut])
def get_memory_photos(memory_id: int, session: Session = Depends(get_session)):
    """Get all photos in a memory."""
    from indexer.db import File

    m = session.get(Memory, memory_id)
    if not m:
        raise HTTPException(404, "Memory not found")
    mfs = session.query(MemoryFile).filter_by(memory_id=memory_id).all()
    files = []
    for mf in mfs:
        f = session.get(FileModel, mf.file_id)
        if f:
            files.append(FileOut(
                id=f.id,
                path=f.path,
                file_type=f.file_type,
                exif_date=f.exif_date,
                exif_lat=f.exif_lat,
                exif_lon=f.exif_lon,
                thumbnail_path=f.thumbnail_path,
                width=f.width,
                height=f.height,
                duration=getattr(f, "duration", None),
                faces=[],
            ))
    return files
