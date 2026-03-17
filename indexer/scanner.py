"""
Recursive file scanner. Yields photo/video file paths not yet indexed.
Uses mtime+size as fast fingerprint; SHA256 only for changed files.
"""
import hashlib
import os
from pathlib import Path
from typing import Generator, Tuple
from sqlalchemy.orm import Session

from .db import File

PHOTO_EXTENSIONS = {".jpg", ".jpeg", ".jfif", ".png", ".heic", ".heif", ".bmp", ".tiff", ".tif", ".webp", ".gif"}
VIDEO_EXTENSIONS = {".mp4", ".mov", ".mkv", ".avi", ".m4v", ".3gp", ".wmv"}

# Skip hashing files larger than this — use mtime+size fingerprint only
_HASH_SIZE_LIMIT = 50 * 1024 * 1024  # 50 MB


def compute_hash(path: Path, chunk_size: int = 1 << 20) -> str:
    """
    For files <= 50MB: full SHA256.
    For larger files (videos, big photos): fast fingerprint from mtime+size.
    This avoids reading gigabytes of video just to check if it changed.
    """
    try:
        size = path.stat().st_size
        mtime = path.stat().st_mtime
    except OSError:
        size, mtime = 0, 0.0

    if size <= _HASH_SIZE_LIMIT:
        h = hashlib.sha256()
        with open(path, "rb") as f:
            while chunk := f.read(chunk_size):
                h.update(chunk)
        return h.hexdigest()
    else:
        # Fast fingerprint: no disk read needed
        return f"fast:{size}:{mtime:.3f}"


def get_file_type(path: Path) -> str | None:
    ext = path.suffix.lower()
    if ext in PHOTO_EXTENSIONS:
        return "photo"
    if ext in VIDEO_EXTENSIONS:
        return "video"
    return None


def scan_directory(
    root: Path,
    session: Session,
    force_reindex: bool = False,
) -> Generator[Tuple[Path, str], None, None]:
    """
    Walk root recursively, yielding (path, file_type) for files that need indexing.
    Skips files already in DB with matching mtime (fast path).
    """
    existing: dict[str, float] = {
        row.path: row.mtime for row in session.query(File.path, File.mtime)
    }

    for dirpath, _dirs, filenames in os.walk(root):
        for fname in sorted(filenames):  # sorted for reproducible order
            fpath = Path(dirpath) / fname
            ftype = get_file_type(fpath)
            if ftype is None:
                continue

            str_path = str(fpath)
            try:
                mtime = fpath.stat().st_mtime
            except OSError:
                continue

            if not force_reindex and str_path in existing:
                if existing[str_path] == mtime:
                    continue  # unchanged, skip

            yield fpath, ftype
