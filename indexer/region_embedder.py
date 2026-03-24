"""
CLIP-based embedding for image regions (crops) when no human face is detected.
Used for pets, objects, documents, etc.
"""
from __future__ import annotations

import numpy as np
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from PIL import Image

_model = None
_preprocess = None


def _get_clip():
    """Lazy-load CLIP model (ViT-B-32, 512 dim)."""
    global _model, _preprocess
    if _model is not None:
        return _model, _preprocess
    import open_clip
    import torch
    _model, _, _preprocess = open_clip.create_model_and_transforms(
        "ViT-B-32", pretrained="openai"
    )
    _model.eval()
    return _model, _preprocess


def embed_region(crop: "Image.Image") -> np.ndarray:
    """
    Extract 512-dim embedding from an image crop (PIL Image).
    For use when detect_faces returns nothing (pets, objects, etc.).
    """
    import torch
    model, preprocess = _get_clip()
    if crop.mode != "RGB":
        crop = crop.convert("RGB")
    img_tensor = preprocess(crop).unsqueeze(0)
    with torch.no_grad():
        emb = model.encode_image(img_tensor)
        emb = emb / emb.norm(dim=-1, keepdim=True)
    return emb.squeeze(0).float().numpy().astype(np.float32)


def embed_full_image(path: Path) -> np.ndarray | None:
    """
    Extract 512-dim CLIP embedding from a full image file.
    For álbums/recuerdos de documentos (sin caras): similitud visual por CLIP.
    """
    from PIL import Image
    try:
        img = Image.open(path).convert("RGB")
    except Exception:
        return None
    return embed_region(img)
