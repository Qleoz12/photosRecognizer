"""
/people  — cluster-centric endpoints (people = clusters of faces)
"""
import base64
import json
import logging
import os
import tempfile
import zipfile
from datetime import datetime, timezone
from typing import List, Optional

import numpy as np
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from pathlib import Path

from api.deps import get_session
from api.models import ClusterOut, ClusterSimilarOut, FileOut, ClusterUpdateIn, MergeClustersIn, CreateClusterIn, AddFaceIn, AssignFaceIn, FaceOut, SetFaceCanonicalIn
from indexer.db import Cluster, Face, File, bytes_to_embedding, embedding_to_bytes
from indexer.embeddings_store import get_cluster_centroids, invalidate_cluster_centroids_cache
from indexer.query_patterns import eager_load_cluster_cover_thumbnail, eager_load_file_faces_metadata
from indexer.face_detector import load_image, detect_faces
from indexer.region_embedder import embed_region
from indexer.video_extractor import extract_first_frame_any

router = APIRouter(prefix="/people", tags=["people"])


def _commit_invalidate_centroids(session: Session) -> None:
    session.commit()
    invalidate_cluster_centroids_cache()


def _cluster_to_out(cluster: Cluster, session: Session) -> ClusterOut:
    cover_thumb = None
    if cluster.cover_face_id:
        face = cluster.cover_face if cluster.cover_face else session.get(Face, cluster.cover_face_id)
        if face and face.file:
            cover_thumb = face.file.thumbnail_path
    return ClusterOut(
        id=cluster.id,
        label=cluster.label,
        size=cluster.size,
        cover_face_id=cluster.cover_face_id,
        cover_thumbnail=cover_thumb,
        is_manual=bool(cluster.is_manual),
        is_hidden=bool(getattr(cluster, "is_hidden", 0)),
    )


@router.get("/", response_model=List[ClusterOut])
def list_people(
    skip: int = Query(0, ge=0),
    limit: int = Query(500, ge=1, le=2000),
    include_hidden: bool = Query(False, description="Si true, solo personas con is_hidden=1 (gestión de ocultas)."),
    session: Session = Depends(get_session),
):
    """List people (clusters) with at least one face. Por defecto excluye ocultas."""
    # Exclude orphaned clusters (size>0 but no faces - e.g. after merge source not deleted)
    q = (
        session.query(Cluster)
        .options(eager_load_cluster_cover_thumbnail())
        .join(Face, Face.cluster_id == Cluster.id)
        .distinct()
    )
    # COALESCE: filas creadas antes de la migración o valores NULL no revierten el filtro
    if include_hidden:
        q = q.filter(func.coalesce(Cluster.is_hidden, 0) == 1)
    else:
        q = q.filter(func.coalesce(Cluster.is_hidden, 0) == 0)
    clusters = (
        q.order_by(Cluster.is_manual.desc(), Cluster.size.desc())
        .offset(skip)
        .limit(limit)
        .all()
    )
    return [_cluster_to_out(c, session) for c in clusters]


@router.get("/{person_id}", response_model=ClusterOut)
def get_person(person_id: int, session: Session = Depends(get_session)):
    cluster = (
        session.query(Cluster)
        .options(eager_load_cluster_cover_thumbnail())
        .filter(Cluster.id == person_id)
        .one_or_none()
    )
    if not cluster:
        raise HTTPException(404, "Person not found")
    # Sync size with actual face count (fixes orphaned clusters from merges/re-clustering)
    actual = session.query(Face).filter(Face.cluster_id == person_id).count()
    if actual != cluster.size:
        cluster.size = actual
        if actual == 0 and not cluster.is_manual:
            session.delete(cluster)
            _commit_invalidate_centroids(session)
            raise HTTPException(404, "Person not found")
        _commit_invalidate_centroids(session)
    return _cluster_to_out(cluster, session)


@router.get("/{person_id}/similar", response_model=List[ClusterSimilarOut])
def get_similar_people(
    person_id: int,
    limit: int = Query(15, ge=1, le=200),
    min_similarity: float = Query(0.5, ge=0.0, le=1.0),
    session: Session = Depends(get_session),
):
    """
    Return other people ordered by face similarity (centroid cosine similarity).
    Helps validate merges: high similarity = likely same person.
    """
    cluster = session.get(Cluster, person_id)
    if not cluster:
        raise HTTPException(404, "Person not found")

    centroids = get_cluster_centroids(session)
    if person_id not in centroids:
        return []

    target = centroids[person_id]
    target_norm = target / (np.linalg.norm(target) or 1e-9)

    hidden_ids = {
        r[0]
        for r in session.query(Cluster.id).filter(func.coalesce(Cluster.is_hidden, 0) == 1).all()
    }

    results = []
    for cid, centroid in centroids.items():
        if cid == person_id or cid in hidden_ids:
            continue
        sim = float(np.dot(target_norm, centroid / (np.linalg.norm(centroid) or 1e-9)))
        sim = max(0.0, min(1.0, sim))
        if sim >= min_similarity:
            results.append((cid, sim))

    results.sort(key=lambda x: -x[1])
    results = results[:limit]

    if not results:
        return []
    cids = [cid for cid, _ in results]
    clusters_by_id = {
        c.id: c
        for c in session.query(Cluster)
        .options(eager_load_cluster_cover_thumbnail())
        .filter(Cluster.id.in_(cids))
        .all()
    }
    out = []
    for cid, sim in results:
        c = clusters_by_id.get(cid)
        if c:
            o = _cluster_to_out(c, session)
            out.append(ClusterSimilarOut(**o.model_dump(), similarity=round(sim, 4)))
    return out


class FindSimilarPageIn(BaseModel):
    """Solo file_ids que el cliente tiene cargados en la página (p. ej. All Photos)."""
    file_ids: List[int]


class SimilarFileInPage(BaseModel):
    file_id: int
    similarity: float


class PersonFindSimilarOut(BaseModel):
    """Respuesta con progreso: pool, ya en persona, sin caras para comparar."""
    results: List[SimilarFileInPage]
    pool_size: int
    skipped_already_in_person: int
    skipped_no_faces: int


@router.post("/{person_id}/find-similar-in-page", response_model=PersonFindSimilarOut)
def find_similar_person_in_loaded_page(
    person_id: int,
    body: FindSimilarPageIn,
    min_similarity: float = Query(0.35, ge=0.0, le=1.0),
    session: Session = Depends(get_session),
):
    """
    Fotos similares a esta persona entre los file_ids enviados (solo lo cargado en el navegador).
    No recorre toda la biblioteca.
    """
    cluster = session.get(Cluster, person_id)
    if not cluster:
        raise HTTPException(404, "Person not found")

    face_rows = (
        session.query(Face)
        .filter(Face.cluster_id == person_id)
        .filter(Face.is_canonical == 1)
        .all()
    )
    if not face_rows:
        face_rows = session.query(Face).filter(Face.cluster_id == person_id).all()
    if not face_rows:
        return PersonFindSimilarOut(results=[], pool_size=len(body.file_ids), skipped_already_in_person=0, skipped_no_faces=0)

    embs = [bytes_to_embedding(f.embedding) for f in face_rows]
    centroid = np.stack(embs).mean(axis=0).astype(np.float32)
    centroid = centroid / (np.linalg.norm(centroid) + 1e-9)

    already_person = {
        row[0]
        for row in session.query(Face.file_id)
        .filter(Face.cluster_id == person_id)
        .distinct()
        .all()
    }

    results: List[SimilarFileInPage] = []
    seen: set[int] = set()
    skipped_already = 0
    skipped_no_faces = 0
    for fid in body.file_ids:
        if fid in seen:
            continue
        if fid in already_person:
            skipped_already += 1
            continue
        f = session.get(File, fid)
        if not f or f.file_type != "photo":
            continue
        if getattr(f, "archived", 0) == 1:
            continue
        faces = session.query(Face).filter_by(file_id=fid).all()
        if not faces:
            skipped_no_faces += 1
            continue
        best_sim = -1.0
        for face in faces:
            emb = bytes_to_embedding(face.embedding)
            emb = emb / (np.linalg.norm(emb) + 1e-9)
            sim = float(np.dot(centroid, emb))
            if sim > best_sim:
                best_sim = sim
        if best_sim >= min_similarity:
            results.append(SimilarFileInPage(file_id=fid, similarity=round(best_sim, 4)))
            seen.add(fid)

    results.sort(key=lambda x: x.similarity, reverse=True)
    return PersonFindSimilarOut(
        results=results[:50],
        pool_size=len(body.file_ids),
        skipped_already_in_person=skipped_already,
        skipped_no_faces=skipped_no_faces,
    )


@router.get("/{person_id}/photos", response_model=List[FileOut])
def get_person_photos(
    person_id: int,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=2000),
    session: Session = Depends(get_session),
):
    """Return all photos/videos that contain a face belonging to this person."""
    cluster = session.get(Cluster, person_id)
    if not cluster:
        raise HTTPException(404, "Person not found")

    # JOIN ensures we get files that have at least one face in this cluster
    files = (
        session.query(File)
        .options(eager_load_file_faces_metadata())
        .join(Face, Face.file_id == File.id)
        .filter(Face.cluster_id == person_id)
        .filter(File.archived == 0)
        .distinct()
        .order_by(File.exif_date.desc(), File.id.asc())
        .offset(skip)
        .limit(limit)
        .all()
    )

    result = []
    for f in files:
        faces_out = [
            FaceOut(
                id=face.id,
                file_id=face.file_id,
                bbox=json.loads(face.bbox_json),
                det_score=face.det_score,
                cluster_id=face.cluster_id,
                is_canonical=bool(getattr(face, "is_canonical", 1)),
            )
            for face in f.faces
        ]
        file_modified = None
        if f.mtime:
            try:
                file_modified = datetime.fromtimestamp(f.mtime, tz=timezone.utc).isoformat()
            except (OSError, ValueError):
                pass
        result.append(FileOut(
            id=f.id,
            path=f.path,
            file_type=f.file_type,
            exif_date=f.exif_date,
            exif_lat=f.exif_lat,
            exif_lon=f.exif_lon,
            file_modified=file_modified,
            thumbnail_path=f.thumbnail_path,
            width=f.width,
            height=f.height,
            duration=getattr(f, "duration", None),
            faces=faces_out,
            archived=bool(getattr(f, "archived", 0)),
        ))
    return result


@router.post("/create", response_model=ClusterOut)
def create_person(
    body: CreateClusterIn,
    session: Session = Depends(get_session),
):
    """Crear una nueva persona/cluster vacía. Luego puedes agregar rostros desde fotos."""
    cluster = Cluster(
        label=body.label or None,
        size=0,
        cover_face_id=None,
        is_manual=1,
    )
    session.add(cluster)
    session.flush()
    _commit_invalidate_centroids(session)
    return _cluster_to_out(cluster, session)


@router.patch("/{person_id}", response_model=ClusterOut)
def update_person(
    person_id: int,
    body: ClusterUpdateIn,
    session: Session = Depends(get_session),
):
    """Rename a person or change their cover photo. Marks cluster as manual."""
    cluster = session.get(Cluster, person_id)
    if not cluster:
        raise HTTPException(404, "Person not found")
    if body.label is not None:
        cluster.label = body.label
        cluster.is_manual = 1  # renaming = user confirmed this person
    if body.cover_face_id is not None:
        face = session.get(Face, body.cover_face_id)
        if not face:
            raise HTTPException(404, "Face not found")
        if face.cluster_id != person_id:
            raise HTTPException(400, "El rostro debe pertenecer a esta persona")
        cluster.cover_face_id = body.cover_face_id
    if body.is_hidden is not None:
        cluster.is_hidden = 1 if body.is_hidden else 0
    session.flush()
    _commit_invalidate_centroids(session)
    session.refresh(cluster)
    return _cluster_to_out(cluster, session)


@router.post("/{person_id}/assign-face", response_model=ClusterOut)
def assign_face_to_person(
    person_id: int,
    body: AssignFaceIn,
    session: Session = Depends(get_session),
):
    """Assign an existing face (already in DB) to this person. For tagging photos with multiple people."""
    cluster = session.get(Cluster, person_id)
    if not cluster:
        raise HTTPException(404, "Person not found")
    face = session.get(Face, body.face_id)
    if not face:
        raise HTTPException(404, "Face not found")

    old_cid = face.cluster_id
    face.cluster_id = person_id
    cluster.size = session.query(Face).filter(Face.cluster_id == person_id).count()
    if cluster.cover_face_id is None:
        cluster.cover_face_id = face.id
    if old_cid is not None and old_cid != person_id:
        old_cluster = session.get(Cluster, old_cid)
        if old_cluster:
            old_cluster.size = session.query(Face).filter(Face.cluster_id == old_cid).count()
    _commit_invalidate_centroids(session)
    return _cluster_to_out(cluster, session)


@router.post("/{person_id}/add-face", response_model=ClusterOut)
def add_face_to_person(
    person_id: int,
    body: AddFaceIn,
    session: Session = Depends(get_session),
):
    """Add a face from a photo region to this person. No re-index needed."""
    cluster = session.get(Cluster, person_id)
    if not cluster:
        raise HTTPException(404, "Person not found")
    f = session.get(File, body.file_id)
    if not f or not Path(f.path).exists():
        raise HTTPException(404, "File not found")
    if f.file_type != "photo":
        raise HTTPException(400, "Only photos supported")

    log = logging.getLogger("photos_recognizer")
    w, h = 0, 0

    if body.embedding_b64:
        # From faces-from-region: use embedding directly, no re-detect (avoids 422 on tight crops)
        try:
            raw = base64.b64decode(body.embedding_b64)
            embedding = np.frombuffer(raw, dtype=np.float32)
            if embedding.shape[0] != 512:
                raise ValueError("Invalid embedding size")
        except Exception as e:
            log.warning("add-face: invalid embedding_b64, falling back to detect: %s", e)
            body.embedding_b64 = None
        else:
            det_score = float(body.det_score) if body.det_score is not None else 0.9
            img = load_image(Path(f.path))
            if img is None:
                raise HTTPException(422, "Cannot load image")
            w, h = img.size
            x1 = int(body.bbox[0] * w)
            y1 = int(body.bbox[1] * h)
            x2 = int(body.bbox[2] * w)
            y2 = int(body.bbox[3] * h)
            x1, x2 = max(0, min(x1, x2)), min(w, max(x1, x2))
            y1, y2 = max(0, min(y1, y2)), min(h, max(y1, y2))
            bbox_px = [float(x1), float(y1), float(x2), float(y2)]
            log.info("add-face: using embedding from faces-from-region, person=%s file=%s bbox=%s", person_id, body.file_id, bbox_px)

    if not body.embedding_b64:
        img = load_image(Path(f.path))
        if img is None:
            raise HTTPException(422, "Cannot load image")
        w, h = img.size
        x1 = int(body.bbox[0] * w)
        y1 = int(body.bbox[1] * h)
        x2 = int(body.bbox[2] * w)
        y2 = int(body.bbox[3] * h)
        x1, x2 = max(0, min(x1, x2)), min(w, max(x1, x2))
        y1, y2 = max(0, min(y1, y2)), min(h, max(y1, y2))
        if x2 - x1 < 20 or y2 - y1 < 20:
            raise HTTPException(422, "Region too small")

        pad_x = max(30, int(0.25 * (x2 - x1)))
        pad_y = max(30, int(0.25 * (y2 - y1)))
        cx1 = max(0, x1 - pad_x)
        cy1 = max(0, y1 - pad_y)
        cx2 = min(w, x2 + pad_x)
        cy2 = min(h, y2 + pad_y)

        crop = img.crop((cx1, cy1, cx2, cy2))
        faces = detect_faces(crop)
        log.info("add-face: detect crop=%sx%s, faces=%s", crop.width, crop.height, len(faces) if faces else 0)
        if faces:
            best = max(faces, key=lambda x: x[2])
            face_bbox = best[0]
            bbox_px = [
                float(cx1 + face_bbox[0]),
                float(cy1 + face_bbox[1]),
                float(cx1 + face_bbox[2]),
                float(cy1 + face_bbox[3]),
            ]
            embedding, det_score = best[1], best[2]
        else:
            # Fallback: CLIP para mascotas/objetos o asignación manual
            try:
                embedding = embed_region(crop)
                det_score = 0.5
                bbox_px = [float(x1), float(y1), float(x2), float(y2)]
                log.info("add-face: using CLIP fallback for region, person=%s file=%s", person_id, body.file_id)
            except Exception as e:
                log.warning("add-face: CLIP fallback failed: %s", e)
                raise HTTPException(422, "No se pudo procesar la región seleccionada")

    face = Face(
        file_id=body.file_id,
        bbox_json=json.dumps(bbox_px),
        embedding=embedding_to_bytes(embedding),
        det_score=float(det_score),
        cluster_id=person_id,
    )
    session.add(face)
    session.flush()
    cluster.size = session.query(Face).filter(Face.cluster_id == person_id).count()
    if cluster.cover_face_id is None:
        cluster.cover_face_id = face.id
    _commit_invalidate_centroids(session)
    return _cluster_to_out(cluster, session)


@router.post("/{person_id}/add-video", response_model=ClusterOut)
def add_video_to_person(
    person_id: int,
    file_id: int = Query(..., description="Video file ID"),
    strict_faces: bool = Query(
        False,
        description="Si true, exige un rostro ya indexado (error si el índice no detectó ninguno).",
    ),
    session: Session = Depends(get_session),
):
    """
    Asigna un vídeo a una persona.

    Si el índice ya tiene caras en ese archivo, reutiliza la primera.
    Si no hay caras y strict_faces=false (default), extrae un fotograma, embedding CLIP
    y crea una cara placeholder (is_canonical=0) para no mezclar con centroides faciales.
    """
    cluster = session.get(Cluster, person_id)
    if not cluster:
        raise HTTPException(404, "Person not found")
    f = session.get(File, file_id)
    if not f or not Path(f.path).exists():
        raise HTTPException(404, "File not found")
    if f.file_type != "video":
        raise HTTPException(400, "Solo videos soportados")

    face = session.query(Face).filter(Face.file_id == file_id).first()
    if not face:
        if strict_faces:
            raise HTTPException(
                400,
                "El video no tiene rostros detectados. Reindexa el video o llama sin strict_faces.",
            )
        vpath = Path(f.path)
        frame = extract_first_frame_any(vpath)
        if frame is None:
            raise HTTPException(
                422,
                "No se pudo extraer un fotograma del vídeo (¿ffmpeg instalado?). "
                "Reindexa o revisa el archivo.",
            )
        w, h = frame.size
        try:
            emb = embed_region(frame.convert("RGB"))
        except Exception as e:
            log = logging.getLogger("photos_recognizer")
            log.warning("add-video placeholder CLIP failed file=%s: %s", file_id, e)
            raise HTTPException(422, "No se pudo calcular embedding del fotograma (CLIP).")
        bbox_px = [0.0, 0.0, float(w), float(h)]
        face = Face(
            file_id=file_id,
            bbox_json=json.dumps(bbox_px),
            embedding=embedding_to_bytes(emb),
            det_score=0.12,
            cluster_id=person_id,
            is_canonical=0,
        )
        session.add(face)
        session.flush()
    else:
        face.cluster_id = person_id

    cluster.size = session.query(Face).filter(Face.cluster_id == person_id).count()
    if cluster.cover_face_id is None:
        cluster.cover_face_id = face.id
    _commit_invalidate_centroids(session)
    return _cluster_to_out(cluster, session)


@router.post("/{person_id}/set-face-canonical", response_model=ClusterOut)
def set_face_canonical(
    person_id: int,
    body: SetFaceCanonicalIn,
    session: Session = Depends(get_session),
):
    """Marcar un rostro como canónico (usado para centroide) o no. Si no canónico, sigue en el cluster pero no influye en comparaciones."""
    cluster = session.get(Cluster, person_id)
    if not cluster:
        raise HTTPException(404, "Person not found")
    face = session.get(Face, body.face_id)
    if not face:
        raise HTTPException(404, "Face not found")
    if face.cluster_id != person_id:
        raise HTTPException(400, "Este rostro no pertenece a esta persona")
    face.is_canonical = 1 if body.is_canonical else 0
    _commit_invalidate_centroids(session)
    return _cluster_to_out(cluster, session)


@router.post("/{person_id}/remove-face", response_model=ClusterOut)
def remove_face_from_person(
    person_id: int,
    body: AssignFaceIn,
    session: Session = Depends(get_session),
):
    """Quitar un rostro de esta persona (lo deja sin asignar). Para afinar el cluster."""
    cluster = session.get(Cluster, person_id)
    if not cluster:
        raise HTTPException(404, "Person not found")
    face = session.get(Face, body.face_id)
    if not face:
        raise HTTPException(404, "Face not found")
    if face.cluster_id != person_id:
        raise HTTPException(400, "Este rostro no pertenece a esta persona")

    face.cluster_id = None
    cluster.is_manual = 1  # usuario está afinando el cluster
    cluster.size = session.query(Face).filter(Face.cluster_id == person_id).count()
    if cluster.cover_face_id == face.id:
        other = session.query(Face).filter(Face.cluster_id == person_id).first()
        cluster.cover_face_id = other.id if other else None
    _commit_invalidate_centroids(session)
    return _cluster_to_out(cluster, session)


@router.get("/{person_id}/download.zip")
def download_person_zip(
    person_id: int,
    background_tasks: BackgroundTasks,
    session: Session = Depends(get_session),
):
    """ZIP con todas las fotos/vídeos del cluster (no archivados). Puede tardar con miles de archivos."""
    cluster = session.get(Cluster, person_id)
    if not cluster:
        raise HTTPException(404, "Person not found")
    rows = (
        session.query(File)
        .join(Face, Face.file_id == File.id)
        .filter(Face.cluster_id == person_id, File.archived == 0)
        .distinct()
        .order_by(File.id)
        .all()
    )
    if not rows:
        raise HTTPException(404, "No hay archivos para exportar")
    fd, tmp_path = tempfile.mkstemp(suffix=".zip")
    os.close(fd)
    label = (cluster.label or f"persona-{person_id}").replace("/", "-").replace("\\", "-")[:80]
    try:
        with zipfile.ZipFile(tmp_path, "w", zipfile.ZIP_DEFLATED) as zf:
            for f in rows:
                p = Path(f.path)
                if not p.is_file():
                    continue
                arc = f"{label}/{f.id}_{p.name}"
                zf.write(p, arcname=arc)
    except Exception:
        if os.path.isfile(tmp_path):
            os.unlink(tmp_path)
        raise

    def _unlink():
        if os.path.isfile(tmp_path):
            try:
                os.unlink(tmp_path)
            except OSError:
                pass

    background_tasks.add_task(_unlink)
    safe = "".join(c if c.isalnum() or c in "-_" else "_" for c in label) or f"persona-{person_id}"
    return FileResponse(
        tmp_path,
        filename=f"{safe}.zip",
        media_type="application/zip",
    )


@router.post("/merge", response_model=ClusterOut)
def merge_people(body: MergeClustersIn, session: Session = Depends(get_session)):
    """Merge source cluster into target cluster. Result is marked as manual."""
    source = session.get(Cluster, body.source_id)
    target = session.get(Cluster, body.target_id)
    if not source or not target:
        raise HTTPException(404, "Cluster not found")

    session.query(Face).filter(Face.cluster_id == body.source_id).update(
        {"cluster_id": body.target_id}
    )
    target.size = session.query(Face).filter(Face.cluster_id == body.target_id).count()
    target.is_manual = 1  # merged by user = protected from re-clustering
    session.delete(source)
    _commit_invalidate_centroids(session)
    return _cluster_to_out(target, session)
