import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api, MemoryOut, FileOut } from "../api";
import PhotoCard from "../components/PhotoCard";
import Spinner from "../components/Spinner";

export default function RecuerdoDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [memory, setMemory] = useState<MemoryOut | null>(null);
  const [photos, setPhotos] = useState<FileOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [lightbox, setLightbox] = useState<FileOut | null>(null);
  const [removing, setRemoving] = useState<number | null>(null);
  const [similarModalOpen, setSimilarModalOpen] = useState(false);
  const [similarResults, setSimilarResults] = useState<{ file_id: number; similarity: number }[]>([]);
  const [similarMeta, setSimilarMeta] = useState<{
        use_clip: boolean;
        sample_count: number;
        cached_count?: number;
        computed_count?: number;
      } | null>(null);
  const [findingSimilar, setFindingSimilar] = useState(false);
  const [similarPoolCount, setSimilarPoolCount] = useState(0);
  const [similarFiles, setSimilarFiles] = useState<Record<number, FileOut>>({});
  const [searchByContent, setSearchByContent] = useState(true);
  const [editingName, setEditingName] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [viewByFormat, setViewByFormat] = useState(false);

  const memoryId = id ? parseInt(id, 10) : NaN;

  const getExtension = (path: string) => {
    const m = path.match(/\.([^./\\]+)$/i);
    return m ? "." + m[1].toLowerCase() : "(sin ext)";
  };

  const reload = () => {
    if (isNaN(memoryId)) return;
    setLoading(true);
    Promise.all([api.getMemory(memoryId), api.getMemoryPhotos(memoryId)])
      .then(([m, p]) => {
        setMemory(m);
        setPhotos(p);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => { reload(); }, [memoryId]);

  const handleRemove = async (fileId: number) => {
    if (isNaN(memoryId)) return;
    setRemoving(fileId);
    try {
      await api.removeFileFromMemory(memoryId, fileId);
      setPhotos((prev) => prev.filter((f) => f.id !== fileId));
      setMemory((prev) => prev ? { ...prev, file_count: prev.file_count - 1 } : null);
    } catch (e) {
      alert("Error: " + e);
    } finally {
      setRemoving(null);
    }
  };

  const memoryFileIds = new Set(photos.map((p) => p.id));

  const handleFindSimilarHere = async (maxNew = 50) => {
    if (isNaN(memoryId) || photos.length === 0) return;
    setSimilarModalOpen(true);
    setFindingSimilar(true);
    setSimilarResults([]);
    setSimilarMeta(null);
    setSimilarPoolCount(0);
    setSimilarFiles({});
    try {
      const pool: number[] = [];
      const poolFiles: Record<number, FileOut> = {};
      const BATCH = 500;
      const MAX = 5000;
      for (let skip = 0; skip < MAX; skip += BATCH) {
        const batch = await api.getPhotos(skip, BATCH, "photo");
        if (batch.length === 0) break;
        for (const f of batch) {
          if (!memoryFileIds.has(f.id)) {
            pool.push(f.id);
            poolFiles[f.id] = f;
          }
        }
        setSimilarPoolCount(pool.length);
        if (batch.length < BATCH) break;
      }
      const data = await api.findSimilarMemoryInPage(memoryId, pool, 0.35, searchByContent, maxNew);
      setSimilarResults(data.results);
      setSimilarMeta({
          use_clip: data.use_clip,
          sample_count: data.sample_count,
          cached_count: data.cached_count ?? 0,
          computed_count: data.computed_count ?? 0,
        });
      const byId: Record<number, FileOut> = {};
      for (const r of data.results) {
        if (poolFiles[r.file_id]) byId[r.file_id] = poolFiles[r.file_id];
        else {
          try {
            const f = await api.getPhoto(r.file_id);
            byId[r.file_id] = f;
          } catch {
            /* ignorar */
          }
        }
      }
      setSimilarFiles(byId);
    } catch (e) {
      alert("Error: " + e);
    } finally {
      setFindingSimilar(false);
    }
  };

  const handleAddSimilarToMemory = async (fileId: number) => {
    if (isNaN(memoryId)) return;
    try {
      await api.addFilesToMemory(memoryId, [fileId]);
      setSimilarResults((prev) => prev.filter((r) => r.file_id !== fileId));
      const f = similarFiles[fileId];
      if (f) setPhotos((prev) => [...prev, f]);
      setMemory((prev) => (prev ? { ...prev, file_count: (prev.file_count || 0) + 1 } : null));
    } catch (e) {
      alert("Error: " + e);
    }
  };

  const handleRenameMemory = async () => {
    if (isNaN(memoryId) || !memory) return;
    try {
      const updated = await api.renameMemory(memoryId, newLabel);
      setMemory(updated);
      setEditingName(false);
    } catch (e) {
      alert("Error al renombrar: " + e);
    }
  };

  if (loading || !memory) return <Spinner message="Cargando..." />;

  const byYear: Record<string, FileOut[]> = {};
  const byExt = new Map<string, FileOut[]>();
  for (const f of photos) {
    const year = f.exif_date ? new Date(f.exif_date).getFullYear().toString() : "Sin fecha";
    (byYear[year] ??= []).push(f);
    const ext = getExtension(f.path || "");
    if (!byExt.has(ext)) byExt.set(ext, []);
    byExt.get(ext)!.push(f);
  }
  const years = Object.keys(byYear).sort((a, b) => b.localeCompare(a));
  const sortedExts = Array.from(byExt.keys()).sort((a, b) => (a === "(sin ext)" ? 1 : b === "(sin ext)" ? -1 : a.localeCompare(b)));

  return (
    <div className="p-6">
      <div className="flex items-center gap-4 mb-6">
        <button
          onClick={() => navigate("/recuerdos")}
          className="text-gray-400 hover:text-white"
        >
          ← Recuerdos
        </button>
        {editingName ? (
          <div className="flex items-center gap-2 flex-wrap">
            <input
              autoFocus
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleRenameMemory()}
              className="bg-gray-800 border border-gray-600 rounded px-3 py-1 text-white text-xl min-w-[12rem]"
              placeholder="Nombre del recuerdo"
            />
            <button
              type="button"
              onClick={handleRenameMemory}
              className="text-sm text-green-400 hover:text-green-300"
            >
              Guardar
            </button>
            <button
              type="button"
              onClick={() => setEditingName(false)}
              className="text-sm text-gray-500 hover:text-gray-400"
            >
              Cancelar
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-bold text-white">{memory.label}</h1>
            <button
              type="button"
              onClick={() => {
                setNewLabel(memory.label);
                setEditingName(true);
              }}
              className="text-gray-500 hover:text-gray-300 text-sm"
            >
              ✏️ Renombrar
            </button>
          </div>
        )}
        <span className="text-gray-500">{memory.file_count} fotos</span>
        <button
          type="button"
          onClick={() => navigate("/gallery")}
          className="px-4 py-2 rounded-lg border border-gray-600 text-gray-300 hover:bg-gray-700 text-sm"
        >
          Ir a All Photos (añadir más)
        </button>
        {photos.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-gray-500">Buscar por:</span>
            <button
              type="button"
              onClick={() => setSearchByContent(true)}
              className={`px-2 py-1 rounded text-xs ${searchByContent ? "bg-green-600 text-white" : "bg-gray-700 text-gray-400 hover:text-gray-200"}`}
              title="Contenido (documentos, papeles)"
            >
              Contenido (documentos)
            </button>
            <button
              type="button"
              onClick={() => setSearchByContent(false)}
              className={`px-2 py-1 rounded text-xs ${!searchByContent ? "bg-green-600 text-white" : "bg-gray-700 text-gray-400 hover:text-gray-200"}`}
              title="Rostros"
            >
              Caras
            </button>
          </div>
        )}
        <button
          type="button"
          onClick={() => handleFindSimilarHere(50)}
          disabled={photos.length === 0 || findingSimilar}
          className="px-4 py-2 rounded-lg bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white text-sm font-medium"
        >
          {findingSimilar ? "Buscando..." : "Buscar similares aquí"}
        </button>
        <button
          type="button"
          onClick={() => handleFindSimilarHere(0)}
          disabled={photos.length === 0 || findingSimilar}
          className="px-3 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-gray-300 text-sm"
          title="Solo cache (instantáneo)"
        >
          Solo cache
        </button>
        <span className="text-xs text-gray-500 max-w-md">
          Busca en ~5000 fotos. Documentos: cache en BD (100 nuevas/request). Caras: instantáneo. Las sugerencias aparecen aquí (no te envía a la galería).
        </span>
        {photos.length > 0 && (
          <button
            type="button"
            onClick={() => setViewByFormat((v) => !v)}
            className={`px-3 py-2 rounded-lg text-sm ${viewByFormat ? "bg-purple-700 text-white" : "bg-gray-700 text-gray-300 hover:bg-gray-600"}`}
            title="Revisar por formato (jpg, png, etc.) — útil para documentos"
          >
            {viewByFormat ? "Ver por año" : "Agrupar por formato"}
          </button>
        )}
      </div>

      {photos.length === 0 ? (
        <div className="text-center py-24 text-gray-500">
          <p className="text-lg">No hay fotos en este recuerdo.</p>
          <p className="text-sm mt-2">Ve a All Photos, selecciona fotos y usa el menú Recuerdo para añadirlas aquí.</p>
          <button
            onClick={() => navigate("/gallery")}
            className="mt-4 px-4 py-2 rounded-lg bg-gray-700 hover:bg-gray-600"
          >
            Ir a All Photos
          </button>
        </div>
      ) : viewByFormat ? (
        <div className="space-y-6">
          {sortedExts.map((ext) => (
            <section key={ext}>
              <h2 className="text-xl font-semibold text-gray-300 mb-4 border-b border-gray-800 pb-2">
                {ext} <span className="text-sm text-gray-500">({byExt.get(ext)!.length})</span>
              </h2>
              <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-12 gap-1">
                {byExt.get(ext)!.map((f) => (
                  <div key={f.id} className="relative group">
                    <PhotoCard
                      file={f}
                      onClick={() => setLightbox(f)}
                      highlight={lightbox?.id === f.id}
                    />
                    <button
                      onClick={(e) => { e.stopPropagation(); handleRemove(f.id); }}
                      disabled={removing === f.id}
                      className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 bg-red-600 hover:bg-red-500 text-white rounded p-1 text-xs disabled:opacity-50 transition-opacity"
                    >
                      {removing === f.id ? "…" : "✕"}
                    </button>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : (
        years.map((year) => (
          <div key={year} className="mb-10">
            <h2 className="text-xl font-semibold text-gray-300 mb-4 border-b border-gray-800 pb-2">
              {year} <span className="text-sm text-gray-500">({byYear[year].length})</span>
            </h2>
            <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-12 gap-1">
              {byYear[year].map((f) => (
                <div key={f.id} className="relative group">
                  <PhotoCard
                    file={f}
                    onClick={() => setLightbox(f)}
                    highlight={lightbox?.id === f.id}
                  />
                  <button
                    onClick={(e) => { e.stopPropagation(); handleRemove(f.id); }}
                    disabled={removing === f.id}
                    className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 bg-red-600 hover:bg-red-500 text-white rounded p-1 text-xs disabled:opacity-50 transition-opacity"
                  >
                    {removing === f.id ? "…" : "✕"}
                  </button>
                </div>
              ))}
            </div>
          </div>
        ))
      )}

      {lightbox && (
        <div
          className="fixed inset-0 bg-black/90 z-[60] flex items-center justify-center p-4"
          onClick={() => setLightbox(null)}
        >
          <div onClick={(e) => e.stopPropagation()} className="max-w-5xl w-full">
            {lightbox.file_type === "photo" ? (
              <img
                src={api.originalUrl(lightbox.id)}
                alt=""
                className="max-w-full max-h-[85vh] object-contain rounded-lg"
              />
            ) : (
              <video
                src={api.originalUrl(lightbox.id)}
                controls
                preload="auto"
                className="max-w-full max-h-[85vh] rounded-lg bg-black"
              />
            )}
            <button onClick={() => setLightbox(null)} className="mt-2 text-gray-400 hover:text-white">
              ✕ Cerrar
            </button>
          </div>
        </div>
      )}

      {similarModalOpen && (
        <div
          className="fixed inset-0 bg-black/90 z-50 flex flex-col p-6 overflow-hidden"
          onClick={() => setSimilarModalOpen(false)}
        >
          <div
            className="bg-gray-900 rounded-xl max-w-6xl w-full max-h-[90vh] overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-4 border-b border-gray-700 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 shrink-0">
              <div>
                <h2 className="text-lg font-semibold text-white">
                  Similares al recuerdo — busca en {similarPoolCount.toLocaleString()} fotos cargadas
                </h2>
                {similarMeta && (
                  <p className="text-sm text-gray-400 mt-0.5">
                    Usando {similarMeta.sample_count} fotos del recuerdo. Modo: {similarMeta.use_clip ? "Contenido (documentos)" : "Caras"}
                    {similarMeta.cached_count !== undefined && similarMeta.computed_count !== undefined && similarMeta.use_clip && (
                      <> · Cache: {similarMeta.cached_count} ya procesadas, {similarMeta.computed_count} nuevas</>
                    )}
                  </p>
                )}
                {photos.length > 0 && (
                  <div className="mt-2">
                    <p className="text-xs text-gray-500 mb-1">Cluster del recuerdo (muestras usadas para buscar):</p>
                    <div className="flex gap-1 overflow-x-auto pb-1 max-w-full">
                      {photos.slice(0, 20).map((f) => (
                        <div
                          key={f.id}
                          className="shrink-0 w-12 h-12 rounded overflow-hidden ring-1 ring-gray-600 bg-gray-800"
                          title={f.path?.split(/[/\\]/).pop()}
                        >
                          {f.thumbnail_path ? (
                            <img
                              src={api.thumbnailUrl(f.thumbnail_path)}
                              alt=""
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-xs text-gray-500">?</div>
                          )}
                        </div>
                      ))}
                      {photos.length > 20 && (
                        <span className="shrink-0 self-center text-xs text-gray-500 pl-1">+{photos.length - 20} más</span>
                      )}
                    </div>
                  </div>
                )}
              </div>
              <button
                onClick={() => setSimilarModalOpen(false)}
                className="text-gray-400 hover:text-white text-2xl"
              >
                ✕
              </button>
            </div>
            <div className="p-4 overflow-auto flex-1">
              {findingSimilar ? (
                <div className="flex flex-col items-center justify-center py-16 text-gray-400">
                  <Spinner message={`Cargando pool (${similarPoolCount.toLocaleString()} fotos) y buscando...`} />
                </div>
              ) : similarResults.length === 0 ? (
                <div className="text-center py-16 text-gray-400">
                  {similarPoolCount > 0 ? "No se encontraron fotos similares." : "Sin resultados."}
                </div>
              ) : (
                <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-12 gap-2">
                  {similarResults.map((r) => {
                    const f = similarFiles[r.file_id];
                    if (!f) return null;
                    return (
                      <div key={r.file_id} className="relative group">
                        <PhotoCard file={f} onClick={() => setLightbox(f)} />
                        <div
                          className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 bg-black/60 rounded-lg transition-opacity pointer-events-none group-hover:pointer-events-auto cursor-pointer"
                          onClick={() => setLightbox(f)}
                        >
                          <button
                            onClick={(e) => { e.stopPropagation(); handleAddSimilarToMemory(r.file_id); }}
                            className="px-2 py-1 rounded text-white text-xs bg-green-600 hover:bg-green-500"
                          >
                            + Recuerdo
                          </button>
                        </div>
                        <span className="absolute bottom-0 left-0 right-0 text-xs bg-black/70 text-center py-0.5">
                          {Math.round(r.similarity * 100)}%
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
