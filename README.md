# PhotosRecognizer

Reconocimiento facial local para fotos y videos — alternativa a Google Photos que funciona 100% offline.

## Uso rápido

1. **Copia** tus fotos y videos en `data/photos/` (puedes usar subcarpetas: 2016, 2025, etc.)
2. **Ejecuta** `photos_db.bat` (o `index_and_cluster.bat`, hace lo mismo) — opcional: `photos_db.bat "D:\Mis Fotos"` o `photos_db.bat "D:\Mis Fotos" 4` para más workers
3. **Inicia** la app con `start.bat` y abre **http://localhost:5892**

📖 **Instrucciones completas en español:** [INSTRUCCIONES.md](INSTRUCCIONES.md)

### Mover a otro disco

| Situación | Qué hacer |
|-----------|-----------|
| Mover proyecto completo, conservar indexado | `update_paths.bat "RUTA_VIEJA\data\photos" "RUTA_NUEVA\data\photos"` |
| Pegar carpetas nuevas en data/photos | `photos_db.bat` (incremental) |
| Empezar de cero (nueva BD + reindex) | `photos_db.bat recreate` |
| Copia de seguridad de la BD sin reindexar | `photos_db.bat snapshot` |
| SQLite dañado (`.recover`) | `photos_db.bat recover "entrada.db"` |

---

## Características

- Escanea 10.000–100.000+ fotos y videos desde cualquier carpeta local
- Detecta y agrupa caras con **InsightFace** (modelo `buffalo_l`)
- Agrupa personas automáticamente con **HDBSCAN**
- Web UI: personas, All Photos, Videos, Recuerdos, Álbumes, búsqueda por cara
- Soporte completo para videos (thumbnails, duración, detección de caras en frames)
- Aceleración GPU AMD (DirectML en Windows, ROCm en Linux)
- Indexación incremental — solo procesa archivos nuevos o modificados

### Buscar similares (Álbumes y Recuerdos)

En un álbum o recuerdo puedes usar **"Buscar similares aquí"** para encontrar fotos parecidas sin salir a la galería. Hay dos modos:

| Modo | Para qué sirve | Cómo funciona | Tiempo aprox. |
|------|----------------|---------------|---------------|
| **Contenido (documentos)** | Documentos, papeles, IDs, facturas, radiografías | Usa **CLIP**: calcula un embedding por cada foto del pool | ~1 min (200 fotos) |
| **Caras** | Personas, retratos | Usa **embeddings de rostros** ya guardados en la base de datos | < 5 s (5.000 fotos) |

**¿Por qué CLIP es más lento?** El modo documentos usa el modelo CLIP para representar el contenido de cada imagen. No hay embeddings precalculados — cada foto del pool se procesa en ese momento.

**Cache en base de datos:** Los resultados (positivos y negativos) se guardan en `album_search_cache` y `memory_search_cache`. Cada request procesa como mucho 100 fotos nuevas; el resto se lee del cache. Así puedes ir procesando toda la colección de a poco: la primera búsqueda tarda ~30 s (100 CLIP), las siguientes son casi instantáneas si las fotos ya están en cache. Al cambiar el contenido del álbum/recuerdo, el cache se invalida automáticamente.

**Cluster del álbum:** En el modal verás miniaturas de las fotos que definen la búsqueda (las del álbum/recuerdo). Si quieres cambiar qué se usa, quita fotos que no deban influir y vuelve a buscar.

## Requisitos

- Python 3.11+
- Node.js 18+
- ffmpeg en PATH (para extraer frames de videos)
- 4 GB RAM mínimo (8 GB recomendado para muchos archivos)

## Instalación (primera vez)

```batch
pip install -r requirements.txt
cd frontend
npm install --ignore-scripts
copy .env.example .env
cd ..
```

## Scripts de Windows

### `photos_db.bat` — base de datos e indexado (un solo script)

| Comando | Qué hace |
|---------|-----------|
| `photos_db.bat` | **Por defecto:** indexado **incremental** (solo archivos nuevos o cambiados), luego **cluster** de rostros. Cierra procesos Python, mueve `wal/shm` viejos a `data/db_backup/wal_*` (no borra la BD). |
| `photos_db.bat 4` | Igual con **4 workers** en paralelo. |
| `photos_db.bat "D:\Fotos"` | Raíz de fotos distinta de `data/photos/`. |
| `photos_db.bat "D:\Fotos" 4` | Raíz + workers. |
| `photos_db.bat recreate` | **Mueve** `photos.db` + wal + shm a `data/db_backup/backup_<fecha>/` y crea una **BD nueva**; **reindexa todo** (`--force`) y vuelve a agrupar caras. |
| `photos_db.bat recreate 4` / `recreate "Ruta" 4` | `recreate` con workers y/o carpeta. |
| `photos_db.bat snapshot` | **Copia** la BD a `data/db_backup/snapshot_<fecha>/` sin reindexar (mejor con API cerrada). |
| `photos_db.bat recover "mala.db"` | **SQLite `.recover`** → `data/photos_recovered.db`. |
| `photos_db.bat recover "mala.db" "salida.db"` | Salida explícita. |
| `photos_db.bat help` | Ayuda en consola. |

`index_and_cluster.bat` es un **alias** de `photos_db.bat` (misma sintaxis que las cuatro primeras filas).

### Otros `.bat`

| Script | Descripción |
|--------|-------------|
| `setup.bat` | Primera vez: `pip`, `npm`, carpetas, `.env` del frontend |
| `start.bat` | API (8732) + frontend (5892) |
| `stop.bat` | Cierra ventanas de la app |
| `update_paths.bat "OLD" "NEW"` | Sustituye prefijo de rutas en la tabla `files` |

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
