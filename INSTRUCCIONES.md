# PhotosRecognizer — Instrucciones de uso

## Uso rápido (3 pasos)

### 1. Copiar fotos y videos

Copia todas tus fotos y videos en la carpeta:

```
data/photos/
```

Puedes crear subcarpetas (por año, evento, etc.). El indexador las recorrerá todas.

**Formatos soportados:**
- Fotos: JPG, JPEG, PNG, HEIC, HEIF, BMP, TIFF, WebP, GIF
- Videos: MP4, MOV, MKV, AVI, M4V, 3GP, WMV

### 2. Ejecutar el indexador

Abre una terminal en la carpeta del proyecto y ejecuta:

```batch
index_and_cluster.bat
```

O si tus fotos están en otra ruta:

```batch
index_and_cluster.bat "D:\Mis Fotos"
```

Para más velocidad (4 núcleos en paralelo):

```batch
index_and_cluster.bat "D:\Mis Fotos" 4
```

**Tiempos aproximados:**
- ~1,5 s por foto, ~8 s por video (CPU)
- 10.000 fotos ≈ 4 horas
- 50.000 fotos ≈ 7 horas
- Puedes pausar con Ctrl+C y retomar después — solo procesa lo nuevo

### 3. Iniciar la aplicación

```batch
start.bat
```

Abre el navegador en: **http://localhost:5892**

---

## Requisitos previos

1. **Python 3.11+** — [python.org](https://www.python.org/downloads/)
2. **Node.js 18+** — [nodejs.org](https://nodejs.org/)
3. **ffmpeg** — Para videos. Añade ffmpeg al PATH o instálalo con `winget install ffmpeg`
4. **Dependencias** (solo la primera vez):

```batch
pip install -r requirements.txt
cd frontend
npm install --ignore-scripts
cd ..
```

---

## Primera vez: configuración completa

Ejecuta el script de configuración (instala dependencias y crea carpetas):

```batch
setup.bat
```

Luego:

1. Copia fotos/videos en `data/photos/`
2. Ejecuta `index_and_cluster.bat`
3. Ejecuta `start.bat`
4. Abre http://localhost:5892

**O manualmente:**

```batch
pip install -r requirements.txt
cd frontend
npm install --ignore-scripts
copy .env.example .env
cd ..
REM Copiar fotos a data\photos\, luego:
index_and_cluster.bat
start.bat
```

---

## Navegación en la app

| Página | Descripción |
|--------|-------------|
| **People** | Personas detectadas (clusters de caras). Clic para ver fotos/videos de cada uno. |
| **All Photos** | Todas las fotos y videos por año. Seleccionar para añadir a recuerdos, personas o álbumes. |
| **Videos** | Solo videos, agrupados por año. |
| **Recuerdos** | Colecciones manuales de fotos/videos. |
| **Álbumes** | Álbumes temáticos. En el detalle: **Renombrar** el título y "Encontrar similares" para ampliarlos. |
| **Search by Face** | Sube una foto de una cara para buscar coincidencias. |
| **Manage Clusters** | Unir personas duplicadas, crear personas nuevas, re-agrupar caras. |

### Videos: adelantar en la barra de tiempo

La API sirve los originales de video con **HTTP Range** (`Accept-Ranges`, respuestas `206`), para que el reproductor del navegador pueda **buscar** (scrub) en la línea de tiempo sin descargar el archivo entero.

Si **un video concreto** no deja adelantar, suele ser por el archivo (p. ej. MP4 con el átomo `moov` al final). Puedes re-empaquetar sin recodificar:

```batch
ffmpeg -i entrada.mp4 -c copy -movflags +faststart salida.mp4
```

### Similares solo entre lo cargado en la galería

En **All Photos**, si entras desde un **álbum** o desde una **persona** con el flujo “buscar similares”, la búsqueda usa **solo los archivos que ya están cargados en la cuadrícula** (incluido lo que hayas traído con “Cargar más” / scroll).

- Desde **detalle de álbum o persona**, el botón principal **“Buscar similares en All Photos”** abre la galería y **ejecuta la búsqueda al momento** (con la primera tanda cargada). Hay también **“Solo abrir galería (sin buscar aún)”** si prefieres cargar más antes.
- Para **repetir** la búsqueda tras hacer scroll: vuelve al álbum/persona y pulsa de nuevo el botón principal, o en All Photos usa **“Volver a buscar (fotos cargadas)”**.

---

## Situación actual: dónde está la data

Toda la data (fotos y videos) está en:

```
photosRecognizer/data/photos/
├── 2016/          ← subcarpetas por año
├── 2025/
├── LEEME.txt
└── ...
```

El indexador recorre **todas** las subcarpetas dentro de `data/photos/`. Puedes organizar por año, evento, etc.

---

## Mover el proyecto a otro disco

Tienes **dos opciones** según lo que quieras hacer:

### Opción A: Mover todo y actualizar rutas (sin reindexar)

Si mueves el proyecto completo (app + data) a otro disco y quieres **conservar** lo ya indexado:

1. Copia toda la carpeta `photosRecognizer` al nuevo disco (ej. `E:\photosRecognizer`).
2. Abre una terminal en la carpeta del proyecto en el **nuevo** disco.
3. Ejecuta (reemplaza con tus rutas reales). La ruta debe ser la carpeta donde están las fotos:

```batch
REM Ejemplo: proyecto en D:\Backup\develop\photosRecognizer -> E:\photosRecognizer
update_paths.bat "D:\Backup\develop\photosRecognizer\data\photos" "E:\photosRecognizer\data\photos"
```

**¿No recuerdas la ruta antigua?** Las rutas están en `data/photos.db`. Puedes abrirla con [DB Browser for SQLite](https://sqlitebrowser.org/) y ver la columna `path` de la tabla `files` — la parte común (ej. `D:\...\data\photos`) es tu ruta antigua.

4. Inicia la app: `start.bat`

**Resultado:** Las rutas en la base de datos se actualizan. No hay que reindexar.

---

### Opción B: Mover y reindexar solo lo nuevo

Si mueves el proyecto y además vas a **pegar carpetas nuevas** en `data/photos/`:

1. Copia el proyecto al nuevo disco.
2. Pega tus nuevas carpetas dentro de `data/photos/` (ej. `data/photos/2024/`, etc.).
3. Ejecuta:

```batch
index_and_cluster.bat
```

El indexador:
- **Omite** archivos ya analizados (mismo contenido, aunque la ruta haya cambiado).
- **Procesa** solo los archivos nuevos que pegaste.

Si las rutas cambiaron (otra letra de disco), primero ejecuta `update_paths.bat` y luego `index_and_cluster.bat`.

---

### Opción C: Empezar desde cero en la nueva ubicación

Si quieres **borrar todo** y reindexar solo con las carpetas que vas a pegar:

1. Copia el proyecto al nuevo disco.
2. Borra el contenido de `data/photos/` (o déjalo vacío).
3. Pega tus carpetas nuevas en `data/photos/`.
4. Ejecuta:

```batch
reindex_all.bat
```

O si tus fotos están en otra ruta:

```batch
reindex_all.bat "E:\Mis Fotos"
```

**Atención:** Borra la base de datos. Recuerdos y álbumes se pierden.

---

## Resumen: qué hacer en cada caso

| Situación | Comando |
|-----------|---------|
| Mover proyecto a otro disco, conservar indexado | `update_paths.bat "RUTA_VIEJA" "RUTA_NUEVA"` |
| Pegar carpetas nuevas en data/photos | `index_and_cluster.bat` |
| Mover + pegar nuevas carpetas | `update_paths.bat` → `index_and_cluster.bat` |
| Empezar de cero con carpetas nuevas | `reindex_all.bat` o `reindex_all.bat "Ruta"` |

---

## Reindexar desde cero

Si cambias de carpeta o quieres empezar de nuevo:

```batch
reindex_all.bat
```

O con ruta personalizada:

```batch
reindex_all.bat "D:\Nueva Carpeta"
```

**Atención:** Borra la base de datos actual. Los recuerdos y álbumes se pierden.

---

## Añadir más fotos después

1. Copia las nuevas fotos/videos en `data/photos/` (o tu carpeta configurada).
2. Ejecuta:

```batch
index_and_cluster.bat
```

Solo se procesan archivos nuevos o modificados. El indexador usa mtime+size para detectar cambios.

---

## Aceleración con GPU AMD (opcional)

Si tienes tarjeta AMD:

```batch
pip uninstall onnxruntime
pip install onnxruntime-directml
```

---

## Solución de problemas

| Problema | Solución |
|----------|----------|
| "ffmpeg no encontrado" | Instala ffmpeg y añádelo al PATH. |
| Puerto 5892 o 8732 en uso | Ejecuta `stop.bat` o cierra las ventanas de la API/Frontend. |
| La app no carga fotos | Asegúrate de haber ejecutado `index_and_cluster.bat` antes de `start.bat`. |
| Clusters vacíos en personas | Ya corregido: se priorizan fotos para el avatar y los videos muestran thumbnail. |
| Duración de videos no aparece | Reindexa con `index_and_cluster.bat` para que se guarde la metadata. |
| "database is locked" al indexar | Usa 1 worker: `index_and_cluster.bat "ruta" 1` |
| Revisar errores del indexador o API | Consulta `logs/index_*.log` y `logs/api.log` |
| API lenta con muchas peticiones | Por defecto la API arranca con **2 workers** (procesos en paralelo). Cambia antes de `start.bat`: `set API_WORKERS=4` (SQLite sigue serializando escrituras; mejora sobre todo lecturas concurrentes). |

### Álbumes: orden y selección

- **Renombrar**: junto al título del álbum, **✏️ Renombrar** → edita el nombre → **Guardar**.
- En el detalle de un álbum: **Ordenar fotos** — arrastra una miniatura sobre otra o usa **↑ / ↓**.
- **Seleccionar** — clic en varias fotos; **Shift + clic** selecciona un rango. **Quitar del álbum** elimina las seleccionadas.

---

## Logs

Los logs se guardan en la carpeta `logs/`:

| Archivo | Contenido |
|---------|-----------|
| `logs/index_YYYY-MM-DD_HH-MM-SS.log` | Salida del indexador y clustering (cada ejecución) |
| `logs/api.log` | Operaciones y errores de la API |

---

## Estructura de carpetas

```
photosRecognizer/
├── data/
│   ├── photos/            ← AQUÍ van tus fotos y videos
│   │   ├── 2016/          ← subcarpetas por año (o como quieras)
│   │   ├── 2025/
│   │   └── ...
│   ├── photos.db          ← Base de datos (se crea al indexar)
│   └── thumbnails/        ← Miniaturas generadas
├── logs/                  ← Logs del indexador y API
│   ├── index_*.log
│   └── api.log
├── index_and_cluster.bat  ← Indexar + agrupar caras
├── update_paths.bat       ← Actualizar rutas tras mover a otro disco
├── start.bat              ← Iniciar API + frontend
├── stop.bat               ← Detener todo
└── reindex_all.bat        ← Borrar y reindexar desde cero
```
