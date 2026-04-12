"""
/albums — álbumes (agrupaciones específicas). Tras 10 imgs usa cluster para similares.
"""
import logging
import threading
from pathlib import Path
from typing import List

import numpy as np

log = logging.getLogger("photos_recognizer.api")

# Un lock por album_id: evita procesar el mismo álbum en paralelo (request 2 espera a request 1).
_find_similar_locks: dict[int, threading.Lock] = {}
_locks_mutex = threading.Lock()


def _get_album_lock(album_id: int) -> threading.Lock:
    with _locks_mutex:
        if album_id not in _find_similar_locks:
            _find_similar_locks[album_id] = threading.Lock()
        return _find_similar_locks[album_id]
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, and_
from sqlalchemy.orm import Session

from api.deps import get_session
from api.models import FileOut
from indexer.db import Album, AlbumFile, AlbumSearchCache, Face, File as FileModel, FileClipEmbedding
from indexer.db import bytes_to_embedding
from indexer.clip_cache import get_or_compute_file_embedding

router = APIRouter(prefix="/albums", tags=["albums"])

# Tope de candidatos en "toda la biblioteca" (evita cargar cientos de miles de ids en RAM y bloquear SQLite).
MAX_POOL_LIBRARY = 12_000


class AlbumOut(BaseModel):
    id: int
    label: str
    file_count: int = 0
    cover_thumbnail: str | None = None

    class Config:
        from_attributes = True


class AlbumCreateIn(BaseModel):
    label: str


class AlbumRenameIn(BaseModel):
    label: str


class AddFilesIn(BaseModel):
    file_ids: List[int]


class FindSimilarIn(BaseModel):
    """File IDs cargados en la página para buscar similares sin reindexar."""
    file_ids: List[int]
    force_clip: bool = False
    max_new: int = Field(default=500, ge=0, le=1000)  # default más bajo; clientes pueden subir hasta 1000
    exclude_faces_from_centroid: bool = False  # Solo fotos sin caras para centroide (documentos puros)


class ReorderAlbumIn(BaseModel):
    """Orden completo de file_ids en el álbum (misma lista, nuevo orden)."""
    file_ids: List[int]


class UseInCentroidIn(BaseModel):
    """Incluir o excluir foto del centroide (como is_canonical en Persona)."""
    use_in_centroid: bool


class CacheStatusIn(BaseModel):
    """Mover foto manualmente a positivas o negativas."""
    status: str  # "positive" | "negative"


class CacheBatchStatusIn(BaseModel):
    """Marcar muchas fotos del cache a la vez (misma operación que PATCH por file_id)."""
    file_ids: List[int]
    status: str  # "positive" | "negative"


def _apply_cache_manual_status_batch(
    album_id: int, body: CacheBatchStatusIn, session: Session
) -> dict:
    """Lógica compartida por POST .../search-cache y POST .../search-cache/batch."""
    if body.status not in ("positive", "negative"):
        raise HTTPException(400, "status debe ser positive o negative")
    ids = [int(x) for x in body.file_ids if x is not None]
    if not ids:
        return {"updated": 0, "file_ids": []}
    if len(ids) > 500:
        raise HTTPException(400, "Máximo 500 file_ids por petición")
    a = session.get(Album, album_id)
    if not a:
        raise HTTPException(404, "Album not found")
    manual = 1 if body.status == "positive" else 0
    updated: List[int] = []
    for fid in ids:
        row = (
            session.query(AlbumSearchCache)
            .filter_by(album_id=album_id, file_id=fid)
            .first()
        )
        if row:
            row.manual_status = manual
            updated.append(fid)
    session.commit()
    return {"updated": len(updated), "file_ids": updated, "status": body.status}


class SimilarResult(BaseModel):
    file_id: int
    similarity: float


class FindSimilarOut(BaseModel):
    use_clip: bool
    sample_count: int
    sample_file_ids: List[int] = []  # file_ids usados para el centroide (como Persona muestra rostros)
    cached_count: int = 0
    computed_count: int = 0
    pool_size: int = 0  # candidatos en este request (excl. álbum)
    uncached_remaining_after: int = 0  # sin CLIP aún en el pool tras este batch
    total_cached_album: int = 0  # filas en album_search_cache (toda la biblioteca ya clasificada p/este álbum)
    results: List[SimilarResult]


def _recalculate_album_cache_scores(album_id: int, session: Session) -> None:
    """
    Al cambiar fotos del álbum: recalcula similarity de todas las filas en cache
    usando embeddings ya guardados (sin CLIP). No borra el cache.
    """
    afs = (
        session.query(AlbumFile)
        .filter_by(album_id=album_id)
        .filter(AlbumFile.use_in_centroid == 1)
        .order_by(AlbumFile.sort_order.asc(), AlbumFile.file_id.asc())
        .all()
    )
    ids_for_centroid = [af.file_id for af in afs]
    if not ids_for_centroid:
        return

    album_embeddings = []
    for fid in ids_for_centroid:
        f = session.get(FileModel, fid)
        if not f or f.file_type != "photo" or not Path(f.path).exists():
            continue
        emb = get_or_compute_file_embedding(session, fid, Path(f.path))
        if emb is not None:
            album_embeddings.append(emb)
    if not album_embeddings:
        return

    centroid = np.stack(album_embeddings).mean(axis=0).astype(np.float32)
    centroid = centroid / (np.linalg.norm(centroid) + 1e-9)

    cache_rows = session.query(AlbumSearchCache).filter(AlbumSearchCache.album_id == album_id).all()
    for row in cache_rows:
        fe = session.get(FileClipEmbedding, row.file_id)
        if fe is None:
            f = session.get(FileModel, row.file_id)
            if f and Path(f.path).exists():
                emb = get_or_compute_file_embedding(session, row.file_id, Path(f.path))
                if emb is not None:
                    emb = emb / (np.linalg.norm(emb) + 1e-9)
                    row.similarity = float(np.dot(centroid, emb))
        else:
            emb = bytes_to_embedding(fe.embedding)
            emb = emb / (np.linalg.norm(emb) + 1e-9)
            row.similarity = float(np.dot(centroid, emb))
    session.commit()
    log.info("[recalculate] album_id=%s: actualizados %s scores desde embeddings", album_id, len(cache_rows))


def _album_to_out(album: Album, session: Session) -> AlbumOut:
    count = session.query(AlbumFile).filter_by(album_id=album.id).count()
    cover = None
    first = (
        session.query(AlbumFile)
        .filter_by(album_id=album.id)
        .order_by(AlbumFile.sort_order.asc(), AlbumFile.file_id.asc())
        .first()
    )
    if first:
        f = session.get(FileModel, first.file_id)
        if f:
            cover = f.thumbnail_path
    return AlbumOut(id=album.id, label=album.label, file_count=count, cover_thumbnail=cover)


@router.get("/", response_model=List[AlbumOut])
def list_albums(session: Session = Depends(get_session)):
    """List all albums."""
    albums = session.query(Album).order_by(Album.id.desc()).all()
    return [_album_to_out(a, session) for a in albums]


@router.post("/", response_model=AlbumOut)
def create_album(body: AlbumCreateIn, session: Session = Depends(get_session)):
    """Create a new album."""
    a = Album(label=body.label)
    session.add(a)
    session.commit()
    session.refresh(a)
    return AlbumOut(id=a.id, label=a.label, file_count=0)


@router.get("/{album_id}", response_model=AlbumOut)
def get_album(album_id: int, session: Session = Depends(get_session)):
    """Get an album by ID."""
    a = session.get(Album, album_id)
    if not a:
        raise HTTPException(404, "Album not found")
    return _album_to_out(a, session)


def _is_positive(row: AlbumSearchCache) -> bool:
    """Positivo si manual_status=1 o (manual_status IS NULL y similarity>=0.35)."""
    if getattr(row, "manual_status", None) is not None:
        return row.manual_status == 1
    return row.similarity >= 0.35


@router.get("/{album_id}/search-cache-stats")
def get_album_search_cache_stats(album_id: int, session: Session = Depends(get_session)):
    """
    Estadísticas del cache find-similar: total fotos en biblioteca, ya chequeadas por álbum,
    positivas y negativas (considera manual_status si está definido).
    """
    a = session.get(Album, album_id)
    if not a:
        raise HTTPException(404, "Album not found")
    total_photos = session.query(FileModel).filter(FileModel.file_type == "photo").count()
    rows = session.query(AlbumSearchCache).filter(AlbumSearchCache.album_id == album_id).all()
    cached_count = len(rows)
    positive_count = sum(1 for r in rows if _is_positive(r))
    negative_count = cached_count - positive_count
    return {
        "total_photos": total_photos,
        "cached_count": cached_count,
        "positive_count": positive_count,
        "negative_count": negative_count,
        "pending_count": total_photos - cached_count,
    }


@router.patch("/{album_id}/search-cache/{file_id}")
def set_cache_manual_status(
    album_id: int,
    file_id: int,
    body: CacheStatusIn,
    session: Session = Depends(get_session),
):
    """Mover foto manualmente a positivas (status=positive) o negativas (status=negative)."""
    a = session.get(Album, album_id)
    if not a:
        raise HTTPException(404, "Album not found")
    row = (
        session.query(AlbumSearchCache)
        .filter_by(album_id=album_id, file_id=file_id)
        .first()
    )
    if not row:
        raise HTTPException(404, "Foto no está en cache para este álbum")
    row.manual_status = 1 if body.status == "positive" else 0
    session.commit()
    return {"status": body.status, "file_id": file_id}


@router.post("/{album_id}/search-cache/batch")
def set_cache_manual_status_batch(
    album_id: int,
    body: CacheBatchStatusIn,
    session: Session = Depends(get_session),
):
    """Marcar varias filas del cache (p. ej. sugeridas) como positivas o negativas en un solo commit."""
    return _apply_cache_manual_status_batch(album_id, body, session)


@router.delete("/{album_id}/search-cache")
def delete_album_search_cache(album_id: int, session: Session = Depends(get_session)):
    """Borra todo el cache find-similar del álbum. Próxima búsqueda recalculará desde cero."""
    a = session.get(Album, album_id)
    if not a:
        raise HTTPException(404, "Album not found")
    deleted = session.query(AlbumSearchCache).filter(AlbumSearchCache.album_id == album_id).delete()
    session.commit()
    return {"deleted": deleted}


@router.post("/{album_id}/search-cache")
def set_cache_manual_status_batch_on_resource(
    album_id: int,
    body: CacheBatchStatusIn,
    session: Session = Depends(get_session),
):
    """
    Misma operación que POST .../search-cache/batch. URL canónica junto a GET/DELETE del recurso,
    para evitar 405 si algún proxy o cliente antiguo no llega al sufijo /batch.
    """
    return _apply_cache_manual_status_batch(album_id, body, session)


@router.patch("/{album_id}", response_model=AlbumOut)
def rename_album(
    album_id: int,
    body: AlbumRenameIn,
    session: Session = Depends(get_session),
):
    """Cambiar el nombre del álbum."""
    a = session.get(Album, album_id)
    if not a:
        raise HTTPException(404, "Album not found")
    label = (body.label or "").strip() or "Sin nombre"
    a.label = label
    session.commit()
    session.refresh(a)
    return _album_to_out(a, session)


@router.post("/{album_id}/add-files")
def add_files_to_album(
    album_id: int,
    body: AddFilesIn,
    session: Session = Depends(get_session),
):
    """Add files to an album."""
    # Un solo hilo por álbum + sin autoflush en el bucle: evita N flushes (INSERT) durante session.get,
    # que disparaban "database is locked" con SQLite bajo carga o indexación en paralelo.
    with _get_album_lock(album_id):
        a = session.get(Album, album_id)
        if not a:
            raise HTTPException(404, "Album not found")
        max_so = session.query(func.max(AlbumFile.sort_order)).filter_by(album_id=album_id).scalar()
        next_i = (max_so if max_so is not None else -1) + 1
        pending_new: set[int] = set()
        with session.no_autoflush:
            for fid in body.file_ids:
                f = session.get(FileModel, fid)
                if not f:
                    continue
                if fid in pending_new:
                    continue
                existing = session.query(AlbumFile).filter_by(album_id=album_id, file_id=fid).first()
                if existing:
                    continue
                session.add(
                    AlbumFile(album_id=album_id, file_id=fid, sort_order=next_i, use_in_centroid=1)
                )
                pending_new.add(fid)
                next_i += 1
        session.commit()
        _recalculate_album_cache_scores(album_id, session)
    return {"status": "ok"}


@router.patch("/{album_id}/files/{file_id}/use-in-centroid")
def set_album_file_use_in_centroid(
    album_id: int,
    file_id: int,
    body: UseInCentroidIn,
    session: Session = Depends(get_session),
):
    """Incluir o excluir una foto del centroide (como Excluir en Persona). Recalcula scores sin borrar cache."""
    with _get_album_lock(album_id):
        a = session.get(Album, album_id)
        if not a:
            raise HTTPException(404, "Album not found")
        af = session.query(AlbumFile).filter_by(album_id=album_id, file_id=file_id).first()
        if not af:
            raise HTTPException(404, "File not in album")
        af.use_in_centroid = 1 if body.use_in_centroid else 0
        session.commit()
        _recalculate_album_cache_scores(album_id, session)
    return {"status": "ok", "use_in_centroid": body.use_in_centroid}


@router.delete("/{album_id}/files/{file_id}")
def remove_file_from_album(
    album_id: int,
    file_id: int,
    session: Session = Depends(get_session),
):
    """Remove a file from an album."""
    with _get_album_lock(album_id):
        af = session.query(AlbumFile).filter_by(album_id=album_id, file_id=file_id).first()
        if af:
            session.delete(af)
            session.commit()
            _recalculate_album_cache_scores(album_id, session)
    return {"status": "ok"}


@router.patch("/{album_id}/reorder")
def reorder_album_files(
    album_id: int,
    body: ReorderAlbumIn,
    session: Session = Depends(get_session),
):
    """Actualiza el orden de las fotos en el álbum."""
    a = session.get(Album, album_id)
    if not a:
        raise HTTPException(404, "Album not found")
    existing = session.query(AlbumFile).filter_by(album_id=album_id).all()
    existing_ids = {af.file_id for af in existing}
    if set(body.file_ids) != existing_ids:
        raise HTTPException(
            400,
            "file_ids debe contener exactamente los mismos archivos del álbum, en el orden deseado",
        )
    for i, fid in enumerate(body.file_ids):
        af = session.query(AlbumFile).filter_by(album_id=album_id, file_id=fid).first()
        if af:
            af.sort_order = i
    session.commit()
    return {"status": "ok"}


class AlbumPhotoOut(FileOut):
    """Foto del álbum con use_in_centroid (como is_canonical en Persona)."""
    use_in_centroid: bool = True


@router.get("/{album_id}/photos", response_model=List[AlbumPhotoOut])
def get_album_photos(album_id: int, session: Session = Depends(get_session)):
    """Get all photos in an album (con use_in_centroid para modal Configurar fotos)."""
    a = session.get(Album, album_id)
    if not a:
        raise HTTPException(404, "Album not found")
    afs = (
        session.query(AlbumFile)
        .filter_by(album_id=album_id)
        .order_by(AlbumFile.sort_order.asc(), AlbumFile.file_id.asc())
        .all()
    )
    files = []
    for af in afs:
        f = session.get(FileModel, af.file_id)
        if f and getattr(f, "archived", 0) == 0:
            files.append(AlbumPhotoOut(
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
                archived=False,
                use_in_centroid=bool(getattr(af, "use_in_centroid", 1)),
            ))
    return files


@router.post("/{album_id}/find-similar", response_model=FindSimilarOut)
def find_similar_in_page(
    album_id: int,
    body: FindSimilarIn,
    min_similarity: float = 0.35,
    session: Session = Depends(get_session),
):
    """
    Encuentra fotos similares al álbum entre los file_ids enviados.

    CACHE (album_search_cache):
    - Guarda TODAS las fotos ya procesadas: positivas (sim >= min_similarity) y negativas (sim < min_similarity).
    - Clave: (album_id, file_id). Valor: similarity (0.0 a 1.0).
    - Si una foto está en cache, NUNCA se reprocesa. Solo se lee el valor guardado.
    - Se invalida cuando añades o quitas fotos del álbum (el centroide cambia).

    MODOS:
    - force_clip=False: usa caras (embeddings en DB). Rápido. Sin cache.
    - force_clip=True: usa CLIP (documentos). Lento por foto. Usa cache. max_new limita cuántas
      fotos nuevas procesar por request (0 = solo cache = instantáneo).
    """
    a = session.get(Album, album_id)
    if not a:
        raise HTTPException(404, "Album not found")

    use_clip = bool(body.force_clip)
    lock = _get_album_lock(album_id) if use_clip else None
    if lock:
        log.info("[find-similar] album_id=%s: esperando lock (otra petición del mismo álbum en curso?)", album_id)
        lock.acquire()
        log.info("[find-similar] album_id=%s: lock adquirido, procesando", album_id)

    try:
        return _find_similar_impl(album_id, body, min_similarity, session)
    finally:
        if lock:
            lock.release()
            log.info("[find-similar] album_id=%s: lock liberado", album_id)


def _find_similar_impl(
    album_id: int,
    body: FindSimilarIn,
    min_similarity: float,
    session: Session,
) -> FindSimilarOut:
    """Implementación de find_similar (llamada tras adquirir lock si use_clip)."""
    # 1) Obtener fotos del álbum en orden (use_in_centroid=1 para centroide)
    afs = (
        session.query(AlbumFile)
        .filter_by(album_id=album_id)
        .order_by(AlbumFile.sort_order.asc(), AlbumFile.file_id.asc())
        .all()
    )
    album_file_ids = [af.file_id for af in afs]
    centroid_afs = [af for af in afs if getattr(af, "use_in_centroid", 1) == 1]
    if not album_file_ids:
        return FindSimilarOut(
            use_clip=False, sample_count=0, sample_file_ids=[], cached_count=0, computed_count=0,
            pool_size=0, uncached_remaining_after=0, total_cached_album=0, results=[],
        )

    use_clip = bool(body.force_clip)
    album_embeddings: List[np.ndarray] = []
    sample_file_ids: List[int] = []  # file_ids que alimentan el centroide (visibilidad estilo Persona)

    # 2) Construir centroide del álbum
    if not use_clip:
        # Modo caras: embeddings de rostros canónicos (1 embedding por foto que tenga rostro)
        for fid in album_file_ids:
            faces = session.query(Face).filter_by(file_id=fid).filter(Face.is_canonical == 1).all()
            for face in faces:
                album_embeddings.append(bytes_to_embedding(face.embedding))
                if fid not in sample_file_ids:
                    sample_file_ids.append(fid)

    if use_clip or not album_embeddings:
        # Modo CLIP: embeddings desde file_clip_embeddings (persistidos, reutilizables)
        use_clip = True
        album_embeddings = []
        sample_file_ids = []
        ids_for_centroid = [af.file_id for af in centroid_afs]
        if getattr(body, "exclude_faces_from_centroid", False):
            ids_for_centroid = [
                fid for fid in ids_for_centroid
                if not session.query(Face).filter_by(file_id=fid).first()
            ]
            if not ids_for_centroid:
                ids_for_centroid = [af.file_id for af in centroid_afs]
            log.info("[find-similar] album_id=%s: exclude_faces -> %s fotos sin cara para centroide", album_id, len(ids_for_centroid))
        for fid in ids_for_centroid:
            f = session.get(FileModel, fid)
            if not f or f.file_type != "photo" or not Path(f.path).exists():
                continue
            emb = get_or_compute_file_embedding(session, fid, Path(f.path))
            if emb is not None:
                album_embeddings.append(emb)
                sample_file_ids.append(fid)

    if not album_embeddings:
        return FindSimilarOut(
            use_clip=use_clip, sample_count=0, sample_file_ids=[], cached_count=0, computed_count=0,
            pool_size=0, uncached_remaining_after=0, total_cached_album=0, results=[],
        )

    centroid = np.stack(album_embeddings).mean(axis=0).astype(np.float32)
    centroid = centroid / (np.linalg.norm(centroid) + 1e-9)

    # 3) Pool de candidatos (excluir fotos que ya están en el álbum)
    album_ids_set = set(album_file_ids)
    pool_ids = [fid for fid in body.file_ids if fid not in album_ids_set]
    log.info("[find-similar] album_id=%s pool=%s modo=%s", album_id, len(pool_ids), "CLIP" if use_clip else "caras")

    if use_clip:
        # --- MODO CLIP: usar cache. Positivos y negativos persisten; no reprocesar. ---
        # 4a) Cargar cache: fotos ya procesadas para este álbum
        cached = {}
        CHUNK = 500  # SQLite limita parámetros en IN(); chunkear para pools grandes
        for i in range(0, len(pool_ids), CHUNK):
            chunk = pool_ids[i : i + CHUNK]
            for row in session.query(AlbumSearchCache).filter(
                AlbumSearchCache.album_id == album_id,
                AlbumSearchCache.file_id.in_(chunk),
            ).all():
                cached[row.file_id] = row

        cached_ids = set(cached.keys())
        uncached_ids = [fid for fid in pool_ids if fid not in cached_ids]
        log.info("[find-similar] album_id=%s cache=%s pendientes=%s max_new=%s", album_id, len(cached_ids), len(uncached_ids), body.max_new)

        # 5a) Resultados desde cache (positivos: manual_status=1 o sim >= min_similarity)
        results = []
        for fid in pool_ids:
            row = cached.get(fid)
            if row is not None:
                manual = getattr(row, "manual_status", None)
                sim = row.similarity
                is_pos = manual == 1 or (manual is None and sim >= min_similarity)
                if is_pos:
                    results.append(SimilarResult(file_id=fid, similarity=round(sim, 4)))
                # Negativos (sim < min_similarity) no se añaden a results; pero ya están en cache.

        # 6a) Procesar fotos NUEVAS (sin cache). Máx. max_new para no bloquear. 0 = solo cache.
        max_new = max(0, body.max_new)
        computed_count = 0
        to_compute = uncached_ids[:max_new] if max_new > 0 else []
        total_to_compute = len(to_compute)
        if total_to_compute > 0:
            log.info("[find-similar] album_id=%s: procesando CLIP %s/%s fotos (puede tardar ~1 min)", album_id, total_to_compute, len(uncached_ids))
        for idx, fid in enumerate(to_compute):
            f = session.get(FileModel, fid)
            if not f or f.file_type != "photo" or not Path(f.path).exists():
                continue
            emb = get_or_compute_file_embedding(session, fid, Path(f.path))
            if emb is None:
                continue
            emb = emb / (np.linalg.norm(emb) + 1e-9)
            sim = float(np.dot(centroid, emb))
            computed_count += 1
            if computed_count % 10 == 0 or computed_count == total_to_compute:
                log.info("[find-similar] album_id=%s: procesadas %s/%s", album_id, computed_count, total_to_compute)
            # Persistir: positivo O negativo; la próxima vez no se reprocesa
            session.add(AlbumSearchCache(album_id=album_id, file_id=fid, similarity=sim, use_clip=1))
            if sim >= min_similarity:
                results.append(SimilarResult(file_id=fid, similarity=round(sim, 4)))
        session.commit()

        cached_count = len(cached_ids)
        uncached_remaining_after = max(0, len(uncached_ids) - computed_count)
        total_cached_album = session.query(AlbumSearchCache).filter_by(album_id=album_id).count()
        log.info("[find-similar] album_id=%s: listo. cache=%s computadas=%s resultados=%s", album_id, cached_count, computed_count, len(results))
        results.sort(key=lambda x: x.similarity, reverse=True)
        return FindSimilarOut(
            use_clip=True, sample_count=len(album_embeddings),
            sample_file_ids=sample_file_ids,
            cached_count=cached_count, computed_count=computed_count,
            pool_size=len(pool_ids),
            uncached_remaining_after=uncached_remaining_after,
            total_cached_album=total_cached_album,
            results=results[:50],
        )

    # --- MODO CARAS: sin cache (embeddings ya en DB, rápido) ---
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
    return FindSimilarOut(
        use_clip=False, sample_count=len(album_embeddings), sample_file_ids=sample_file_ids,
        cached_count=0, computed_count=0, pool_size=len(pool_ids),
        uncached_remaining_after=0, total_cached_album=0, results=results[:50],
    )


@router.post("/{album_id}/find-similar-library", response_model=FindSimilarOut)
def find_similar_library(
    album_id: int,
    min_similarity: float = Query(0.35, ge=0.0, le=1.0),
    max_new: int = Query(1000, ge=0, le=2000),
    force_clip: bool = Query(True),
    exclude_faces_from_centroid: bool = Query(False),
    session: Session = Depends(get_session),
):
    """
    Busca similares en TODA la biblioteca (no solo 5000 fotos). Pool desde backend.
    Usa cache y file_clip_embeddings; procesa hasta max_new fotos nuevas por request.
    """
    a = session.get(Album, album_id)
    if not a:
        raise HTTPException(404, "Album not found")
    album_file_ids = [
        af.file_id
        for af in session.query(AlbumFile)
        .filter_by(album_id=album_id)
        .order_by(AlbumFile.sort_order.asc(), AlbumFile.file_id.asc())
        .all()
    ]
    if not album_file_ids:
        return FindSimilarOut(
            use_clip=False, sample_count=0, sample_file_ids=[], cached_count=0, computed_count=0,
            pool_size=0, uncached_remaining_after=0, total_cached_album=0, results=[],
        )

    pq = session.query(FileModel.id).filter(FileModel.file_type == "photo").filter(FileModel.archived == 0)
    if album_file_ids:
        pq = pq.filter(~FileModel.id.in_(album_file_ids))
    pool_ids = [r[0] for r in pq.order_by(FileModel.id.asc()).limit(MAX_POOL_LIBRARY).all()]
    body = FindSimilarIn(
        file_ids=pool_ids,
        force_clip=force_clip,
        max_new=max_new,
        exclude_faces_from_centroid=exclude_faces_from_centroid,
    )
    lock = _get_album_lock(album_id)
    lock.acquire()
    try:
        return _find_similar_impl(album_id, body, min_similarity, session)
    finally:
        lock.release()


@router.get("/{album_id}/search-cache")
def get_album_search_cache(
    album_id: int,
    status: str = Query("all", regex="^(positive|negative|all)$"),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=2000),
    include_files: bool = Query(True),
    session: Session = Depends(get_session),
):
    """
    Lista fotos ya clasificadas para el álbum: positivas (sim>=0.35), negativas (sim<0.35) o todas.
    Con include_files=True (default) devuelve file data inline: una petición, sin N+1.
    """
    a = session.get(Album, album_id)
    if not a:
        raise HTTPException(404, "Album not found")
    q = session.query(AlbumSearchCache).filter(AlbumSearchCache.album_id == album_id)
    if status == "positive":
        q = q.filter(
            or_(
                AlbumSearchCache.manual_status == 1,
                and_(AlbumSearchCache.manual_status.is_(None), AlbumSearchCache.similarity >= 0.35),
            )
        )
    elif status == "negative":
        q = q.filter(
            or_(
                AlbumSearchCache.manual_status == 0,
                and_(AlbumSearchCache.manual_status.is_(None), AlbumSearchCache.similarity < 0.35),
            )
        )
    total = q.count()
    rows = q.order_by(AlbumSearchCache.similarity.desc()).offset(skip).limit(limit).all()
    items = []
    for r in rows:
        obj: dict = {"file_id": r.file_id, "similarity": round(r.similarity, 4)}
        if include_files:
            f = session.get(FileModel, r.file_id)
            obj["file"] = FileOut(
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
            ) if f else None
        items.append(obj)
    return {"items": items, "total": total, "status": status}
