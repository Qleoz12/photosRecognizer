# Plan de optimización — PhotosRecognizer

## Rol: Arquitecto / Planeador

Documento de análisis y estrategias para mejorar la velocidad de carga de fotos y videos.

---

## 1. Estructura actual y flujo de datos

```
photosRecognizer/
├── api/                    # FastAPI — endpoints JSON + servir media
│   ├── main.py              # /thumbnails (estático), /originals (dinámico), /faces/*/crop
│   ├── routers/             # photos, people, search, memories, albums
│   └── deps.py
├── frontend/src/            # React + Vite
│   ├── api.ts               # Cliente API, thumbnailUrl(), originalUrl()
│   ├── pages/               # AllPhotos, PersonDetail, Videos, etc.
│   └── components/         # PhotoCard, PersonCard
├── indexer/                 # Pipeline de indexado
│   ├── thumbnail.py         # Genera thumbs 300px JPEG en data/thumbnails/
│   ├── db.py                # SQLite: files, faces, clusters
│   └── run.py
├── data/
│   ├── photos/              # Fotos y videos originales
│   ├── thumbnails/          # Miniaturas pre-generadas (300px)
│   └── photos.db            # SQLite
└── logs/
```

### Flujo de carga de una foto en la galería

1. **Frontend** → `GET /photos/?skip=0&limit=200` → JSON con `FileOut[]` (incluye `thumbnail_path`, `faces[]`)
2. **Frontend** → `<img src="/thumbnails/{basename}" loading="lazy" />` → archivo estático
3. **Lightbox** → `<img src="/originals/{file_id}" />` → **API decodifica la foto completa, re-encoda JPEG q=92** en cada petición

### Flujo de carga de un video

1. Thumbnail: igual que fotos (pre-generado en indexado)
2. Reproducción: `GET /originals/{file_id}` → streaming del archivo raw (eficiente)

---

## 2. Cuellos de botella identificados

### Alto impacto

| # | Problema | Dónde | Efecto |
|---|----------|-------|--------|
| 1 | **`/originals/{id}` para fotos** decodifica y re-encoda en cada petición | `api/main.py` | CPU alto, payload grande, sin caché |
| 2 | **Face crop** (`/faces/{id}/crop`) abre la foto completa para un crop pequeño | `api/main.py` | Coste innecesario por cada avatar/crop |
| 3 | **Sin virtualización** en grids: 200 fotos = 200 nodos DOM + lazy load | `AllPhotos.tsx`, `PersonDetail.tsx` | DOM pesado, memoria, scroll lento |
| 4 | **Memories/Albums** devuelven todas las fotos sin paginación | `getMemoryPhotos`, `getAlbumPhotos` | JSON grande, muchas peticiones thumb a la vez |
| 5 | **HNSW** carga todos los embeddings en RAM en la primera búsqueda | `search.py`, `embeddings_store.py` | Latencia inicial alta con muchas caras |

### Impacto medio

| # | Problema | Dónde | Efecto |
|---|----------|-------|--------|
| 6 | **N+1 queries**: `_file_to_out` accede a `f.faces` sin `joinedload` | `photos.py`, `people.py` | Una query extra por archivo en listados |
| 7 | **Sin índice en `exif_date`** para ordenar listados | `indexer/db.py` | Ordenar por fecha lento en bibliotecas grandes |
| 8 | **Cache-Control** en thumbs/crops: `no-cache` o ausente | `api/main.py` | Re-descargas innecesarias |
| 9 | **FileOut** incluye `path` completo y todos los `faces` en listados | `api/models.py` | JSON más pesado de lo necesario |
| 10 | **People**: hasta 200 personas en una vista, cada una con thumb | `getPeople(limit=200)` | Muchas peticiones simultáneas |

### Impacto bajo

| # | Problema | Efecto |
|---|----------|--------|
| 11 | Thumbnails 300px únicos; no hay tamaños intermedios | Lightbox podría usar 800px en vez de original |
| 12 | SQLite single-writer | Competencia en escrituras paralelas (ya mitigado con 1 worker) |

---

## 3. Estrategias propuestas (prioridad)

### Fase 1 — Rápidas (1–2 días)

| Estrategia | Descripción | Impacto | Esfuerzo |
|------------|-------------|---------|----------|
| **1.1 Cache-Control en thumbnails** | Añadir `Cache-Control: max-age=86400` al mount de `/thumbnails` | Medio | Bajo |
| **1.2 Reducir PAGE_SIZE inicial** | AllPhotos: 200 → 80; Videos: 200 → 80. "Cargar más" sigue igual | Medio | Bajo |
| **1.3 Índice exif_date** | `CREATE INDEX ix_files_exif_date ON files(exif_date)` | Medio | Bajo |
| **1.4 joinedload en list_photos** | `session.query(File).options(joinedload(File.faces))` para evitar N+1 | Medio | Bajo |
| **1.5 Auto-carga al hacer scroll** | Cuando el usuario baja y el botón "Cargar más" entra en vista, disparar carga automática (IntersectionObserver). Sin clic. | Alto | Bajo |

### Fase 2 — Medias (3–5 días)

| Estrategia | Descripción | Impacto | Esfuerzo |
|------------|-------------|---------|----------|
| **2.1 Caché de `/originals` para fotos** | Generar y guardar JPEG pre-procesado en primera petición; servir estático después | Alto | Medio |
| **2.2 Paginación en Memories/Albums** | `GET /memories/{id}/photos?skip=&limit=` | Alto | Medio |
| **2.3 DTO ligero para listados** | `FileCardOut` sin `path`, sin `faces` completos (solo count o ids) | Medio | Medio |
| **2.4 Virtualización de grid** | `react-virtuoso` o `react-window` en AllPhotos, PersonDetail, Videos | Alto | Medio |

### Fase 3 — Más trabajo (1–2 semanas)

| Estrategia | Descripción | Impacto | Esfuerzo |
|------------|-------------|---------|----------|
| **3.1 Thumbnails multi-tamaño** | Generar 300px (grid) + 800px (lightbox) en indexado; API elige por query param | Alto | Alto |
| **3.2 Pre-cache de crops de caras** | Guardar crops en `data/thumbnails/faces/` durante indexado; servir estático | Alto | Alto |
| **3.3 Lazy HNSW** | Cargar índice por chunks o on-demand en lugar de todo a la vez | Medio | Alto |
| **3.4 CDN/local proxy** | Servir thumbnails/originals desde nginx o similar con caché de disco | Medio | Alto |

---

## 4. Detalle técnico por estrategia

### 1.1 Cache-Control en thumbnails

```python
# api/main.py — al montar StaticFiles, añadir headers
from fastapi.staticfiles import StaticFiles
# Opción: middleware que añade Cache-Control a /thumbnails/*
# O: usar StaticFiles con html=True y un wrapper que inyecte headers
```

Alternativa: middleware que intercepta respuestas de `/thumbnails` y añade `Cache-Control: public, max-age=86400`.

### 1.2 Reducir PAGE_SIZE

```ts
// frontend/src/pages/AllPhotos.tsx
const PAGE_SIZE = 80;  // antes 200

// frontend/src/pages/Videos.tsx
const PAGE_SIZE = 80;  // antes 200
```

### 1.3 Índice exif_date

```python
# Migración o script: indexer/db.py o nueva migración
# CREATE INDEX IF NOT EXISTS ix_files_exif_date ON files(exif_date);
# CREATE INDEX IF NOT EXISTS ix_files_mtime ON files(mtime);
```

### 1.4 joinedload

```python
# api/routers/photos.py
from sqlalchemy.orm import joinedload
q = session.query(File).options(joinedload(File.faces))
```

### 2.1 Caché de originals

- Crear `data/cache/originals/` (o similar)
- En `serve_original`: si existe `{file_id}.jpg` en caché y `mtime` del original no cambió → `FileResponse` estático
- Si no: generar, guardar en caché, devolver
- Añadir `Cache-Control: max-age=604800` (1 semana)

### 2.2 Paginación Memories/Albums

```python
# api/routers/memories.py
@router.get("/{memory_id}/photos")
def get_memory_photos(memory_id: int, skip: int = 0, limit: int = 100, ...):
```

### 1.5 Auto-carga al hacer scroll (IntersectionObserver)

```tsx
// Hook useInfiniteScroll: cuando el sentinel entra en viewport, llama onLoadMore
function useInfiniteScroll(onLoadMore: () => void, loading: boolean, hasMore: boolean) {
  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!hasMore || loading) return;
    const el = sentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => { if (entries[0]?.isIntersecting) onLoadMore(); },
      { rootMargin: "200px" }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [onLoadMore, loading, hasMore]);
  return sentinelRef;
}
// En AllPhotos/Videos/PersonDetail: colocar <div ref={sentinelRef} /> donde estaba el botón
// El botón sigue visible mostrando "Cargando..." cuando loading; al llegar al viewport se dispara automáticamente
```

### 2.4 Virtualización

```tsx
// Ejemplo con react-virtuoso
import { VirtuosoGrid } from 'react-virtuoso';
<VirtuosoGrid
  listClassName="grid grid-cols-4 gap-2"
  totalCount={files.length}
  itemContent={(index) => <PhotoCard file={files[index]} />}
/>
```

---

## 5. Orden sugerido de implementación

```
1. Fase 1 (rápidas)     → 1.3, 1.4, 1.1, 1.2, 1.5 ✅ IMPLEMENTADO
2. Fase 2 (medias)      → 2.4 (virtualización), 2.1 (caché originals), 2.2 (paginación)
3. Fase 3 (opcionales)  → según necesidad
```

---

## 6. Resumen ejecutivo

| Prioridad | Acción | Beneficio esperado |
|-----------|--------|--------------------|
| 1 | Índice `exif_date` + `joinedload` | Listados más rápidos |
| 2 | Cache-Control thumbnails | Menos re-descargas |
| 3 | PAGE_SIZE 80 | Menos DOM, scroll más fluido |
| 4 | Auto-carga al scroll (IntersectionObserver) | ✅ Implementado — sin clic en "Cargar más" |
| 5 | Virtualización de grid | Escalable a miles de fotos |
| 6 | Caché de `/originals` | Lightbox instantáneo tras primera vista |
| 7 | Paginación Memories/Albums | Álbumes grandes no bloquean |

---

## 7. Métricas para validar

- Tiempo hasta primer contenido visible (LCP)
- Tiempo de respuesta `GET /photos/?limit=80`
- Tiempo de respuesta `GET /originals/{id}` (foto 4K)
- Número de peticiones simultáneas en carga de All Photos
- Uso de memoria del navegador con 500+ fotos en grid
