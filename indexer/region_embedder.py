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
_tokenizer = None


def _get_clip():
    """Lazy-load CLIP model (ViT-B-32, 512 dim)."""
    global _model, _preprocess, _tokenizer
    if _model is not None:
        return _model, _preprocess, _tokenizer
    import open_clip
    _model, _, _preprocess = open_clip.create_model_and_transforms(
        "ViT-B-32", pretrained="openai"
    )
    _tokenizer = open_clip.get_tokenizer("ViT-B-32")
    _model.eval()
    return _model, _preprocess, _tokenizer


def embed_region(crop: "Image.Image") -> np.ndarray:
    """
    Extract 512-dim embedding from a PIL Image crop.
    For use when detect_faces returns nothing (pets, objects, etc.).
    """
    import torch
    model, preprocess, _tok = _get_clip()
    if crop.mode != "RGB":
        crop = crop.convert("RGB")
    img_tensor = preprocess(crop).unsqueeze(0)
    with torch.no_grad():
        emb = model.encode_image(img_tensor)
        emb = emb / emb.norm(dim=-1, keepdim=True)
    return emb.squeeze(0).float().numpy().astype(np.float32)


def embed_text_prompts(prompts: list[str]) -> np.ndarray:
    """
    Matriz (N, 512) float32 L2-normalizada por fila — una fila por prompt.
    """
    import torch
    model, _, tokenizer = _get_clip()
    if not prompts:
        return np.zeros((0, 512), dtype=np.float32)
    tokens = tokenizer(prompts)
    with torch.no_grad():
        feats = model.encode_text(tokens)
        feats = feats / feats.norm(dim=-1, keepdim=True)
    return feats.float().cpu().numpy().astype(np.float32)


def embed_full_image(path: Path) -> np.ndarray | None:
    """
    Extract 512-dim CLIP embedding from a full image file.
    For álbumes/recuerdos de documentos (sin caras): similitud visual por CLIP.
    """
    from PIL import Image
    try:
        img = Image.open(path).convert("RGB")
    except Exception:
        return None
    return embed_region(img)
