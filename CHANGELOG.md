# Changelog

## [Sin versión] — Cambios recientes

### Selección tipo Google Fotos

- **All Photos**, **Videos** y **detalle de álbum**: **clic** = alternar marcar/desmarcar; **Shift + clic** = rango continuo entre el último clic y el actual (sustituye la selección por ese bloque). Miniaturas con `select-none` para evitar selección de texto al usar Shift.

### Videos y similares en página

- **Similares desde álbum/persona**: el botón principal abre All Photos y **ejecuta la búsqueda** (`autoRunSimilar` + `similarTrigger`); botón secundario solo abre la galería. En All Photos, tras resultados, el botón pasa a **“Volver a buscar (fotos cargadas)”**.
- **Streaming de video con Range**: `GET /originals/{id}` para videos responde con **206 Partial Content** cuando el navegador pide rangos de bytes (`api/video_stream.py`), permitiendo adelantar en la barra del reproductor.
- **Persona → similares en página**: `POST /people/{id}/find-similar-in-page` con `file_ids` de lo ya cargado en All Photos; el front enlaza desde detalle de persona.
- **Visores**: `preload="auto"` en `<video>` de lightbox (All Photos, Videos, álbum, recuerdo, persona) para ayudar al buffer.

### API y álbumes

- **Renombrar álbum**: `PATCH /albums/{id}` con `{ "label": "..." }`; en detalle de álbum, botón **✏️ Renombrar** (como en personas).
- **Uvicorn `--workers`** (por defecto 2 en `start.bat`): varios procesos atienden peticiones en paralelo; con SQLite WAL mejora sobre todo cuando se mezclan listados de people/photos/videos. Variable `API_WORKERS` (ej. `set API_WORKERS=4` antes de `start.bat`).
- **Álbumes**: columna `sort_order` en `album_files`; `PATCH /albums/{id}/reorder` con `{ "file_ids": [...] }`.
- **Detalle de álbum**: modo **Ordenar fotos** (arrastrar o ↑↓), modo **Seleccionar** con **Shift + clic** para rango y quitar varias del álbum.
- Lista del álbum en **orden guardado** (sin agrupar por año).

### Optimizaciones de rendimiento (Fase 1)

- **Auto-carga al scroll**: En All Photos, Videos y Person Detail, al bajar en la galería el contenido se carga automáticamente cuando el botón "Cargar más" entra en vista (IntersectionObserver). Sin necesidad de clic.
- **PAGE_SIZE** reducido de 200 a 80 en All Photos y Videos para menos DOM inicial.
- **Índices DB**: `exif_date` y `mtime` indexados para listados más rápidos.
- **joinedload(File.faces)** en `/photos` y `/people/{id}/photos` para evitar N+1 queries.
- **Cache-Control** en thumbnails: `max-age=86400` (24h) para menos re-descargas.
- Plan detallado en `PLAN_OPTIMIZACION.md`.

### All Photos: flujo "Seleccionar persona en foto"

- Sustituido el botón "Cotejar contra rostros" por **"Seleccionar persona en foto"**
- El usuario dibuja un área sobre la imagen (FaceCropSelector) y se buscan coincidencias
- Se muestran posibles personas reconocidas o la opción de crear nueva
- Al abrir/cerrar el lightbox se resetean `cropMode` y `cropResults`

### Soporte para mascotas y objetos (CLIP)

- Si no se detecta rostro humano en la región seleccionada (perro, gato, objeto), se usa **CLIP** para generar el embedding
- Permite crear "personas" para mascotas y agrupar fotos por ellas
- Nuevo módulo `indexer/region_embedder.py` (CLIP ViT-B-32, 512 dim)
- Dependencias: `open-clip-torch`, `torch`
- La primera vez que se usa una región sin rostro, CLIP descarga el modelo (~350 MB)

### .gitignore

- Ignorar `data/photos/` y `data/thumbnails/` (fotos y thumbnails)
- Permitir subir `data/photos.db`
- Añadidas entradas para Python, Node, IDE, logs
