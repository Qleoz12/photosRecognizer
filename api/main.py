"""
FastAPI application entry point.
Serves the API and optionally the React frontend static files.
"""
import logging
import os
from pathlib import Path

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from api.routers import people, photos, search

FRONTEND_DIST = Path(__file__).parent.parent / "frontend" / "dist"
THUMBNAILS_DIR = Path(__file__).parent.parent / "data" / "thumbnails"

app = FastAPI(
    title="PhotosRecognizer API",
    description="Local face recognition photo search",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5892", "http://localhost:5173", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(people.router)
app.include_router(photos.router)
app.include_router(search.router)

# Serve thumbnails as static files
THUMBNAILS_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/thumbnails", StaticFiles(directory=str(THUMBNAILS_DIR)), name="thumbnails")

# Serve cropped face thumbnail (bbox: x1,y1,x2,y2 normalized 0-1)
@app.get("/originals/{file_id}/crop")
def serve_face_crop(file_id: int, bbox: str):
    """Crop a region of the image. bbox=x1,y1,x2,y2 (0-1 normalized)."""
    from api.deps import get_engine_cached
    from sqlalchemy.orm import Session
    from indexer.db import File
    from fastapi import HTTPException
    from fastapi.responses import Response
    from PIL import Image, ImageOps
    import io

    parts = bbox.split(",")
    if len(parts) != 4:
        raise HTTPException(400, "bbox must be x1,y1,x2,y2")
    try:
        x1, y1, x2, y2 = [float(p.strip()) for p in parts]
    except ValueError:
        raise HTTPException(400, "bbox values must be numbers")
    x1, x2 = max(0, min(x1, x2)), min(1, max(x1, x2))
    y1, y2 = max(0, min(y1, y2)), min(1, max(y1, y2))
    if x2 - x1 < 0.01 or y2 - y1 < 0.01:
        raise HTTPException(400, "bbox too small")

    with Session(get_engine_cached()) as session:
        f = session.get(File, file_id)
        if not f or not Path(f.path).exists():
            raise HTTPException(404, "File not found")
        if f.file_type != "photo":
            raise HTTPException(400, "Only photos supported")
        fpath_str = f.path
    fpath = Path(fpath_str)
    try:
        img = Image.open(str(fpath))
        img.load()
        img = ImageOps.exif_transpose(img)
        if img.mode in ("RGBA", "P", "LA"):
            img = img.convert("RGB")
        w, h = img.size
        px1 = int(x1 * w)
        py1 = int(y1 * h)
        px2 = int(x2 * w)
        py2 = int(y2 * h)
        px1, px2 = max(0, min(px1, px2)), min(w, max(px1, px2))
        py1, py2 = max(0, min(py1, py2)), min(h, max(py1, py2))
        if px2 - px1 < 10 or py2 - py1 < 10:
            raise HTTPException(400, "Crop too small")
        crop = img.crop((px1, py1, px2, py2))
        buf = io.BytesIO()
        crop.save(buf, format="JPEG", quality=88)
        return Response(content=buf.getvalue(), media_type="image/jpeg")
    except Exception as e:
        raise HTTPException(422, "Cannot crop image")


# Serve cropped face by face_id (uses face's file + bbox)
@app.get("/faces/{face_id}/crop")
def serve_face_crop_by_id(face_id: int):
    """Serve cropped thumbnail for a face. Works for photos; videos may fall back to full thumbnail."""
    from api.deps import get_engine_cached
    from sqlalchemy.orm import Session
    from indexer.db import File, Face
    from fastapi import HTTPException
    from fastapi.responses import Response
    from PIL import Image, ImageOps
    import json
    import io

    with Session(get_engine_cached()) as session:
        face = session.get(Face, face_id)
        if not face:
            raise HTTPException(404, "Face not found")
        f = face.file
        if not f or not Path(f.path).exists():
            raise HTTPException(404, "File not found")
        if f.file_type != "photo":
            raise HTTPException(400, "Face crop only supported for photos")
        fpath = Path(f.path)
        bbox_px = json.loads(face.bbox_json)
        if len(bbox_px) != 4:
            raise HTTPException(400, "Invalid bbox")

    try:
        img = Image.open(str(fpath))
        img.load()
        img = ImageOps.exif_transpose(img)
        if img.mode in ("RGBA", "P", "LA"):
            img = img.convert("RGB")
        w, h = img.size
        x1, y1, x2, y2 = bbox_px[0], bbox_px[1], bbox_px[2], bbox_px[3]
        x1, x2 = max(0, min(x1, x2)), min(w, max(x1, x2))
        y1, y2 = max(0, min(y1, y2)), min(h, max(y1, y2))
        if x2 - x1 < 10 or y2 - y1 < 10:
            raise HTTPException(400, "Face region too small")
        crop = img.crop((int(x1), int(y1), int(x2), int(y2)))
        buf = io.BytesIO()
        crop.save(buf, format="JPEG", quality=88)
        return Response(
            content=buf.getvalue(),
            media_type="image/jpeg",
            headers={"Cache-Control": "no-cache, no-store, must-revalidate"},
        )
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(422, "Cannot crop face")


# Serve original photos with EXIF orientation corrected
@app.get("/originals/{file_id}")
def serve_original(file_id: int):
    from api.deps import get_engine_cached
    from sqlalchemy.orm import Session
    from indexer.db import File
    from fastapi import HTTPException
    from fastapi.responses import Response
    import io

    with Session(get_engine_cached()) as session:
        f = session.get(File, file_id)
        if not f or not Path(f.path).exists():
            raise HTTPException(404, "File not found")

        fpath = Path(f.path)
        suffix = fpath.suffix.lower()

        # Videos and non-image files: serve raw
        if suffix in {".mp4", ".mov", ".mkv", ".avi", ".m4v", ".3gp", ".wmv"}:
            return FileResponse(str(fpath))

        # Images: apply EXIF orientation before sending
        try:
            from PIL import Image, ImageOps
            img = Image.open(str(fpath))
            img.load()
            img = ImageOps.exif_transpose(img)
            if img.mode in ("RGBA", "P", "LA"):
                img = img.convert("RGB")
            buf = io.BytesIO()
            img.save(buf, format="JPEG", quality=92)
            return Response(content=buf.getvalue(), media_type="image/jpeg")
        except Exception:
            return FileResponse(str(fpath))


# Serve React app in production
if FRONTEND_DIST.exists():
    app.mount("/assets", StaticFiles(directory=str(FRONTEND_DIST / "assets")), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    def serve_spa(full_path: str):
        index = FRONTEND_DIST / "index.html"
        return FileResponse(str(index))
