"""
Pydantic response models for the API.
"""
from datetime import datetime
from typing import Optional, List
from pydantic import BaseModel


class FaceOut(BaseModel):
    id: int
    file_id: Optional[int] = None  # file this face belongs to
    bbox: List[float]
    det_score: Optional[float]
    cluster_id: Optional[int]
    is_canonical: bool = True  # True = usado para centroide (comparaciones)

    class Config:
        from_attributes = True


class SetFaceCanonicalIn(BaseModel):
    face_id: int
    is_canonical: bool


class FileOut(BaseModel):
    id: int
    path: str
    file_type: str
    exif_date: Optional[datetime]
    exif_lat: Optional[float]
    exif_lon: Optional[float]
    file_modified: Optional[str] = None  # ISO datetime from mtime (when file was last modified)
    thumbnail_path: Optional[str]
    width: Optional[int]
    height: Optional[int]
    duration: Optional[float] = None  # seconds, for videos
    faces: List[FaceOut] = []
    archived: bool = False
    perceptual_hash: Optional[str] = None

    class Config:
        from_attributes = True


class FileUpdateIn(BaseModel):
    """Update photo metadata (e.g. set date manually when EXIF is missing)."""
    exif_date: Optional[datetime] = None


class ArchiveIdsIn(BaseModel):
    file_ids: List[int]


class BulkExifYearIn(BaseModel):
    """Asignar el mismo año (fecha EXIF interna: 1 jul mediodía) a varios archivos."""
    file_ids: List[int]
    year: int


class PinVerifyIn(BaseModel):
    pin: str


class ClusterOut(BaseModel):
    id: int
    label: Optional[str]
    size: int
    cover_face_id: Optional[int]
    cover_thumbnail: Optional[str] = None  # injected by route
    is_manual: bool = False  # True = protected from auto re-clustering
    is_hidden: bool = False  # True = no aparece en listado principal

    class Config:
        from_attributes = True


class ClusterSimilarOut(ClusterOut):
    """Cluster with similarity score (0–1, higher = more similar)."""
    similarity: float


class ClusterUpdateIn(BaseModel):
    label: Optional[str] = None
    cover_face_id: Optional[int] = None
    is_hidden: Optional[bool] = None


class MergeClustersIn(BaseModel):
    source_id: int
    target_id: int


class CreateClusterIn(BaseModel):
    label: Optional[str] = None


class AddFaceIn(BaseModel):
    """Region in a photo to add as a face. bbox: [x1,y1,x2,y2] normalized 0-1."""
    file_id: int
    bbox: List[float]  # [x1, y1, x2, y2] in 0-1 range
    embedding_b64: Optional[str] = None  # when from faces-from-region, skip re-detect
    det_score: Optional[float] = None


class AssignFaceIn(BaseModel):
    """Assign an existing face to a person (cluster)."""
    face_id: int


class SearchResult(BaseModel):
    cluster_id: Optional[int]
    face_id: int
    similarity: float
    file_id: int
    thumbnail_path: Optional[str]
    exif_date: Optional[datetime]


class FaceInRegionOut(BaseModel):
    """One face detected in a crop, with suggestions and bbox for adding."""
    bbox: List[float]  # [x1,y1,x2,y2] normalized 0-1 in original image
    det_score: float
    suggestions: List[SearchResult]
    embedding_b64: Optional[str] = None  # base64 of float32[512], for add-face without re-detect


class FacesFromRegionOut(BaseModel):
    """Multiple faces detected in a region."""
    faces: List[FaceInRegionOut]
