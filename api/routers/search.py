"""
/search  — face similarity search endpoint.
POST /search/face  — upload an image, find the most similar people.
POST /search/face-from-region  — crop region in a photo, search similar faces.
"""
import base64
import io
from pathlib import Path
from typing import List

import numpy as np
from fastapi import APIRouter, Depends, File, UploadFile, HTTPException, BackgroundTasks
from sqlalchemy.orm import Session
from PIL import Image
from pydantic import BaseModel

from api.deps import get_session
from api.models import SearchResult, FaceInRegionOut, FacesFromRegionOut
from indexer.db import Face, File as FileModel
from indexer.face_detector import detect_faces, load_image
from indexer.region_embedder import embed_region
from indexer.embeddings_store import get_all_embeddings
from indexer.hnsw_index import build_index

router = APIRouter(prefix="/search", tags=["search"])


class FaceFromRegionIn(BaseModel):
    file_id: int
    bbox: List[float]  # [x1, y1, x2, y2] normalized 0-1

# Cached in-memory index (rebuilt on demand)
_index_cache = None
_index_face_ids: List[int] = []


def _get_index(session: Session):
    """Load or rebuild the search index."""
    global _index_cache, _index_face_ids
    face_ids, embeddings = get_all_embeddings(session)
    if face_ids != _index_face_ids or _index_cache is None:
        _index_cache = build_index(embeddings, face_ids)
        _index_face_ids = face_ids
    return _index_cache, face_ids


@router.post("/face", response_model=List[SearchResult])
async def search_by_face(
    file: UploadFile = File(...),
    top_k: int = 20,
    session: Session = Depends(get_session),
):
    """Upload a photo with a face. Returns the top-K most similar faces in the library."""
    try:
        data = await file.read()
        img = Image.open(io.BytesIO(data))
    except Exception:
        raise HTTPException(400, "Cannot read image file")

    faces = detect_faces(img)
    if not faces:
        raise HTTPException(422, "No faces detected in uploaded image")

    # Use the most confident face
    query_embedding = max(faces, key=lambda x: x[2])[1]

    index, face_ids = _get_index(session)
    if not face_ids:
        return []

    matches = index.search(query_embedding, top_k)

    results: List[SearchResult] = []
    for face_id, sim in matches:
        face = session.get(Face, face_id)
        if face is None:
            continue
        results.append(SearchResult(
            cluster_id=face.cluster_id,
            face_id=face_id,
            similarity=round(sim, 4),
            file_id=face.file_id,
            thumbnail_path=face.file.thumbnail_path if face.file else None,
            exif_date=face.file.exif_date if face.file else None,
        ))

    return results


def _crop_and_detect(file_path: Path, bbox: List[float]):
    """Load image, crop to bbox (0-1), detect face. Returns (embedding, det_score) or None."""
    img = load_image(file_path)
    if img is None:
        return None
    w, h = img.size
    x1 = int(bbox[0] * w)
    y1 = int(bbox[1] * h)
    x2 = int(bbox[2] * w)
    y2 = int(bbox[3] * h)
    x1, x2 = max(0, min(x1, x2)), min(w, max(x1, x2))
    y1, y2 = max(0, min(y1, y2)), min(h, max(y1, y2))
    if x2 - x1 < 20 or y2 - y1 < 20:
        return None
    crop = img.crop((x1, y1, x2, y2))
    faces = detect_faces(crop)
    if not faces:
        return None
    best = max(faces, key=lambda x: x[2])
    return best[1], best[2]  # embedding, score


def _crop_and_detect_all(file_path: Path, bbox: List[float]):
    """
    Load image, crop to bbox (0-1), detect ALL faces.
    If no faces (e.g. pet, object), use CLIP embedding on the crop.
    Returns list of (bbox_orig_norm, embedding, det_score) for each face/region.
    bbox_orig_norm is [x1,y1,x2,y2] in 0-1 relative to original image.
    """
    img = load_image(file_path)
    if img is None:
        return []
    w, h = img.size
    cx1 = int(bbox[0] * w)
    cy1 = int(bbox[1] * h)
    cx2 = int(bbox[2] * w)
    cy2 = int(bbox[3] * h)
    # Add ~15% padding so detector has more context (reduces "no face" errors)
    pad_x = max(20, int(0.15 * (cx2 - cx1)))
    pad_y = max(20, int(0.15 * (cy2 - cy1)))
    cx1 = max(0, cx1 - pad_x)
    cy1 = max(0, cy1 - pad_y)
    cx2 = min(w, cx2 + pad_x)
    cy2 = min(h, cy2 + pad_y)
    cx1, cx2 = max(0, min(cx1, cx2)), min(w, max(cx1, cx2))
    cy1, cy2 = max(0, min(cy1, cy2)), min(h, max(cy1, cy2))
    if cx2 - cx1 < 20 or cy2 - cy1 < 20:
        return []
    crop = img.crop((cx1, cy1, cx2, cy2))
    faces = detect_faces(crop)
    if faces:
        crop_w, crop_h = crop.size
        out = []
        for face_bbox, embedding, score in faces:
            fx1, fy1, fx2, fy2 = face_bbox[0], face_bbox[1], face_bbox[2], face_bbox[3]
            ox1, oy1 = cx1 + fx1, cy1 + fy1
            ox2, oy2 = cx1 + fx2, cy1 + fy2
            norm = [ox1 / w, oy1 / h, ox2 / w, oy2 / h]
            norm = [max(0, min(norm[0], norm[2])), max(0, min(norm[1], norm[3])),
                    min(1, max(norm[0], norm[2])), min(1, max(norm[1], norm[3]))]
            out.append((norm, embedding, float(score)))
        return out
    # No human face — use CLIP for region (pet, object, etc.)
    try:
        embedding = embed_region(crop)
    except Exception:
        return []
    bbox_norm = [bbox[0], bbox[1], bbox[2], bbox[3]]
    return [(bbox_norm, embedding, 0.5)]  # det_score=0.5 marks "region" (not face)


@router.post("/faces-from-region", response_model=FacesFromRegionOut)
def search_faces_from_region(
    body: FaceFromRegionIn,
    top_k: int = 10,
    session: Session = Depends(get_session),
):
    """Select a region; returns ALL faces detected, each with similar people. Add each to their person."""
    f = session.get(FileModel, body.file_id)
    if not f or not Path(f.path).exists():
        raise HTTPException(404, "File not found")
    if f.file_type != "photo":
        raise HTTPException(400, "Only photos supported")

    detected = _crop_and_detect_all(Path(f.path), body.bbox)
    if not detected:
        raise HTTPException(422, "No faces detected in selected region")

    index, face_ids = _get_index(session)
    face_results = []
    for bbox_norm, embedding, score in detected:
        suggestions = []
        if face_ids:
            matches = index.search(embedding, top_k)
            for face_id, sim in matches:
                face = session.get(Face, face_id)
                if face is None:
                    continue
                suggestions.append(SearchResult(
                    cluster_id=face.cluster_id,
                    face_id=face_id,
                    similarity=round(sim, 4),
                    file_id=face.file_id,
                    thumbnail_path=face.file.thumbnail_path if face.file else None,
                    exif_date=face.file.exif_date if face.file else None,
                ))
        emb_b64 = base64.b64encode(embedding.astype(np.float32).tobytes()).decode()
        face_results.append(FaceInRegionOut(bbox=bbox_norm, det_score=score, suggestions=suggestions, embedding_b64=emb_b64))

    return FacesFromRegionOut(faces=face_results)


@router.post("/face-from-region", response_model=List[SearchResult])
def search_by_face_region(
    body: FaceFromRegionIn,
    top_k: int = 20,
    session: Session = Depends(get_session),
):
    """Select a region in a photo; returns similar faces. Use to find/add person without re-indexing."""
    f = session.get(FileModel, body.file_id)
    if not f or not Path(f.path).exists():
        raise HTTPException(404, "File not found")
    if f.file_type != "photo":
        raise HTTPException(400, "Only photos supported")

    result = _crop_and_detect(Path(f.path), body.bbox)
    if result is None:
        raise HTTPException(422, "No face detected in selected region")
    query_embedding, _ = result

    index, face_ids = _get_index(session)
    if not face_ids:
        return []

    matches = index.search(query_embedding, top_k)
    results: List[SearchResult] = []
    for face_id, sim in matches:
        face = session.get(Face, face_id)
        if face is None:
            continue
        results.append(SearchResult(
            cluster_id=face.cluster_id,
            face_id=face_id,
            similarity=round(sim, 4),
            file_id=face.file_id,
            thumbnail_path=face.file.thumbnail_path if face.file else None,
            exif_date=face.file.exif_date if face.file else None,
        ))
    return results


@router.post("/recluster")
def trigger_recluster(
    background_tasks: BackgroundTasks,
    algorithm: str = "hdbscan",
    eps: float = 0.4,
    min_samples: int = 2,
):
    """Trigger face re-clustering in the background."""
    global _index_cache
    _index_cache = None  # invalidate cache after recluster

    from clustering.cluster_faces import cluster_faces
    background_tasks.add_task(cluster_faces, algorithm, eps, min_samples)
    return {"status": "recluster started", "algorithm": algorithm}


@router.post("/invalidate-index")
def invalidate_index():
    """Invalidate the in-memory HNSW index (call after indexing new photos)."""
    global _index_cache
    _index_cache = None
    return {"status": "index invalidated"}
