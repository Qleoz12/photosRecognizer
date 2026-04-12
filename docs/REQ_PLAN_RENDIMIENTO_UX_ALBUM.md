# Requisitos y plan — rendimiento, galería `/gallery`, álbum similares

Documento **accionable previo al desarrollo** (y seguimiento). Incluye lo ya hecho en código y el backlog sugerido.

---

## 1. Contexto que la UI ya refleja (comportamiento correcto)

| Hecho | Descripción |
|--------|-------------|
| **Carga progresiva** | En `http://localhost:5892/gallery` (All Photos) **no** se leen todos los archivos a la vez. El cliente pide páginas (`skip`/`limit`) al bajar o usar «Cargar más». |
| **Con fecha vs sin fecha** | Listado con fecha EXIF va en scroll infinito; sin fecha va en bloque final, **hasta 500 ítems por petición** y scroll infinito al final del bloque. |
| **Totales globales** | La línea bajo el título usa `/photos/stats/summary` (`dated_count`, `undated_count`). |

**Requisito UX-1 (texto aclaratorio)**  
- [x] Incluir en pantalla que los totales por año / resumen son de **biblioteca**, mientras las miniaturas son **las cargadas hasta ahora**.

---

## 2. Totales por año en cabeceras (REQ-GAL-001)

**Objetivo:** En cada año (p. ej. `2025`), mostrar **cuántas hay en pantalla** y **cuántas hay en la biblioteca** para ese año (EXIF, no archivadas).

| ID | Requisito | Criterio de aceptación |
|----|-----------|-------------------------|
| REQ-GAL-001a | API de agregación por año | `GET /photos/stats/by-year` devuelve `{ by_year: [{ year, count }] }` para `archived = 0` y `exif_date IS NOT NULL` (implementación en Python con `d.year` para evitar fallos de `strftime` en SQLite según formato almacenado). |
| REQ-GAL-001b | Cliente | Cabecera: `(N visibles · M en biblioteca)` por año; error de red/API mostrado en la tabla «Por año». |
| REQ-GAL-001c | Rendimiento | Una query lee solo `exif_date`; agregación en proceso (aceptable hasta ~cientos de miles de filas). |

**Estado:** implementado (endpoint + `AllPhotos`).

---

## 2b. Sin fecha: auto-carga y asignación masiva de año (REQ-GAL-002 / 003)

| ID | Requisito | Criterio de aceptación |
|----|-----------|-------------------------|
| REQ-GAL-002 | Scroll en bloque «Sin fecha EXIF» | Al acercarse al final del bloque (IntersectionObserver), se dispara la siguiente página sin depender solo del botón. |
| REQ-GAL-003a | API | `POST /photos/batch/exif-year` con `{ file_ids, year }` asigna `exif_date` (1 jul, mediodía) a archivos **no archivados**. |
| REQ-GAL-003b | UI | En modo selección: campo año + «Asignar año a selección»; tras éxito, recarga galería y estadísticas. |

**Estado:** implementado.

**Mejora opcional (backlog):** filtro `file_type=photo|video` en el mismo endpoint si se quiere desglose.

---

## 3. Álbum — similares: clasificar desde «Sugeridas» (REQ-ALB-001)

**Problema:** En la pestaña **Sugeridas** solo existía **+ Álbum**; no había forma de marcar manualmente **positiva** / **negativa** en caché (`album_search_cache.manual_status`), a diferencia de las pestañas Positivas/Negativas.

| ID | Requisito | Criterio de aceptación |
|----|-----------|-------------------------|
| REQ-ALB-001a | Misma API | Reutilizar `PATCH /albums/{id}/search-cache/{file_id}` con `positive` / `negative`. |
| REQ-ALB-001b | UI | En hover sobre miniatura en Sugeridas: botones **→ Positivas** y **→ Negativas** (y **+ Álbum**). |
| REQ-ALB-001c | Estado | Tras éxito, la miniatura **desaparece** de la lista sugerida y las **cuentas** de cache se refrescan. |
| REQ-ALB-001d | Error | Si el `file_id` no está en cache (404), mostrar mensaje claro (caso raro tras cambios de backend). |

**Estado:** implementado (`AlbumDetail.tsx`, `handleSetCacheStatus(..., { fromSuggested: true })`).

---

## 4. Plan de trabajo priorizado (acciones)

### Fase A — Ya cubierto en esta iteración
1. Totales por año (REQ-GAL-001).  
2. Texto de carga progresiva vs totales de biblioteca.  
3. Botones Sugeridas → Positivas/Negativas (REQ-ALB-001).

### Fase B — Alto impacto en lentitud (siguiente desarrollo)
1. **DTO ligero en `GET /photos/`** — no enviar `faces` completos (ni embeddings) en el grid; solo recuento o nada.  
2. **Caché o derivado para `/originals` en fotos** — evitar PIL + JPEG en cada apertura de lightbox.  
3. **Paginar `GET /albums/{id}/photos`** — no devolver miles de filas en un JSON.  
4. **Virtualizar grid** en All Photos / similares cuando haya miles de nodos DOM.

### Fase C — Progreso y percepción
1. **Find-similar:** barra de progreso o streaming (SSE/polling); opción cancelar.  
2. **Timeouts** selectivos en listados (no en operaciones largas sin alternativa).

### Fase D — Infraestructura datos (cuando haga falta)
1. Evaluar **PostgreSQL** (o similar) si la contención SQLite (indexador + API) medida en logs domina.  
2. No sustituye Fase B: imágenes y payloads siguen siendo cuellos propios.

---

## 5. Ideas sin tocar los originales en disco (`data/photos/…`)

Estrategias sobre **derivados y transporte**, no sobre borrar ni re-empaquetar la colección original.

| Idea | Qué comprime / alivia | Notas |
|------|------------------------|--------|
| **Thumbs ya existentes** | Tráfico y decodificación en grid | Mantener 300px; opcional segunda resolución (~800px) solo para lightbox, generada en indexado. |
| **Caché JPEG orientado** | CPU en `/originals` | Escribir en `data/cache/originals/{id}.jpg` invalidando por `mtime`/hash del origen. |
| **Embeddings en tabla aparte o comprimidos** | Tamaño de filas en lecturas masivas | Ya están en BLOB; listados no deberían leerlos (REQ Fase B). |
| **Compresión HTTP** | Ancho de banda | `gzip`/`brotli` en JSON detrás de reverse proxy. |
| **CDN / nginx estático** | Servidor Python | Servir `/thumbnails` y cachés desde nginx con `expires`. |
| **WAL / SQLite** | Contención | Ya en uso; alternativa es servidor SQL con escrituras concurrentes. |
| **Índices** | Consultas por año, fecha, álbum | `exif_date`, `mtime` ya migrados; revisar queries de álbum/cache. |

**Principio:** no es obligatorio “comprimir la biblioteca”; suele bastar **no re-leer ni re-encodear** lo mismo en cada vista.

---

## 6. Trazabilidad rápida (código)

| Área | Archivos relevantes |
|------|---------------------|
| Stats / por año | `api/routers/photos.py` (`/stats/summary`, `/stats/by-year`) |
| All Photos | `frontend/src/pages/AllPhotos.tsx` |
| Cliente API | `frontend/src/api.ts` |
| Cache manual álbum | `api/routers/albums.py` (`set_cache_manual_status`), `frontend/src/pages/AlbumDetail.tsx` |

---

*Última actualización: alineado con implementación de REQ-GAL-001 y REQ-ALB-001 en el repo.*
