"""
/people  — cluster-centric endpoints (people = clusters of faces)
"""
import base64
import json
import logging
from datetime import datetime, timezone
from typing import List, Optional

import numpy as np
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session, joinedload

from pathlib import Path

from api.deps import get_session
from api.models import ClusterOut, ClusterSimilarOut, FileOut, ClusterUpdateIn, MergeClustersIn, CreateClusterIn, AddFaceIn, AssignFaceIn, FaceOut, SetFaceCanonicalIn
from indexer.db import Cluster, Face, File, bytes_to_embedding, embedding_to_bytes
from indexer.embeddings_store import get_cluster_centroids
from indexer.face_detector import load_image, detect_faces
from indexer.region_embedder import embed_region

router = APIRouter(prefix="/people", tags=["people"])


def _cluster_to_out(cluster: Cluster, session: Session) -> ClusterOut:
    cover_thumb = None
    if cluster.cover_face_id:
        face = session.get(Face, cluster.cover_face_id)
        if face and face.file:
            cover_thumb = face.file.thumbnail_path
    return ClusterOut(
        id=cluster.id,
        label=cluster.label,
        size=cluster.size,
        cover_face_id=cluster.cover_face_id,
        cover_thumbnail=cover_thumb,
        is_manual=bool(cluster.is_manual),
    )


@router.get("/", response_model=List[ClusterOut])
def list_people(
    skip: int = Query(0, ge=0),
    limit: int = Query(500, ge=1, le=2000),
    session: Session = Depends(get_session),
):
    """List all people (clusters) that have at least one face. Ordered by size descending."""
    # Exclude orphaned clusters (size>0 but no faces - e.g. after merge source not deleted)
    clusters = (
        session.query(Cluster)
        .join(Face, Face.cluster_id == Cluster.id)
        .distinct()
        .order_by(Cluster.is_manual.desc(), Cluster.size.desc())
        .offset(skip)
        .limit(limit)
        .all()
    )
    return [_cluster_to_out(c, session) for c in clusters]


@router.get("/{person_id}", response_model=ClusterOut)
def get_person(person_id: int, session: Session = Depends(get_session)):
    cluster = session.get(Cluster, person_id)
    if not cluster:
        raise HTTPException(404, "Person not found")
    # Sync size with actual face count (fixes orphaned clusters from merges/re-clustering)
    actual = session.query(Face).filter(Face.cluster_id == person_id).count()
    if actual != cluster.size:
        cluster.size = actual
        if actual == 0 and not cluster.is_manual:
            session.delete(cluster)
            session.commit()
            raise HTTPException(404, "Person not found")
        session.commit()
    return _cluster_to_out(cluster, session)


@router.get("/{person_id}/similar", response_model=List[ClusterSimilarOut])
def get_similar_people(
    person_id: int,
    limit: int = Query(15, ge=1, le=50),
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

    results = []
    for cid, centroid in centroids.items():
        if cid == person_id:
            continue
        sim = float(np.dot(target_norm, centroid / (np.linalg.norm(centroid) or 1e-9)))
        sim = max(0.0, min(1.0, sim))
        if sim >= min_similarity:
            results.append((cid, sim))

    results.sort(key=lambda x: -x[1])
    results = results[:limit]

    out = []
    for cid, sim in results:
        c = session.get(Cluster, cid)
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


@router.post("/{person_id}/find-similar-in-page", response_model=List[SimilarFileInPage])
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
        return []

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
    for fid in body.file_ids:
        if fid in seen or fid in already_person:
            continue
        f = session.get(File, fid)
        if not f or f.file_type != "photo":
            continue
        faces = session.query(Face).filter_by(file_id=fid).all()
        if not faces:
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
    return results[:50]


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
        .options(joinedload(File.faces))
        .join(Face, Face.file_id == File.id)
        .filter(Face.cluster_id == person_id)
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
    session.commit()
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
    session.commit()
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
    session.commit()
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
    session.commit()
    return _cluster_to_out(cluster, session)


@router.post("/{person_id}/add-video", response_model=ClusterOut)
def add_video_to_person(
    person_id: int,
    file_id: int = Query(..., description="Video file ID"),
    session: Session = Depends(get_session),
):
    """Asigna un video a una persona usando el primer rostro detectado en el video."""
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
        raise HTTPException(400, "El video no tiene rostros detectados. Reindexa el video.")

    face.cluster_id = person_id
    cluster.size = session.query(Face).filter(Face.cluster_id == person_id).count()
    if cluster.cover_face_id is None:
        cluster.cover_face_id = face.id
    session.commit()
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
    session.commit()
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
    session.commit()
    return _cluster_to_out(cluster, session)


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
    session.commit()
    return _cluster_to_out(target, session)
