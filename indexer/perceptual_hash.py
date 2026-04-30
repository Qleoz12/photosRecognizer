"""dHash 64-bit perceptual hash as 16 hex chars (PIL only)."""
from __future__ import annotations

from pathlib import Path


def compute_dhash_hex(path: Path) -> str | None:
    try:
        from PIL import Image
        img = Image.open(path).convert("L").resize((9, 8), Image.Resampling.LANCZOS)
        pixels = list(img.getdata())
        bits = []
        for row in range(8):
            off = row * 9
            for col in range(8):
                bits.append(1 if pixels[off + col] > pixels[off + col + 1] else 0)
        v = 0
        for b in bits:
            v = (v << 1) | b
        return f"{v:016x}"
    except Exception:
        return None
