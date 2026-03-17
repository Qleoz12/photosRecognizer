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
from pathlib import Path
from typing import List, Tuple
from concurrent.futures import ProcessPoolExecutor, as_completed

from tqdm import tqdm
from sqlalchemy.orm import Session

from .db import get_engine
from .scanner import scan_directory, compute_hash
from .face_detector import detect_faces, load_image
from .video_extractor import extract_frames
from .embeddings_store import upsert_file, add_face, delete_faces_for_file
from .exif_reader import extract_exif
from .thumbnail import make_thumbnail

DEFAULT_PHOTOS_DIR = Path(__file__).parent.parent / "data" / "photos"


def index_photos(root: Path, force: bool = False, workers: int = 2):
    engine = get_engine()

    print(f"Scanning {root} for new/changed files...")
    with Session(engine) as session:
        files_to_index: List[Tuple[Path, str]] = list(
            scan_directory(root, session, force_reindex=force)
        )

    total = len(files_to_index)
    if total == 0:
        print("Nothing new to index.")
        return

    photos = sum(1 for _, t in files_to_index if t == "photo")
    videos = sum(1 for _, t in files_to_index if t == "video")
    print(f"Found {total:,} files to index ({photos:,} photos, {videos:,} videos).")

    # Estimate time: ~1.5s per photo, ~8s per video on CPU
    est_seconds = (photos * 1.5 + videos * 8) / max(workers, 1)
    est_h = int(est_seconds // 3600)
    est_m = int((est_seconds % 3600) // 60)
    if est_h > 0:
        print(f"Estimated time (~{workers} worker{'s' if workers > 1 else ''}): {est_h}h {est_m}m")
    else:
        print(f"Estimated time (~{workers} worker{'s' if workers > 1 else ''}): {est_m}m")
    print("You can stop and resume at any time — already indexed files are skipped.")

    errors = 0
    if workers > 1:
        errors = _index_parallel(files_to_index, workers)
    else:
        errors = _index_sequential(files_to_index)

    msg = f"Indexing complete. {total - errors:,} processed"
    if errors:
        msg += f", {errors} errors (see warnings above)"
    print(msg)


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
            print(f"\n[WARN] Skipping {fpath.name}: {exc}", file=sys.stderr)
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
                    print(f"\n[WARN] {Path(futures[future]).name}: {err}", file=sys.stderr)
                pbar.update(1)
    return errors


def _process_file(session: Session, fpath: Path, ftype: str):
    mtime = fpath.stat().st_mtime
    file_hash = compute_hash(fpath)

    if ftype == "photo":
        image = load_image(fpath)
        if image is None:
            return

        exif_date, exif_lat, exif_lon = extract_exif(fpath)
        thumbnail_path = make_thumbnail(image, fpath)
        width, height = image.size

        file_obj = upsert_file(
            session,
            path=str(fpath),
            file_hash=file_hash,
            mtime=mtime,
            file_type="photo",
            exif_date=exif_date,
            exif_lat=exif_lat,
            exif_lon=exif_lon,
            thumbnail_path=thumbnail_path,
            width=width,
            height=height,
        )
        delete_faces_for_file(session, file_obj.id)
        for bbox, embedding, score in detect_faces(image):
            add_face(session, file_obj.id, bbox, embedding, score)

    elif ftype == "video":
        file_obj = upsert_file(
            session,
            path=str(fpath),
            file_hash=file_hash,
            mtime=mtime,
            file_type="video",
        )
        delete_faces_for_file(session, file_obj.id)
        for _ts, frame_img in extract_frames(fpath):
            for bbox, embedding, score in detect_faces(frame_img):
                add_face(session, file_obj.id, bbox, embedding, score)
            if file_obj.thumbnail_path is None:
                file_obj.thumbnail_path = make_thumbnail(frame_img, fpath)


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
    args = parser.parse_args()

    root = Path(args.root)
    if not root.exists():
        if str(root) == str(DEFAULT_PHOTOS_DIR):
            root.mkdir(parents=True, exist_ok=True)
            print(f"Created folder: {root}")
            print("Copy your photos/videos into data/photos/ and run again.")
            sys.exit(0)
        else:
            print(f"Error: directory does not exist: {root}")
            sys.exit(1)

    index_photos(root, force=args.force, workers=args.workers)


if __name__ == "__main__":
    main()
