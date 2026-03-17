# PhotosRecognizer

Local face recognition photo search — a self-hosted alternative to Google Photos that works entirely offline.

## Features

- Scans 10,000–100,000+ photos and videos from any local directory
- Detects and embeds faces using **InsightFace** (`buffalo_l` model)
- Groups faces into people clusters automatically with **HDBSCAN**
- Web UI to browse photos by person, view timeline, rename people, merge clusters
- Search by uploading a face photo — finds all matching photos instantly
- AMD GPU acceleration via DirectML (Windows) or ROCm (Linux)
- Incremental indexing — only processes new/changed files

## Requirements

- Python 3.11+
- Node.js 18+
- ffmpeg in PATH (for video frame extraction)
- 4 GB RAM minimum (8 GB recommended)

## Installation

```bash
# 1. Install Python dependencies
pip install -r requirements.txt

# 2. Install frontend dependencies
cd frontend
npm install --ignore-scripts
cd ..
```

## First-Time Setup

```bash
# Index your photos (replace with your actual photos path)
python -m indexer.run --root "D:\Photos" --workers 2

# Cluster the faces
python -m clustering.cluster_faces

# Start the API server
python -m uvicorn api.main:app --host 0.0.0.0 --port 8000

# In another terminal, start the frontend
cd frontend
npm run dev
```

Then open **http://localhost:5173** in your browser.

Or use the batch scripts:

```
index_and_cluster.bat "D:\Photos"
start_api.bat
start_frontend.bat
```

## AMD GPU Acceleration

On **Windows** with AMD GPU, install DirectML backend:

```bash
pip uninstall onnxruntime
pip install onnxruntime-directml
```

On **Linux** with ROCm:

```bash
pip uninstall onnxruntime
pip install onnxruntime-rocm
```

## Re-clustering

After adding more photos, re-index and re-cluster:

```bash
python -m indexer.run --root "D:\Photos"
python -m clustering.cluster_faces
```

Or click **"Re-cluster Faces"** in the web UI.

## Project Structure

```
photosRecognizer/
├── indexer/               # File scanner + face detection pipeline
│   ├── db.py              # SQLAlchemy models (files, faces, clusters)
│   ├── scanner.py         # Recursive file scanner
│   ├── face_detector.py   # InsightFace integration
│   ├── video_extractor.py # ffmpeg frame extraction
│   ├── embeddings_store.py# SQLite CRUD
│   ├── exif_reader.py     # EXIF date/GPS extraction
│   ├── thumbnail.py       # 300px thumbnail generation
│   ├── hnsw_index.py      # Fast ANN search (hnswlib / fallback)
│   ├── watcher.py         # Filesystem watcher for live indexing
│   └── run.py             # Main indexer entry point
├── clustering/
│   └── cluster_faces.py   # HDBSCAN/DBSCAN face clustering
├── api/                   # FastAPI backend
│   ├── main.py
│   ├── models.py          # Pydantic schemas
│   ├── deps.py            # Shared DB session
│   └── routers/
│       ├── people.py      # /people endpoints
│       ├── photos.py      # /photos endpoints
│       └── search.py      # /search/face endpoint
├── frontend/              # React + Vite + Tailwind
│   └── src/
│       ├── pages/         # Gallery, PersonDetail, AllPhotos, Clusters, Search
│       └── components/    # Reusable UI components
└── data/
    ├── photos.db          # SQLite database
    └── thumbnails/        # Generated 300px thumbnails
```

## Performance

| Scale | Index Time (CPU) | Search Time |
|-------|-----------------|-------------|
| 10k files | ~1-2 hours | < 1 second |
| 50k files | ~5-7 hours | < 1 second |
| 100k files | ~10-14 hours | < 1 second |

Indexing is a one-time operation. Use `--workers 4` to parallelize and cut time by ~50%.
