# Diseño: Cache de búsqueda por álbum (similarity) — v2

## Objetivos

1. **No reprocesar**: Una vez que una foto tiene CLIP calculado, no volver a ejecutarlo.
2. **No perder cache al cambiar álbum**: Al añadir/quitar fotos del álbum, NO borrar el cache. Recalcular solo lo necesario (productos escalares, sin CLIP).
3. **Configurar fotos del centroide** (igual que Persona): Modal para ver todas las fotos del álbum y excluir las que no quieres en el centroide.
4. **Procesar toda la biblioteca**: No limitar a 5000 fotos.
5. **Consultar resultados**: Ver positivos, negativos, pendientes; saber si una foto ya está clasificada.

---

## Cambios principales respecto a v1

### A) No borrar cache al cambiar el álbum

**Problema actual**: Al añadir o quitar fotos del álbum, se borra `album_search_cache` → se pierde todo el trabajo ya hecho.

**Solución**: Persistir embeddings CLIP por archivo de forma global.

| Nueva tabla | Descripción |
|-------------|-------------|
| `file_clip_embeddings` | `file_id` (PK), `embedding` (blob 512 float32), `computed_at` |

**Flujo**:
1. Al calcular similarity de una foto: si no tiene embedding en `file_clip_embeddings`, ejecutar CLIP y guardarlo. Luego: `similarity = dot(centroid, embedding)`.
2. El embedding se guarda **una vez por foto** y se reutiliza para todos los álbums.
3. Cuando el álbum cambia (centroide nuevo): recalculamos **solo** `similarity = dot(nuevo_centroid, embedding)` para cada fila en `album_search_cache`. **Sin llamadas CLIP**.
4. Ya no se borra `album_search_cache` al añadir/quitar fotos. Solo se actualizan los scores.

**Invalidez**: La única ocasión en que hay que borrar cache es si cambiamos el modelo CLIP. Mientras no cambie, todo se mantiene.

---

### B) Modal "Configurar fotos del álbum" (como Persona)

En Persona tienes "Configurar foto" → modal con todos los rostros → **Perfil**, **Excluir** (del centroide), **✕** (quitar del conjunto).

Para Álbum, igual pero con fotos completas (CLIP):

| Elemento | Persona | Álbum |
|----------|---------|-------|
| Unidad | Rostro (face) | Foto (file) |
| Tabla | `faces` con `is_canonical` | `album_files` con `use_in_centroid` |
| Centroide | Promedio de embeddings de rostros canónicos | Promedio de embeddings CLIP de fotos con `use_in_centroid=1` |

**Cambios en BD**:
- `album_files`: añadir columna `use_in_centroid` (Integer, default 1). `1` = usado en centroide, `0` = excluido.

**UI**:
- Botón en detalle de álbum: **"Configurar fotos"** (como "Configurar foto" en Persona).
- Modal con rejilla de fotos del álbum.
- Por foto:
  - **Excluir** / **Incluir**: alterna `use_in_centroid`. Excluidas = opacidad reducida, borde ámbar.
  - **✕**: quitar del álbum (borrar de `album_files`).
- Texto explicativo: *"Centroide = fotos usadas para buscar similares. Excluir las que no definan bien el álbum."*

**API**:
```
PATCH /albums/{id}/files/{file_id}/use-in-centroid
Body: { "use_in_centroid": true | false }
```

**Lógica del centroide**:
- Solo fotos con `use_in_centroid=1` en el álbum.
- Equivalente a `Face.is_canonical` en Persona.

---

### C) Pool desde backend (procesar toda la biblioteca)

**Endpoint**:
```
POST /albums/{id}/find-similar-library
  ?max_new=1000
  &min_similarity=0.35
  &force_clip=true
  &exclude_faces_from_centroid=false
```

- Backend obtiene `file_id` de `files WHERE file_type='photo'` (excluyendo las del álbum).
- Usa `album_search_cache` y `file_clip_embeddings`.
- Procesa hasta `max_new` fotos nuevas.
- Devuelve resultados + stats.

---

### D) Listar resultados cacheados

```
GET /albums/{id}/search-cache?
  status=positive|negative|all
  &skip=0
  &limit=100
```

- **positive**: `similarity >= 0.35`
- **negative**: `similarity < 0.35`
- **all**: todo lo cacheado.

---

### E) No borrar cache en add-files / remove-file

- **Antes**: `add-files` y `remove-file` ejecutaban `DELETE FROM album_search_cache WHERE album_id=X`.
- **Ahora**: No borrar. En su lugar:
  1. Recalcular centroide con las fotos actuales (solo las con `use_in_centroid=1`).
  2. Para cada fila en `album_search_cache` del álbum: leer embedding de `file_clip_embeddings`, recalcular `similarity = dot(centroid, emb)`, actualizar la fila.
  3. Todo en memoria/operaciones matemáticas; sin CLIP.

---

## Esquema de tablas actualizado

### `file_clip_embeddings` (nueva)
| Columna | Tipo | Descripción |
|---------|------|-------------|
| file_id | Integer PK FK | Archivo |
| embedding | LargeBinary | 512 float32 (CLIP) |
| computed_at | DateTime | Cuándo se calculó |

### `album_files` (modificación)
| Columna | Cambio |
|---------|--------|
| use_in_centroid | Nueva: Integer default 1. 1=centroide, 0=excluida |

### `album_search_cache` (sin cambios estructurales)
- Se mantiene. Ya no se borra al cambiar el álbum.
- Se actualizan las filas existentes con los nuevos scores cuando cambia el centroide.

---

## Resumen de implementación

| # | Cambio | Prioridad | Esfuerzo |
|---|--------|-----------|----------|
| 1 | Tabla `file_clip_embeddings` + persistir embeddings al calcular | Alta | Medio |
| 2 | Columna `album_files.use_in_centroid` + migración | Alta | Bajo |
| 3 | Al cambiar álbum: recalcular scores (dot products) en vez de borrar cache | Alta | Medio |
| 4 | Modal "Configurar fotos" en UI + PATCH use-in-centroid | Alta | Medio |
| 5 | Endpoint `POST /albums/{id}/find-similar-library` (pool desde backend) | Alta | Medio |
| 6 | Endpoint `GET /albums/{id}/search-cache` (listar positivos/negativos) | Media | Bajo |
| 7 | UI: pestañas Positivas / Negativas / Pendientes | Media | Medio |

---

## Orden sugerido

1. **file_clip_embeddings** + lógica de persistencia.
2. **use_in_centroid** en album_files + lógica de centroide.
3. **No borrar cache** + recálculo de scores al cambiar álbum.
4. **Modal Configurar fotos** + API PATCH.
5. **find-similar-library** (pool backend).
6. **GET search-cache** (listar) + pestañas en UI.
