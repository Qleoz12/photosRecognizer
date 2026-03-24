# Plan de modificaciones — PhotosRecognizer

## 1. Selector de persona manual (cuando CLIP/detección no encuentra rostro)

### Problema
Hay fotos donde ni InsightFace ni CLIP detectan el rostro deseado. El usuario no puede asignar la foto a nadie.

### Solución
Añadir un **select/dropdown de personas** para asignación manual:

- **Ubicación**: En el flujo "Seleccionar persona en foto", cuando no hay detección (o como opción alternativa).
- **Comportamiento**:
  - Si la búsqueda no devuelve rostros → mostrar select "Asignar manualmente a:" con lista de personas + "Crear nueva persona".
  - Si hay rostros pero el usuario prefiere asignar manualmente → botón "Elegir persona manualmente" que abre el select.
- **Select**: Dropdown con todas las personas (People), búsqueda opcional si hay muchas.
- **Acción**: Al elegir persona → `addFaceToPerson` con bbox del área seleccionada. Si no hay embedding (sin detección), el backend debe aceptar región sin embedding o crear un "face" placeholder.

### Cambios técnicos
- **Frontend**: Nuevo componente `PersonSelect` (dropdown de personas); botón "Elegir persona manualmente" en el panel de resultados; integrar en AllPhotos y PersonDetail.
- **API**: En `addFaceToPerson`, cuando no hay `embedding_b64` y `detect_faces` no encuentra rostros, usar **CLIP** (`embed_region`) como fallback. Así toda asignación manual con bbox tendrá embedding (CLIP del crop).
- **Flujo**: Usuario selecciona área → "Elegir persona manualmente" → select persona → `addFaceToPerson(clusterId, fileId, bbox)` sin embedding → backend usa CLIP si no hay face.

---

## 2. FaceCropSelector: no cerrar al soltar el rectángulo

### Problema
Al soltar el rectángulo (mouse up), el selector se cierra o tiene un comportamiento inesperado.

### Causas probables
1. **MouseUp fuera del área**: Si el usuario arrastra y suelta fuera del contenido (ej. en el overlay oscuro), el `mouseup` puede dispararse en el overlay, que tiene `onClick` para cerrar el lightbox.
2. **Selección pequeña**: Si el rectángulo es muy pequeño (< 15px), `handleMouseUp` borra `start`/`current` y el rectángulo desaparece.

### Solución
- **Capturar mouseup a nivel document**: Añadir listener global `mouseup` mientras se está dibujando, para que el release se registre aunque el cursor salga del selector.
- **No cerrar lightbox en cropMode**: El overlay no debe cerrar al hacer click cuando `cropMode === true`; solo cerrar con el botón "✕ Cerrar" explícito.
- **Mantener rectángulo al soltar**: En `handleMouseUp`, no borrar `start`/`current` si la selección es pequeña; solo ignorar el "Buscar" hasta que sea válida. O mostrar mensaje "Selección muy pequeña, intenta de nuevo".

### Cambios técnicos
- **FaceCropSelector.tsx**: `useEffect` que añade `document.addEventListener('mouseup', ...)` cuando `start !== null`, y lo limpia. En el handler, actualizar estado para "fin de arrastre" sin borrar el rect si es válido.
- **AllPhotos/PersonDetail**: En el overlay, no ejecutar `setLightbox(null)` cuando el click viene de dentro del área de contenido en cropMode, o deshabilitar el cierre por click en overlay cuando cropMode está activo.

---

## 3. Recuerdos — agrupaciones manuales de fotos

### Problema
No existe forma de agrupar fotos manualmente sin detección de rostros (ej. "Vacaciones 2024", "Cumpleaños de mamá").

### Solución
Nueva entidad **Recuerdos** (memories):

- **Concepto**: Colecciones manuales de fotos. No usan detección ni clustering.
- **Relación**: Un recuerdo puede tener N fotos. Una foto puede estar en N recuerdos.
- **Personas opcionales**: Un recuerdo puede asociarse a una persona (ej. "Fotos de mamá") o ser independiente.

### Modelo de datos

```
Tabla: memories (recuerdos)
- id (PK)
- label (nombre, ej. "Vacaciones 2024")
- cluster_id (FK opcional, persona asociada)
- created_at

Tabla: memory_files (N:N recuerdo ↔ foto)
- memory_id (FK)
- file_id (FK)
- UNIQUE(memory_id, file_id)
```

### Flujos de usuario

1. **Crear recuerdo**
   - Desde People o All Photos: botón "Crear recuerdo".
   - Modal: nombre, opcionalmente persona asociada.
   - Recuerdo vacío creado.

2. **Añadir fotos a recuerdo**
   - En All Photos: selección múltiple (checkboxes).
   - Toolbar: "Añadir a recuerdo" → select de recuerdos existentes o "Crear nuevo".
   - En Person Detail: similar, para fotos de esa persona.

3. **Vista Recuerdos**
   - Nueva ruta `/recuerdos` (o "Recuerdos" en navbar).
   - Lista de recuerdos con miniatura y contador.
   - Clic → galería de fotos del recuerdo.

4. **Quitar foto de recuerdo**
   - En la galería del recuerdo: botón "Quitar" por foto.

### Cambios técnicos

| Área | Cambios |
|------|---------|
| **DB** | Migración: crear `memories`, `memory_files`. |
| **API** | Endpoints: `GET/POST /memories`, `POST /memories/{id}/add-files`, `DELETE /memories/{id}/files/{file_id}`, `GET /memories/{id}/photos`. |
| **Frontend** | Página `Recuerdos.tsx`, componente selección múltiple en All Photos, integración en Person Detail. |
| **Navbar** | Enlace "Recuerdos". |

---

## Orden sugerido de implementación

1. **FaceCropSelector** — corregir cierre al soltar (rápido).
2. **Selector persona manual** — permitir asignar sin detección (medio).
3. **Recuerdos** — modelo, API, UI (más trabajo).

---

## Resumen

| # | Feature | Esfuerzo | Prioridad |
|---|---------|----------|-----------|
| 1 | Select persona manual | Medio | Alta |
| 2 | FaceCropSelector no cerrar al soltar | Bajo | Alta |
| 3 | Recuerdos (agrupaciones manuales) | Alto | Media |
