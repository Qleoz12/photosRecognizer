"""
Directory watcher: automatically indexes new/modified photos and videos.
Uses watchdog to detect filesystem events.

Usage:
    python -m indexer.watcher --root /path/to/photos
"""
import argparse
import time
from pathlib import Path

from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler, FileCreatedEvent, FileModifiedEvent

from .scanner import get_file_type, compute_hash
from .face_detector import detect_faces, load_image
from .video_extractor import extract_frames
from .embeddings_store import upsert_file, add_face, delete_faces_for_file
from .exif_reader import extract_exif
from .thumbnail import make_thumbnail
from .db import get_engine
from sqlalchemy.orm import Session


class PhotoHandler(FileSystemEventHandler):
    def __init__(self, engine):
        self.engine = engine

    def on_created(self, event):
        if not event.is_directory:
            self._handle(Path(event.src_path))

    def on_modified(self, event):
        if not event.is_directory:
            self._handle(Path(event.src_path))

    def _handle(self, fpath: Path):
        ftype = get_file_type(fpath)
        if ftype is None:
            return
        print(f"[watcher] Processing: {fpath}")
        try:
            with Session(self.engine) as session:
                from .run import _process_file
                _process_file(session, fpath, ftype)
                session.commit()
        except Exception as exc:
            print(f"[watcher] Error processing {fpath}: {exc}")


def watch(root: Path):
    engine = get_engine()
    handler = PhotoHandler(engine)
    observer = Observer()
    observer.schedule(handler, str(root), recursive=True)
    observer.start()
    print(f"[watcher] Watching {root} for new files. Press Ctrl+C to stop.")
    try:
        while True:
            time.sleep(2)
    except KeyboardInterrupt:
        observer.stop()
    observer.join()


def main():
    parser = argparse.ArgumentParser(description="Watch directory for new photos/videos")
    parser.add_argument("--root", required=True)
    args = parser.parse_args()
    watch(Path(args.root))


if __name__ == "__main__":
    main()
