# Plan técnico: Ajuste de soporte para videos

## Resumen ejecutivo

Mejora del soporte de videos en PhotosRecognizer para aprovechar un disco de 4TB con fotos y videos. Se abordan clusters vacíos, vista dedicada a videos, metadata y UX.

---

## Fase 1: Arreglar clusters vacíos

### 1.1 Face crop para videos
- **Problema**: `serve_face_crop_by_id` devuelve 400 para caras de videos.
- **Solución**: Si `file_type == "video"`, servir el thumbnail del file en lugar del crop (no guardamos timestamp del frame).
- **Archivo**: `api/main.py`

### 1.2 Fallback en PersonCard
- **Problema**: Si `faceCropByIdUrl` falla (videos), no hay fallback a `cover_thumbnail`.
- **Solución**: En `onError`, usar `thumbnailUrl(cover_thumbnail)` como fallback final antes de ocultar.
- **Archivo**: `frontend/src/components/PersonCard.tsx`

### 1.3 Cover de cluster: priorizar fotos
- **Problema**: El cover puede ser una cara de video → peor visualización.
- **Solución**: Al crear clusters, ordenar caras por `file_type` (photo primero) para elegir `cover_face_id`.
- **Archivo**: `clustering/cluster_faces.py`

### 1.4 Thumbnail obligatorio para videos
- **Problema**: Videos sin caras no generan thumbnail.
- **Solución**: Siempre generar thumbnail del primer frame, aunque no haya caras.
- **Archivo**: `indexer/run.py`

---

## Fase 2: Apartado de videos

### 2.1 Ruta /videos
- Nueva página `Videos.tsx` similar a All Photos.
- **Archivo**: `frontend/src/pages/Videos.tsx`

### 2.2 API
- Ya existe: `GET /photos?file_type=video`. Añadir `getVideos(skip, limit)` en api.ts.

### 2.3 Navbar
- Enlace "Videos" junto a All Photos, Recuerdos, Álbumes.
- **Archivo**: `frontend/src/components/Navbar.tsx`

### 2.4 Vista por año
- Agrupar videos por año (usar exif_date o file_modified como fallback).
- **Archivo**: `frontend/src/pages/Videos.tsx`

### 2.5 VideoCard / PhotoCard
- Reutilizar `PhotoCard` con soporte para duración (cuando exista).
- Badge de play ya existe en PhotoCard para videos.

### 2.6 Reproducción
- Lightbox con `<video>` ya implementado en PersonDetail, RecuerdoDetail, AlbumDetail.

---

## Fase 3: Metadata y UX de video

### 3.1 Duración en DB
- Añadir columna `duration` (Float, segundos) a `files`.
- **Archivos**: `indexer/db.py`, `indexer/embeddings_store.py`, `indexer/run.py`, `indexer/video_extractor.py`

### 3.2 Resolución para videos
- `width`/`height` ya existen; extraer con ffprobe en indexer para videos.

### 3.3 UI: duración en cards
- Mostrar "2:34" en PhotoCard/VideoCard cuando `duration` exista.
- **Archivo**: `frontend/src/components/PhotoCard.tsx`, `api/models.py`, `api/routers/photos.py`

### 3.4 Recuerdos/Álbumes
- Ya permiten fotos y videos (file_type no restringido en add-files).

---

## Fase 4: Avanzado (fuera de alcance inicial)

- 4.1–4.4: Clusters de contenido, embeddings de escena, timestamp por cara, selección de cover manual.

---

## Fase 5: Escalabilidad 4TB (opcional)

- 5.1–5.4: Indexación incremental, lazy thumbnails, streaming, filtros.

---

## Orden de implementación

1. Fase 1 (1.1–1.4) ✅
2. Fase 2 (2.1–2.5) ✅
3. Fase 3 (3.1–3.3) ✅

---

## Ejecutado (resumen)

- **api/main.py**: Face crop para videos → sirve thumbnail del file.
- **PersonCard.tsx**: Fallback a cover_thumbnail cuando faceCrop falla.
- **cluster_faces.py**: Prioriza caras de fotos para cover_face_id.
- **indexer/run.py**: Thumbnail obligatorio para videos; metadata (duration, width, height).
- **indexer/video_extractor.py**: get_video_metadata() con ffprobe.
- **indexer/db.py**: Columna duration en files; migración.
- **indexer/embeddings_store.py**: upsert_file acepta duration.
- **Videos.tsx**: Nueva página /videos con grid por año.
- **Navbar.tsx**: Enlace "Videos".
- **PhotoCard.tsx**: Badge de duración (ej. "2:34") para videos.
- **api/models.py, routers**: FileOut con duration.
