"""
Face detection and embedding extraction using InsightFace.
Supports CPU and optionally AMD GPU via DirectML (Windows) or ROCm (Linux).
"""
import sys
import numpy as np
from pathlib import Path
from typing import List, Tuple

try:
    from PIL import Image
except ImportError:
    Image = None

_app = None  # InsightFace FaceAnalysis singleton


def _get_app(providers: list[str] | None = None):
    global _app
    if _app is not None:
        return _app

    import insightface
    from insightface.app import FaceAnalysis

    if providers is None:
        providers = _detect_providers()

    _app = FaceAnalysis(name="buffalo_l", providers=providers)
    _app.prepare(ctx_id=0, det_size=(640, 640))
    return _app


def _detect_providers() -> list[str]:
    """Auto-detect best ONNX provider."""
    try:
        import onnxruntime as ort
        available = ort.get_available_providers()
        # Prefer DirectML on Windows AMD, then CUDA, then CPU
        for prov in ["DmlExecutionProvider", "CUDAExecutionProvider", "CPUExecutionProvider"]:
            if prov in available:
                return [prov]
    except Exception:
        pass
    return ["CPUExecutionProvider"]


FaceResult = Tuple[List[float], np.ndarray, float]
# (bbox [x1,y1,x2,y2], embedding float32[512], det_score)


def detect_faces(image: "Image.Image") -> List[FaceResult]:
    """
    Detect all faces in a PIL Image.
    Returns list of (bbox, embedding, score).
    """
    app = _get_app()
    img_rgb = np.array(image.convert("RGB"))
    # InsightFace expects BGR
    img_bgr = img_rgb[:, :, ::-1]

    faces = app.get(img_bgr)
    results: List[FaceResult] = []
    for face in faces:
        bbox = face.bbox.tolist()  # [x1, y1, x2, y2]
        embedding = face.normed_embedding.astype(np.float32)
        score = float(face.det_score)
        results.append((bbox, embedding, score))

    return results


def load_image(path: Path) -> "Image.Image | None":
    """Load photo from disk, handling HEIC and applying EXIF rotation."""
    try:
        suffix = path.suffix.lower()
        if suffix in {".heic", ".heif"}:
            try:
                from pillow_heif import register_heif_opener
                register_heif_opener()
            except ImportError:
                return None
        img = Image.open(path)
        img.load()
        # Apply EXIF orientation so the image is always upright
        img = _apply_exif_orientation(img)
        return img
    except Exception:
        return None


def _apply_exif_orientation(img: "Image.Image") -> "Image.Image":
    """Rotate/flip image according to its EXIF orientation tag."""
    try:
        from PIL import ImageOps
        return ImageOps.exif_transpose(img)
    except Exception:
        return img
