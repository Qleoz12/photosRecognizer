"""
Thumbnail generation: creates max-300px JPEGs in data/thumbnails/.
Preserves aspect ratio and applies EXIF orientation so photos appear upright.
"""
from pathlib import Path
from typing import Optional

THUMB_MAX = 300
THUMB_DIR = Path(__file__).parent.parent / "data" / "thumbnails"


def make_thumbnail(image, file_path: Path) -> Optional[str]:
    """
    Creates a thumbnail preserving the original aspect ratio.
    Returns the thumbnail path string, or None on failure.
    """
    try:
        from PIL import ImageOps
        THUMB_DIR.mkdir(parents=True, exist_ok=True)
        thumb_name = f"{file_path.stem}_{abs(hash(str(file_path)))}.jpg"
        thumb_path = THUMB_DIR / thumb_name

        img = image.copy()

        # Apply EXIF orientation so portrait photos are upright
        try:
            img = ImageOps.exif_transpose(img)
        except Exception:
            pass

        # Preserve aspect ratio — fit within THUMB_MAX x THUMB_MAX box
        img.thumbnail((THUMB_MAX, THUMB_MAX))

        if img.mode not in ("RGB", "L"):
            img = img.convert("RGB")

        img.save(thumb_path, "JPEG", quality=85)
        return str(thumb_path)
    except Exception:
        return None
