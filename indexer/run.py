"""
Main indexer pipeline. Orchestrates scanning, face detection, and DB storage.

Usage:
    python -m indexer.run                          # scans data/photos/ by default
    python -m indexer.run --root /path/to/photos
    python -m indexer.run --workers 4 --force
"""
import argparse
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import List, Tuple
from concurrent.futures import ProcessPoolExecutor, as_completed

from tqdm import tqdm
from sqlalchemy.orm import Session

from .db import get_engine, File
from .scanner import scan_directory, compute_hash, compute_content_hash
from .face_detector import detect_faces, load_image
from .video_extractor import extract_frames, get_video_metadata
from .embeddings_store import upsert_file, add_face, delete_faces_for_file, find_by_content_hash, find_by_file_hash, update_file_path
from .exif_reader import extract_exif
from .thumbnail import make_thumbnail

DEFAULT_PHOTOS_DIR = Path(__file__).parent.parent / "data" / "photos"


def _log(msg: str, file=sys.stdout) -> None:
    """Print with timestamp YYYY-MM-DD HH:MM:SS for log clarity."""
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    print(f"[{ts}] {msg}", file=file, flush=True)


def update_paths(old_root: str, new_root: str) -> int:
    """
    Update all file paths in DB when moving to a new disk/directory.
    Replaces old_root prefix with new_root. Returns count of updated rows.
    Handles both / and \\ in paths.
    """
    engine = get_engine()
    from sqlalchemy import text

    old_clean = str(Path(old_root).resolve()).replace("\\", "/").rstrip("/")
    new_clean = str(Path(new_root).resolve()).replace("\\", "/").rstrip("/")

    with engine.connect() as conn:
        rows = conn.execute(text("SELECT id, path FROM files")).fetchall()
        count = 0
        for fid, path in rows:
            path_norm = path.replace("\\", "/")
            if path_norm.startswith(old_clean + "/") or path_norm == old_clean:
                new_path = new_clean + path_norm[len(old_clean) :]
                if "\\" in path:
                    new_path = new_path.replace("/", "\\")
                conn.execute(text("UPDATE files SET path = :p WHERE id = :id"), {"p": new_path, "id": fid})
                count += 1
        conn.commit()
    return count


def index_photos(root: Path, force: bool = False, workers: int = 2):
    engine = get_engine()

    _log(f"Scanning {root} for new/changed files...")
    with Session(engine) as session:
        files_to_index: List[Tuple[Path, str]] = list(
            scan_directory(root, session, force_reindex=force)
        )

    total = len(files_to_index)
    if total == 0:
        _log("Nothing new to index.")
        return

    photos = sum(1 for _, t in files_to_index if t == "photo")
    videos = sum(1 for _, t in files_to_index if t == "video")
    _log(f"Found {total:,} files to index ({photos:,} photos, {videos:,} videos).")

    # Estimate time: ~1.5s per photo, ~8s per video on CPU
    est_seconds = (photos * 1.5 + videos * 8) / max(workers, 1)
    est_h = int(est_seconds // 3600)
    est_m = int((est_seconds % 3600) // 60)
    if est_h > 0:
        _log(f"Estimated time (~{workers} worker{'s' if workers > 1 else ''}): {est_h}h {est_m}m")
    else:
        _log(f"Estimated time (~{workers} worker{'s' if workers > 1 else ''}): {est_m}m")
    _log("You can stop and resume at any time — already indexed files are skipped.")

    errors = 0
    if workers > 1:
        errors = _index_parallel(files_to_index, workers)
    else:
        errors = _index_sequential(files_to_index)

    msg = f"Indexing complete. {total - errors:,} processed"
    if errors:
        msg += f", {errors} errors (see warnings above)"
    _log(msg)


def _index_sequential(files: List[Tuple[Path, str]]) -> int:
    engine = get_engine()
    errors = 0
    for fpath, ftype in tqdm(files, unit="file", desc="Indexing", dynamic_ncols=True):
        try:
            with Session(engine) as session:
                _process_file(session, fpath, ftype)
                session.commit()
        except Exception as exc:
            errors += 1
            _log(f"[WARN] Skipping {fpath.name}: {exc}", file=sys.stderr)
    return errors


def _process_one(args: Tuple[str, str]) -> Tuple[str, bool, str]:
    """Worker subprocess: process a single file."""
    fpath_str, ftype = args
    fpath = Path(fpath_str)
    try:
        engine = get_engine()
        with Session(engine) as session:
            _process_file(session, fpath, ftype)
            session.commit()
        return fpath_str, True, ""
    except Exception as exc:
        return fpath_str, False, str(exc)


def _index_parallel(files: List[Tuple[Path, str]], workers: int) -> int:
    args = [(str(f), t) for f, t in files]
    errors = 0
    with ProcessPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(_process_one, a): a[0] for a in args}
        with tqdm(total=len(args), unit="file", desc="Indexing", dynamic_ncols=True) as pbar:
            for future in as_completed(futures):
                _, success, err = future.result()
                if not success:
                    errors += 1
                    _log(f"[WARN] {Path(futures[future]).name}: {err}", file=sys.stderr)
                pbar.update(1)
    return errors


def _process_file(session: Session, fpath: Path, ftype: str):
    mtime = fpath.stat().st_mtime
    file_hash = compute_hash(fpath)
    str_path = str(fpath)

    # Skip re-processing if file was moved: same content, different path
    content_hash = compute_content_hash(fpath)
    existing = None
    if content_hash:
        existing = find_by_content_hash(session, content_hash, ftype)
    if not existing and not file_hash.startswith("fast:"):
        # Small file: file_hash is content-based; try for old records without content_hash
        existing = find_by_file_hash(session, file_hash, ftype)
    if existing and existing.path != str_path:
        update_file_path(session, existing.id, str_path, mtime)
        if content_hash and not existing.content_hash:
            session.query(File).filter_by(id=existing.id).update({"content_hash": content_hash})
            session.flush()
        return  # already analyzed, just updated path

    if ftype == "photo":
        image = load_image(fpath)
        if image is None:
            return

        exif_date, exif_lat, exif_lon = extract_exif(fpath)
        thumbnail_path = make_thumbnail(image, fpath)
        width, height = image.size

        file_obj = upsert_file(
            session,
            path=str_path,
            file_hash=file_hash,
            mtime=mtime,
            file_type="photo",
            exif_date=exif_date,
            exif_lat=exif_lat,
            exif_lon=exif_lon,
            thumbnail_path=thumbnail_path,
            width=width,
            height=height,
            content_hash=content_hash,
        )
        delete_faces_for_file(session, file_obj.id)
        for bbox, embedding, score in detect_faces(image):
            add_face(session, file_obj.id, bbox, embedding, score)

    elif ftype == "video":
        meta = get_video_metadata(fpath)
        file_obj = upsert_file(
            session,
            path=str_path,
            file_hash=file_hash,
            mtime=mtime,
            file_type="video",
            duration=meta.get("duration"),
            width=meta.get("width"),
            height=meta.get("height"),
            content_hash=content_hash,
        )
        delete_faces_for_file(session, file_obj.id)
        first_thumb = None
        for _ts, frame_img in extract_frames(fpath):
            for bbox, embedding, score in detect_faces(frame_img):
                add_face(session, file_obj.id, bbox, embedding, score)
            if first_thumb is None:
                first_thumb = make_thumbnail(frame_img, fpath)
        # Always set thumbnail (even if no faces detected)
        if first_thumb:
            file_obj.thumbnail_path = first_thumb


def main():
    parser = argparse.ArgumentParser(description="Index photos/videos for face recognition")
    parser.add_argument(
        "--root",
        default=str(DEFAULT_PHOTOS_DIR),
        help="Root directory to scan (default: data/photos/)",
    )
    parser.add_argument("--force", action="store_true", help="Re-index all files")
    parser.add_argument(
        "--workers",
        type=int,
        default=2,
        help="Parallel workers (default: 2). Use 1 for low RAM machines.",
    )
    parser.add_argument(
        "--update-paths",
        nargs=2,
        metavar=("OLD", "NEW"),
        help="Update paths in DB: replace OLD root with NEW (e.g. after moving disk)",
    )
    args = parser.parse_args()

    if args.update_paths:
        old_r, new_r = args.update_paths
        _log(f"Updating paths: {old_r!r} -> {new_r!r}")
        n = update_paths(old_r, new_r)
        _log(f"Updated {n:,} file paths.")
        return

    root = Path(args.root)
    if not root.exists():
        if str(root) == str(DEFAULT_PHOTOS_DIR):
            root.mkdir(parents=True, exist_ok=True)
            _log(f"Created folder: {root}")
            _log("Copy your photos/videos into data/photos/ and run again.")
            sys.exit(0)
        else:
            _log(f"Error: directory does not exist: {root}")
            sys.exit(1)

    index_photos(root, force=args.force, workers=args.workers)


if __name__ == "__main__":
    main()
