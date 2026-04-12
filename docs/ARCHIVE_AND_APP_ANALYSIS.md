# Archivo de fotos / vídeos y análisis de la app

## Requisito: archivo

- **Qué es**: marcar archivos en la tabla `files` con `archived = 1`. Siguen en disco y en la base de datos (caras, álbumes, etc.), pero **no se listan** en las vistas principales.
- **Quién puede archivar**: cualquier uso de la API que llame a `POST /photos/archive` (en el front: modo selección en **All Photos**). Requiere que el servidor tenga **`ARCHIVE_PIN`** definido (7 dígitos); si no, la API responde 503 y el botón no aparece.
- **Acceso al contenido archivado**: ruta **`/archive`**. El usuario introduce el **mismo PIN** que está en el entorno del servidor. El navegador guarda el PIN en **`sessionStorage`** solo para enviar la cabecera `X-Archive-Pin` en las peticiones de listado, desarchivar y ver originales protegidos.
- **Seguridad**: el PIN no va en el frontend empaquetado; solo en **variables de entorno del proceso de la API**. Las miniaturas bajo `/thumbnails/` siguen siendo estáticas (acceso directo por URL sin PIN); los **originales** y recortes relevantes comprueban archivo + PIN.

## Redundancias / deuda técnica observada

| Área | Observación |
|------|-------------|
| **Locks find-similar** | `threading.Lock` por álbum/recuerdo solo aplica **dentro de un worker** Uvicorn; con varios workers no serializa entre procesos. |
| **Listados de fotos** | Varios endpoints montan `FileOut` a mano (`people`, `memories`, `albums`) en lugar de reutilizar una sola función como en `photos.py`; más riesgo de campos desincronizados (p. ej. `archived`). |
| **Estadísticas** | `total_photos` / `total_files` cuentan también archivados; el front muestra aparte **Archivadas**. |
| **Personas / álbumes** | Al archivar, las caras y filas `album_files` siguen existiendo; la foto solo deja de mostrarse en listados. Los contadores de persona/álbum no se recalculan automáticamente. |
| **Búsqueda por cara** | Los resultados de similitud omiten caras cuyo archivo está archivado; las regiones en fotos archivadas devuelven 404. |

## Endpoints relevantes

- `GET /photos/archive/status` — `{ configured: bool }`
- `POST /photos/archive/verify` — body `{ "pin": "1234567" }`
- `GET /photos/archive/list` — cabecera `X-Archive-Pin`
- `POST /photos/archive` — `{ "file_ids": [...] }` (archivar)
- `POST /photos/archive/unarchive` — cabecera PIN + `{ "file_ids": [...] }`

Variable de entorno: **`ARCHIVE_PIN=1234567`** (exactamente 7 dígitos).
