import { useEffect, useState, useRef, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api, AlbumOut, FileOut } from "../api";
import PhotoCard from "../components/PhotoCard";
import Spinner from "../components/Spinner";

export default function AlbumDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [album, setAlbum] = useState<AlbumOut | null>(null);
  const [photos, setPhotos] = useState<AlbumPhoto[]>([]);
  const [loading, setLoading] = useState(true);
  const [lightbox, setLightbox] = useState<FileOut | null>(null);
  const [removing, setRemoving] = useState<number | null>(null);
  const [reorderMode, setReorderMode] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [savingOrder, setSavingOrder] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const lastIndexRef = useRef<number | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [viewByFormat, setViewByFormat] = useState(false);
  const [similarModalOpen, setSimilarModalOpen] = useState(false);

  const getExtension = (path: string) => {
    const m = path.match(/\.([^./\\]+)$/i);
    return m ? "." + m[1].toLowerCase() : "(sin ext)";
  };
  const [similarResults, setSimilarResults] = useState<{ file_id: number; similarity: number }[]>([]);
  const [similarMeta, setSimilarMeta] = useState<{
        use_clip: boolean;
        sample_count: number;
        sample_file_ids?: number[];
        cached_count?: number;
        computed_count?: number;
      } | null>(null);
  const [findingSimilar, setFindingSimilar] = useState(false);
  const [similarPoolCount, setSimilarPoolCount] = useState(0);
  const [similarSourceLibrary, setSimilarSourceLibrary] = useState(false);
  const [similarFiles, setSimilarFiles] = useState<Record<number, FileOut>>({});
  const [searchByContent, setSearchByContent] = useState(true);
  const [excludeFacesFromCentroid, setExcludeFacesFromCentroid] = useState(true);
  const [cacheStats, setCacheStats] = useState<{
    total_photos: number;
    cached_count: number;
    positive_count: number;
    negative_count: number;
    pending_count: number;
  } | null>(null);
  const [deletingCache, setDeletingCache] = useState(false);
  const [showConfigPhotos, setShowConfigPhotos] = useState(false);
  const [settingUseInCentroid, setSettingUseInCentroid] = useState<number | null>(null);
  const [similarTab, setSimilarTab] = useState<"sugeridas" | "positivas" | "negativas">("sugeridas");
  const [cacheListItems, setCacheListItems] = useState<{ file_id: number; similarity: number; file?: FileOut }[]>([]);
  const [cacheListTotal, setCacheListTotal] = useState(0);
  const [cacheListFiles, setCacheListFiles] = useState<Record<number, FileOut>>({});
  const [loadingCacheList, setLoadingCacheList] = useState(false);
  const CACHE_PAGE_SIZE = 100;
  const [currentCachePanelOpen, setCurrentCachePanelOpen] = useState(false);
  const [currentCacheView, setCurrentCacheView] = useState<"positivas" | "negativas" | "todas" | null>(null);

  const albumId = id ? parseInt(id, 10) : NaN;

  type AlbumPhoto = FileOut & { use_in_centroid?: boolean };

  const reload = useCallback(() => {
    if (isNaN(albumId)) return;
    setLoading(true);
    Promise.all([api.getAlbum(albumId), api.getAlbumPhotos(albumId)])
      .then(([a, p]) => {
        setAlbum(a);
        setPhotos(p);
      })
      .finally(() => setLoading(false));
    api.getAlbumSearchCacheStats(albumId).then(setCacheStats).catch(() => setCacheStats(null));
  }, [albumId]);

  const refreshCacheStats = useCallback(() => {
    if (!isNaN(albumId)) api.getAlbumSearchCacheStats(albumId).then(setCacheStats).catch(() => setCacheStats(null));
  }, [albumId]);

  useEffect(() => {
    reload();
  }, [reload]);

  const persistOrder = async (ordered: AlbumPhoto[]) => {
    if (isNaN(albumId)) return;
    setSavingOrder(true);
    try {
      await api.reorderAlbumPhotos(
        albumId,
        ordered.map((f) => f.id)
      );
      setPhotos(ordered);
    } catch (e) {
      alert("Error al guardar orden: " + e);
      reload();
    } finally {
      setSavingOrder(false);
    }
  };

  const handleRemove = async (fileId: number) => {
    if (isNaN(albumId)) return;
    setRemoving(fileId);
    try {
      await api.removeFileFromAlbum(albumId, fileId);
      setPhotos((prev) => prev.filter((f) => f.id !== fileId));
      setSelected((s) => {
        const n = new Set(s);
        n.delete(fileId);
        return n;
      });
      setAlbum((prev) => (prev ? { ...prev, file_count: prev.file_count - 1 } : null));
    } catch (e) {
      alert("Error: " + e);
    } finally {
      setRemoving(null);
    }
  };

  const handleRemoveSelected = async () => {
    const ids = Array.from(selected);
    if (ids.length === 0 || isNaN(albumId)) return;
    if (!confirm(`¿Quitar ${ids.length} foto(s) del álbum?`)) return;
    for (const fileId of ids) {
      try {
        await api.removeFileFromAlbum(albumId, fileId);
      } catch (e) {
        alert("Error: " + e);
        reload();
        return;
      }
    }
    setPhotos((prev) => prev.filter((f) => !ids.includes(f.id)));
    setAlbum((prev) =>
      prev ? { ...prev, file_count: prev.file_count - ids.length } : null
    );
    setSelected(new Set());
    setSelectionMode(false);
    lastIndexRef.current = null;
  };

  const toggleSelect = (fileId: number, index: number, e: React.MouseEvent) => {
    if (e.shiftKey) e.preventDefault();
    const shift = e.shiftKey;
    setSelected((prev) => {
      if (shift && lastIndexRef.current !== null) {
        const lo = Math.min(lastIndexRef.current, index);
        const hi = Math.max(lastIndexRef.current, index);
        const next = new Set<number>();
        for (let i = lo; i <= hi; i++) {
          const p = photos[i];
          if (p) next.add(p.id);
        }
        lastIndexRef.current = index;
        return next;
      }
      lastIndexRef.current = index;
      const next = new Set(prev);
      if (next.has(fileId)) next.delete(fileId);
      else next.add(fileId);
      return next;
    });
  };

  const onDragStart = (index: number) => setDragIndex(index);
  const onDragEnd = () => setDragIndex(null);

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const onDrop = async (dropIndex: number) => {
    if (dragIndex === null || dragIndex === dropIndex || isNaN(albumId)) {
      setDragIndex(null);
      return;
    }
    const next = [...photos];
    const [removed] = next.splice(dragIndex, 1);
    next.splice(dropIndex, 0, removed);
    setPhotos(next);
    setDragIndex(null);
    await persistOrder(next);
  };

  const moveItem = async (from: number, dir: -1 | 1) => {
    const to = from + dir;
    if (to < 0 || to >= photos.length) return;
    const next = [...photos];
    const [removed] = next.splice(from, 1);
    next.splice(to, 0, removed);
    setPhotos(next);
    await persistOrder(next);
  };

  const handleRenameAlbum = async () => {
    if (isNaN(albumId) || !album) return;
    try {
      const updated = await api.renameAlbum(albumId, newLabel);
      setAlbum(updated);
      setEditingName(false);
    } catch (e) {
      alert("Error al renombrar: " + e);
    }
  };

  const albumFileIds = new Set(photos.map((p) => p.id));

  const handleFindSimilarHere = async (maxNew = 1000) => {
    if (isNaN(albumId) || photos.length === 0) return;
    setSimilarSourceLibrary(false);
    setSimilarTab("sugeridas");
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
      // CLIP: envío 5000; backend usa cache y procesa máx 100 nuevas por request. Caras: 5000.
      const MAX = 5000;
      for (let skip = 0; skip < MAX; skip += BATCH) {
        const batch = await api.getPhotos(skip, BATCH, "photo");
        if (batch.length === 0) break;
        for (const f of batch) {
          if (!albumFileIds.has(f.id)) {
            pool.push(f.id);
            poolFiles[f.id] = f;
          }
        }
        setSimilarPoolCount(pool.length);
        if (batch.length < BATCH) break;
      }
      const data = await api.findSimilarInPage(
        albumId,
        pool,
        0.35,
        searchByContent,
        maxNew,
        searchByContent ? excludeFacesFromCentroid : false
      );
      setSimilarResults(data.results);
      setSimilarMeta({
          use_clip: data.use_clip,
          sample_count: data.sample_count,
          sample_file_ids: data.sample_file_ids ?? [],
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
      refreshCacheStats();
    } catch (e) {
      alert("Error: " + e);
    } finally {
      setFindingSimilar(false);
    }
  };

  const handleFindSimilarLibrary = async () => {
    if (isNaN(albumId) || photos.length === 0) return;
    setSimilarSourceLibrary(true);
    setSimilarTab("sugeridas");
    setSimilarModalOpen(true);
    setFindingSimilar(true);
    setSimilarResults([]);
    setSimilarMeta(null);
    setSimilarPoolCount(0);
    setSimilarFiles({});
    try {
      const data = await api.findSimilarLibrary(
        albumId,
        1000,
        true,
        searchByContent ? excludeFacesFromCentroid : false
      );
      setSimilarResults(data.results);
      setSimilarMeta({
        use_clip: data.use_clip,
        sample_count: data.sample_count,
        sample_file_ids: data.sample_file_ids ?? [],
        cached_count: data.cached_count ?? 0,
        computed_count: data.computed_count ?? 0,
      });
      const stats = await api.getAlbumSearchCacheStats(albumId);
      setSimilarPoolCount(stats.total_photos);
      const byId: Record<number, FileOut> = {};
      for (const r of data.results) {
        try {
          const f = await api.getPhoto(r.file_id);
          byId[r.file_id] = f;
        } catch {
          /* ignorar */
        }
      }
      setSimilarFiles(byId);
      refreshCacheStats();
    } catch (e) {
      alert("Error: " + e);
    } finally {
      setFindingSimilar(false);
    }
  };

  const handleSetUseInCentroid = async (fileId: number, useInCentroid: boolean) => {
    if (isNaN(albumId)) return;
    setSettingUseInCentroid(fileId);
    try {
      await api.setAlbumFileUseInCentroid(albumId, fileId, useInCentroid);
      setPhotos((prev) =>
        prev.map((p) => (p.id === fileId ? { ...p, use_in_centroid: useInCentroid } : p))
      );
      refreshCacheStats();
    } catch (e) {
      alert("Error: " + e);
    } finally {
      setSettingUseInCentroid(null);
    }
  };

  const loadCacheList = useCallback(
    async (status: "positive" | "negative" | "all", append = false, currentLength = 0) => {
      if (isNaN(albumId)) return;
      setLoadingCacheList(true);
      const skip = append ? currentLength : 0;
      if (!append) {
        setCacheListFiles({});
        setCacheListItems([]);
      }
      try {
        const data = await api.getAlbumSearchCache(albumId, status, skip, CACHE_PAGE_SIZE, true);
        const byId: Record<number, FileOut> = {};
        for (const r of data.items) {
          if (r.file) byId[r.file_id] = r.file;
        }
        setCacheListItems((prev) => (append ? [...prev, ...data.items] : data.items));
        setCacheListTotal(data.total);
        setCacheListFiles((prev) => (append ? { ...prev, ...byId } : byId));
      } catch {
        if (!append) {
          setCacheListItems([]);
          setCacheListTotal(0);
        }
      } finally {
        setLoadingCacheList(false);
      }
    },
    [albumId]
  );

  const loadMoreCacheList = useCallback(() => {
    if (currentCacheView && cacheListItems.length < cacheListTotal) {
      loadCacheList(currentCacheView, true, cacheListItems.length);
    }
  }, [currentCacheView, cacheListItems.length, cacheListTotal, loadCacheList]);

  const handleSetCacheStatus = async (fileId: number, status: "positive" | "negative") => {
    if (isNaN(albumId)) return;
    try {
      await api.setCacheManualStatus(albumId, fileId, status);
      setCacheListItems((prev) => prev.filter((r) => r.file_id !== fileId));
      setCacheListFiles((prev) => {
        const next = { ...prev };
        delete next[fileId];
        return next;
      });
      setCacheListTotal((t) => Math.max(0, t - 1));
      refreshCacheStats();
    } catch (e) {
      alert("Error: " + e);
    }
  };

  const handleAddSimilarToAlbum = async (fileId: number) => {
    if (isNaN(albumId)) return;
    try {
      await api.addFilesToAlbum(albumId, [fileId]);
      setSimilarResults((prev) => prev.filter((r) => r.file_id !== fileId));
      setPhotos((prev) => [...prev, { ...similarFiles[fileId], use_in_centroid: true }].filter(Boolean) as AlbumPhoto[]);
      setAlbum((prev) => (prev ? { ...prev, file_count: (prev.file_count || 0) + 1 } : null));
    } catch (e) {
      alert("Error: " + e);
    }
  };

  if (loading || !album) return <Spinner message="Cargando..." />;

  return (
    <div className="p-6">
      <div className="flex items-center gap-4 mb-6 flex-wrap">
        <button
          onClick={() => navigate("/albums")}
          className="text-gray-400 hover:text-white"
        >
          ← Álbumes
        </button>
        {editingName ? (
          <div className="flex items-center gap-2 flex-wrap">
            <input
              autoFocus
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleRenameAlbum()}
              className="bg-gray-800 border border-gray-600 rounded px-3 py-1 text-white text-xl min-w-[12rem]"
              placeholder="Nombre del álbum"
            />
            <button
              type="button"
              onClick={handleRenameAlbum}
              className="text-sm text-purple-400 hover:text-purple-300"
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
            <h1 className="text-2xl font-bold text-white">{album.label}</h1>
            <button
              type="button"
              onClick={() => {
                setNewLabel(album.label);
                setEditingName(true);
              }}
              className="text-gray-500 hover:text-gray-300 text-sm"
            >
              ✏️ Renombrar
            </button>
            {photos.length > 0 && (
              <button
                type="button"
                onClick={() => setShowConfigPhotos(true)}
                className="text-gray-500 hover:text-gray-300 text-sm"
              >
                📷 Configurar fotos
              </button>
            )}
          </div>
        )}
        <span className="text-gray-500">{album.file_count} elementos</span>
        {photos.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-gray-500">Buscar por:</span>
            <button
              type="button"
              onClick={() => setSearchByContent(true)}
              className={`px-2 py-1 rounded text-xs ${searchByContent ? "bg-purple-600 text-white" : "bg-gray-700 text-gray-400 hover:text-gray-200"}`}
              title="Contenido de la imagen (documentos, papeles, IDs, facturas)"
            >
              Contenido (documentos)
            </button>
            <button
              type="button"
              onClick={() => setSearchByContent(false)}
              className={`px-2 py-1 rounded text-xs ${!searchByContent ? "bg-purple-600 text-white" : "bg-gray-700 text-gray-400 hover:text-gray-200"}`}
              title="Rostros detectados en las fotos"
            >
              Caras
            </button>
          </div>
        )}
        <button
          type="button"
          onClick={() => handleFindSimilarHere(1000)}
          disabled={photos.length === 0 || findingSimilar}
          className="px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white text-sm font-medium"
        >
          {findingSimilar ? "Buscando..." : "Buscar similares aquí"}
        </button>
        <button
          type="button"
          onClick={() => handleFindSimilarHere(0)}
          disabled={photos.length === 0 || findingSimilar}
          className="px-3 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-gray-300 text-sm"
          title="Solo resultados ya en cache (instantáneo si ya buscaste antes)"
        >
          Solo cache
        </button>
        {searchByContent && (
          <button
            type="button"
            onClick={() => handleFindSimilarLibrary()}
            disabled={photos.length === 0 || findingSimilar}
            className="px-3 py-2 rounded-lg bg-indigo-700 hover:bg-indigo-600 disabled:opacity-50 text-indigo-100 text-sm"
            title="Busca en TODA la biblioteca (no solo 5000 fotos). Pool desde backend."
          >
            Buscar en toda la biblioteca
          </button>
        )}
        {cacheStats && searchByContent && (
          <div className="text-xs text-gray-500 flex flex-wrap gap-x-4 gap-y-1">
            <span>Biblioteca: {cacheStats.total_photos.toLocaleString()} fotos</span>
            <span>Chequeadas: {cacheStats.cached_count} (⊕{cacheStats.positive_count} positivos, ⊖{cacheStats.negative_count} negativos)</span>
            <span>Pendientes: {cacheStats.pending_count}</span>
          </div>
        )}
        {photos.length > 0 && searchByContent && (
          <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer">
            <input
              type="checkbox"
              checked={excludeFacesFromCentroid}
              onChange={(e) => setExcludeFacesFromCentroid(e.target.checked)}
            />
            Excluir fotos con caras del centroide (solo documentos puros)
          </label>
        )}
        <span className="text-xs text-gray-500 max-w-md">
          Documentos: 1000 nuevas/request o &quot;Solo cache&quot;. Borrar cache para recalcular.
        </span>
        {cacheStats && cacheStats.cached_count > 0 && (
          <button
            type="button"
            onClick={async () => {
              if (!confirm("¿Borrar todo el caché de búsqueda de este álbum? Deberás volver a buscar similares.")) return;
              setDeletingCache(true);
              try {
                await api.deleteAlbumSearchCache(albumId);
                refreshCacheStats();
                setSimilarResults([]);
                setSimilarFiles({});
                setSimilarMeta(null);
                setCurrentCachePanelOpen(false);
                setCurrentCacheView(null);
              } catch (e) {
                alert("Error: " + e);
              } finally {
                setDeletingCache(false);
              }
            }}
            disabled={deletingCache}
            className="px-3 py-1.5 rounded text-xs bg-amber-800 hover:bg-amber-700 text-amber-100 disabled:opacity-50"
            title="Elimina todos los resultados cacheados. Útil cuando CLIP prioriza caras y quieres recalcular."
          >
            {deletingCache ? "Borrando..." : "Borrar cache"}
          </button>
        )}
        <button
          type="button"
          onClick={() => navigate("/gallery")}
          className="px-3 py-2 rounded-lg border border-gray-600 text-gray-300 hover:bg-gray-700 text-sm"
        >
          Ir a All Photos (añadir más)
        </button>
        {photos.length > 0 && (
          <>
            <button
              type="button"
              onClick={() => setViewByFormat((v) => !v)}
              className={`px-3 py-2 rounded-lg text-sm ${viewByFormat ? "bg-purple-700 text-white" : "bg-gray-700 text-gray-200 hover:bg-gray-600"}`}
              title="Revisar por formato (jpg, png, etc.) — útil para documentos"
            >
              {viewByFormat ? "Ver por orden" : "Agrupar por formato"}
            </button>
            <button
              type="button"
              onClick={() => {
                setReorderMode((r) => !r);
                if (reorderMode) setDragIndex(null);
              }}
              className={`px-4 py-2 rounded-lg text-sm font-medium ${
                reorderMode ? "bg-amber-700 text-white" : "bg-gray-700 text-gray-200 hover:bg-gray-600"
              }`}
            >
              {reorderMode ? "Salir de ordenar" : "Ordenar fotos"}
            </button>
            <button
              type="button"
              onClick={() => {
                setSelectionMode((s) => !s);
                if (selectionMode) {
                  setSelected(new Set());
                  lastIndexRef.current = null;
                }
              }}
              className={`px-4 py-2 rounded-lg text-sm font-medium ${
                selectionMode ? "bg-blue-700 text-white" : "bg-gray-700 text-gray-200 hover:bg-gray-600"
              }`}
            >
              Seleccionar
            </button>
          </>
        )}
      </div>

      {/* Cache actual: sección para ver fotos ya procesadas sin volver a buscar */}
      {cacheStats && cacheStats.cached_count > 0 && searchByContent && (
        <div className="mb-6 rounded-xl border border-purple-800/60 bg-purple-950/30 overflow-hidden">
          <button
            type="button"
            onClick={() => {
              setCurrentCachePanelOpen((v) => !v);
              if (!currentCachePanelOpen) setCurrentCacheView(null);
            }}
            className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-purple-900/30 transition-colors"
          >
            <span className="font-medium text-purple-200">
              Cache actual: {cacheStats.cached_count.toLocaleString()} fotos procesadas — ⊕ {cacheStats.positive_count} positivas (sim≥35%), ⊖ {cacheStats.negative_count} negativas
            </span>
            <span className="text-purple-400">{currentCachePanelOpen ? "▼" : "▶"}</span>
          </button>
          {currentCachePanelOpen && (
            <div className="px-4 pb-4 pt-2 border-t border-purple-800/40">
              <p className="text-sm text-gray-400 mb-3">
                Fotos ya clasificadas en la BD. Sin necesidad de procesar de nuevo.
              </p>
              <div className="flex flex-wrap gap-2 mb-4">
                <button
                  type="button"
                  onClick={() => {
                    setCurrentCacheView("positivas");
                    loadCacheList("positive", false);
                  }}
                  className={`px-3 py-2 rounded-lg text-sm font-medium ${
                    currentCacheView === "positivas" ? "bg-green-700 text-white" : "bg-gray-700 text-gray-300 hover:bg-gray-600"
                  }`}
                >
                  ⊕ Ver positivas ({cacheStats.positive_count})
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setCurrentCacheView("negativas");
                    loadCacheList("negative", false);
                  }}
                  className={`px-3 py-2 rounded-lg text-sm font-medium ${
                    currentCacheView === "negativas" ? "bg-amber-700 text-white" : "bg-gray-700 text-gray-300 hover:bg-gray-600"
                  }`}
                >
                  ⊖ Ver negativas ({cacheStats.negative_count})
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setCurrentCacheView("todas");
                    loadCacheList("all", false);
                  }}
                  className={`px-3 py-2 rounded-lg text-sm font-medium ${
                    currentCacheView === "todas" ? "bg-purple-700 text-white" : "bg-gray-700 text-gray-300 hover:bg-gray-600"
                  }`}
                >
                  Ver todas las procesadas ({cacheStats.cached_count})
                </button>
              </div>
              {currentCacheView && (
                loadingCacheList ? (
                  <div className="flex justify-center py-12">
                    <Spinner message="Cargando..." />
                  </div>
                ) : cacheListItems.length === 0 ? (
                  <p className="text-gray-500 py-4">No hay resultados en esta categoría.</p>
                ) : (
                  <>
                    {cacheListTotal > cacheListItems.length && (
                      <div className="flex items-center gap-3 mb-3">
                        <p className="text-xs text-gray-500">
                          Mostrando {cacheListItems.length} de {cacheListTotal.toLocaleString()}
                        </p>
                        <button
                          type="button"
                          onClick={loadMoreCacheList}
                          disabled={loadingCacheList}
                          className="px-3 py-1.5 rounded text-sm bg-purple-700 hover:bg-purple-600 disabled:opacity-50 text-white"
                        >
                          {loadingCacheList ? "Cargando…" : "Cargar más"}
                        </button>
                      </div>
                    )}
                  <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-12 gap-2">
                    {cacheListItems.map((r) => {
                      const f = cacheListFiles[r.file_id];
                      if (!f) return null;
                      return (
                        <div key={r.file_id} className="relative group">
                          <PhotoCard file={f} onClick={() => setLightbox(f)} />
                          <div
                            className="absolute inset-0 flex flex-col items-center justify-center gap-1 opacity-0 group-hover:opacity-100 bg-black/60 rounded-lg transition-opacity pointer-events-none group-hover:pointer-events-auto cursor-pointer"
                            onClick={() => setLightbox(f)}
                          >
                            {currentCacheView === "positivas" && (
                              <button
                                onClick={(e) => { e.stopPropagation(); handleAddSimilarToAlbum(r.file_id); }}
                                className="px-2 py-1 rounded text-white text-xs bg-purple-600 hover:bg-purple-500"
                              >
                                + Álbum
                              </button>
                            )}
                            {currentCacheView === "positivas" && (
                              <button
                                onClick={(e) => { e.stopPropagation(); handleSetCacheStatus(r.file_id, "negative"); }}
                                className="px-2 py-1 rounded text-white text-xs bg-amber-700 hover:bg-amber-600"
                              >
                                → Negativas
                              </button>
                            )}
                            {currentCacheView === "negativas" && (
                              <button
                                onClick={(e) => { e.stopPropagation(); handleSetCacheStatus(r.file_id, "positive"); }}
                                className="px-2 py-1 rounded text-white text-xs bg-green-700 hover:bg-green-600"
                              >
                                → Positivas
                              </button>
                            )}
                            {currentCacheView === "todas" && (
                              <>
                                <button
                                  onClick={(e) => { e.stopPropagation(); handleSetCacheStatus(r.file_id, "positive"); }}
                                  className="px-2 py-1 rounded text-white text-xs bg-green-700 hover:bg-green-600"
                                >
                                  → ⊕
                                </button>
                                <button
                                  onClick={(e) => { e.stopPropagation(); handleSetCacheStatus(r.file_id, "negative"); }}
                                  className="px-2 py-1 rounded text-white text-xs bg-amber-700 hover:bg-amber-600"
                                >
                                  → ⊖
                                </button>
                              </>
                            )}
                          </div>
                          <span className="absolute bottom-0 left-0 right-0 text-xs bg-black/70 text-center py-0.5">
                            {Math.round(r.similarity * 100)}%
                          </span>
                        </div>
                      );
                    })}
                  </div>
                  </>
                )
              )}
            </div>
          )}
        </div>
      )}

      {selectionMode && photos.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-3 px-4 py-3 rounded-lg bg-blue-900/30 border border-blue-800 text-sm text-blue-100">
          <span>
            {selected.size} seleccionada{selected.size !== 1 ? "s" : ""}.{" "}
            <strong>Clic</strong>: marcar o desmarcar. <strong>Shift + clic</strong>: rango.
          </span>
          <button
            type="button"
            disabled={selected.size === 0 || removing !== null}
            onClick={handleRemoveSelected}
            className="px-3 py-1.5 rounded-lg bg-red-700 hover:bg-red-600 disabled:opacity-50 text-white"
          >
            Quitar del álbum
          </button>
          <button
            type="button"
            onClick={() => {
              setSelectionMode(false);
              setSelected(new Set());
              lastIndexRef.current = null;
            }}
            className="text-blue-300 hover:text-white"
          >
            Cancelar
          </button>
        </div>
      )}

      {reorderMode && photos.length > 0 && (
        <p className="mb-4 text-sm text-amber-200/90 px-1">
          Arrastra una miniatura sobre otra para cambiar el orden. También puedes usar ↑ ↓ en cada foto.
          {savingOrder && <span className="ml-2 text-gray-400">Guardando…</span>}
        </p>
      )}

      {photos.length === 0 ? (
        <div className="text-center py-24 text-gray-500">
          <p className="text-lg">No hay fotos en este álbum.</p>
          <p className="text-sm mt-2">Ve a All Photos, selecciona fotos y añádelas. Tras 10 fotos, usa &quot;Encontrar similares&quot;.</p>
          <button
            onClick={() => navigate("/gallery")}
            className="mt-4 px-4 py-2 rounded-lg bg-gray-700 hover:bg-gray-600"
          >
            Ir a All Photos
          </button>
        </div>
      ) : viewByFormat ? (
        (() => {
          const byExt = new Map<string, typeof photos>();
          for (const f of photos) {
            const ext = getExtension(f.path || "");
            if (!byExt.has(ext)) byExt.set(ext, []);
            byExt.get(ext)!.push(f);
          }
          const sortedExts = Array.from(byExt.keys()).sort((a, b) => (a === "(sin ext)" ? 1 : b === "(sin ext)" ? -1 : a.localeCompare(b)));
          return (
            <div className="space-y-6">
              {sortedExts.map((ext) => (
                <section key={ext}>
                  <h3 className="text-sm font-medium text-gray-400 mb-2 sticky top-16 z-10 bg-gray-900 py-1">
                    {ext} <span className="text-gray-500">({byExt.get(ext)!.length})</span>
                  </h3>
                  <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-12 gap-1">
                    {byExt.get(ext)!.map((f, idx) => (
                      <div key={f.id} className="relative group rounded-lg">
                        <PhotoCard
                          file={f}
                          onClick={() => setLightbox(f)}
                          highlight={lightbox?.id === f.id}
                        />
                      </div>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          );
        })()
      ) : (
        <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-12 gap-1">
          {photos.map((f, index) => (
            <div
              key={f.id}
              draggable={reorderMode}
              onDragStart={() => onDragStart(index)}
              onDragEnd={onDragEnd}
              onDragOver={onDragOver}
              onDrop={() => onDrop(index)}
              className={`relative group rounded-lg ${
                reorderMode ? "cursor-grab active:cursor-grabbing ring-1 ring-amber-600/50" : ""
              } ${dragIndex === index ? "opacity-60" : ""}`}
            >
              {reorderMode && (
                <div className="absolute top-1 left-1 z-10 flex flex-col gap-0.5">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      moveItem(index, -1);
                    }}
                    disabled={index === 0 || savingOrder}
                    className="w-6 h-6 rounded bg-gray-900/90 text-white text-xs hover:bg-gray-700 disabled:opacity-30"
                    title="Subir"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      moveItem(index, 1);
                    }}
                    disabled={index === photos.length - 1 || savingOrder}
                    className="w-6 h-6 rounded bg-gray-900/90 text-white text-xs hover:bg-gray-700 disabled:opacity-30"
                    title="Bajar"
                  >
                    ↓
                  </button>
                </div>
              )}
              <PhotoCard
                file={f}
                onClick={
                  selectionMode
                    ? undefined
                    : reorderMode
                      ? undefined
                      : () => setLightbox(f)
                }
                selectable={selectionMode}
                selected={selected.has(f.id)}
                onSelect={
                  selectionMode
                    ? (e) => toggleSelect(f.id, index, e)
                    : undefined
                }
                highlight={lightbox?.id === f.id}
              />
              {!selectionMode && !reorderMode && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRemove(f.id);
                  }}
                  disabled={removing === f.id}
                  className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 bg-red-600 hover:bg-red-500 text-white rounded p-1 text-xs disabled:opacity-50 transition-opacity z-10"
                >
                  {removing === f.id ? "…" : "✕"}
                </button>
              )}
            </div>
          ))}
        </div>
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

      {showConfigPhotos && (
        <div
          className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center p-4"
          onClick={() => setShowConfigPhotos(false)}
        >
          <div
            className="bg-gray-900 rounded-xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-4 border-b border-gray-700 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-white">
                Fotos del álbum {album?.label}
              </h2>
              <button
                onClick={() => setShowConfigPhotos(false)}
                className="text-gray-400 hover:text-white text-2xl"
              >
                ✕
              </button>
            </div>
            <div className="p-4 border-b border-gray-700 text-sm text-gray-400">
              <p>
                <strong className="text-amber-400">Centroide</strong> = fotos usadas para buscar similares (CLIP).{" "}
                <strong className="text-red-400">Excluir</strong> = no usar en comparaciones.{" "}
                <strong className="text-red-400">✕</strong> = quitar del álbum.
              </p>
            </div>
            <div className="p-4 overflow-y-auto flex-1">
              <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-4">
                {photos.map((f) => (
                  <div
                    key={f.id}
                    className={`flex flex-col items-center gap-2 p-2 rounded-lg border transition-colors ${
                      f.use_in_centroid !== false
                        ? "bg-gray-800 border-gray-700 hover:border-purple-500"
                        : "bg-gray-800/60 border-amber-900/50 opacity-75"
                    }`}
                  >
                    {f.thumbnail_path ? (
                      <img
                        src={api.thumbnailUrl(f.thumbnail_path)}
                        alt=""
                        className="w-16 h-16 rounded-lg object-cover"
                      />
                    ) : (
                      <div className="w-16 h-16 rounded-lg bg-gray-700 flex items-center justify-center text-xs text-gray-500">
                        ?
                      </div>
                    )}
                    <div className="flex flex-wrap gap-1 w-full justify-center">
                      <button
                        onClick={() => handleSetUseInCentroid(f.id, f.use_in_centroid === false)}
                        disabled={settingUseInCentroid === f.id}
                        title={
                          f.use_in_centroid !== false
                            ? "Excluir del centroide (no usará en comparaciones)"
                            : "Incluir en centroide"
                        }
                        className={`text-xs px-2 py-1 rounded ${
                          f.use_in_centroid !== false ? "bg-amber-700 hover:bg-amber-600" : "bg-green-800 hover:bg-green-700"
                        } text-white disabled:opacity-50`}
                      >
                        {settingUseInCentroid === f.id ? "…" : f.use_in_centroid !== false ? "Excluir" : "Incluir"}
                      </button>
                      <button
                        onClick={async () => {
                          if (confirm("¿Quitar esta foto del álbum?")) {
                            await handleRemove(f.id);
                            if (photos.length <= 1) setShowConfigPhotos(false);
                          }
                        }}
                        disabled={removing === f.id}
                        title="Quitar del álbum"
                        className="text-xs px-2 py-1 rounded bg-red-900/80 hover:bg-red-800 text-white disabled:opacity-50"
                      >
                        {removing === f.id ? "…" : "✕"}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
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
                  Similares al álbum —{" "}
                  {similarSourceLibrary ? "toda la biblioteca" : `${similarPoolCount.toLocaleString()} fotos cargadas`}
                </h2>
                {similarMeta && (
                  <p className="text-sm text-gray-400 mt-0.5">
                    Usando {similarMeta.sample_count} fotos del álbum. Modo: {similarMeta.use_clip ? "Contenido (documentos)" : "Caras"}
                    {similarMeta.cached_count !== undefined && similarMeta.computed_count !== undefined && similarMeta.use_clip && (
                      <> · Cache: {similarMeta.cached_count} ya procesadas, {similarMeta.computed_count} nuevas esta vez</>
                    )}
                  </p>
                )}
                {photos.length > 0 && (
                  <div className="mt-2">
                    <p className="text-xs text-gray-500 mb-1">
                      Cluster del álbum (muestras usadas para buscar — igual que Persona con rostros):
                    </p>
                    <div className="flex gap-1 overflow-x-auto pb-1 max-w-full">
                      {(
                        similarMeta?.sample_file_ids && similarMeta.sample_file_ids.length > 0
                          ? photos.filter((f) => similarMeta!.sample_file_ids!.includes(f.id))
                          : photos
                      )
                        .slice(0, 24)
                        .map((f) => (
                          <div
                            key={f.id}
                            className="shrink-0 w-12 h-12 rounded overflow-hidden ring-2 ring-purple-500/80 bg-gray-800"
                            title={
                              similarMeta?.sample_file_ids?.length && similarMeta.sample_file_ids.includes(f.id)
                                ? "Usada en centroide"
                                : f.path?.split(/[/\\]/).pop()
                            }
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
                      {similarMeta?.sample_file_ids &&
                        photos.filter((f) => similarMeta.sample_file_ids!.includes(f.id)).length > 24 && (
                          <span className="shrink-0 self-center text-xs text-gray-500 pl-1">
                            +{photos.filter((f) => similarMeta.sample_file_ids!.includes(f.id)).length - 24} más
                          </span>
                        )}
                      {similarMeta?.sample_file_ids?.length &&
                        photos.some((f) => !similarMeta.sample_file_ids!.includes(f.id)) && (
                          <span className="shrink-0 self-center text-xs text-amber-500/90 pl-1" title="Excluidas del centroide (tienen caras)">
                            {photos.filter((f) => !similarMeta!.sample_file_ids!.includes(f.id)).length} excluidas
                          </span>
                        )}
                      {(!similarMeta?.sample_file_ids?.length || similarMeta.sample_file_ids.length === 0) &&
                        photos.length > 24 && (
                          <span className="shrink-0 self-center text-xs text-gray-500 pl-1">+{photos.length - 24} más</span>
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
            {searchByContent && cacheStats && (
              <div className="px-4 pb-2 flex gap-2 border-b border-gray-700">
                <button
                  type="button"
                  onClick={() => setSimilarTab("sugeridas")}
                  className={`px-3 py-1 rounded text-sm ${similarTab === "sugeridas" ? "bg-purple-600 text-white" : "bg-gray-700 text-gray-400 hover:text-white"}`}
                >
                  Sugeridas
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSimilarTab("positivas");
                    loadCacheList("positive");
                  }}
                  className={`px-3 py-1 rounded text-sm ${similarTab === "positivas" ? "bg-green-700 text-white" : "bg-gray-700 text-gray-400 hover:text-white"}`}
                >
                  ⊕ Positivas ({cacheStats.positive_count})
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSimilarTab("negativas");
                    loadCacheList("negative");
                  }}
                  className={`px-3 py-1 rounded text-sm ${similarTab === "negativas" ? "bg-amber-700 text-white" : "bg-gray-700 text-gray-400 hover:text-white"}`}
                >
                  ⊖ Negativas ({cacheStats.negative_count})
                </button>
              </div>
            )}
            <div className="p-4 overflow-auto flex-1">
              {findingSimilar ? (
                <div className="flex flex-col items-center justify-center py-16 text-gray-400">
                  <Spinner message={`Cargando pool (${similarPoolCount.toLocaleString()} fotos) y buscando...`} />
                </div>
              ) : similarTab === "positivas" || similarTab === "negativas" ? (
                loadingCacheList ? (
                  <div className="flex flex-col items-center justify-center py-16 text-gray-400">
                    <Spinner message="Cargando..." />
                  </div>
                ) : cacheListItems.length === 0 ? (
                  <div className="text-center py-16 text-gray-400">
                    {similarTab === "positivas" ? "No hay positivas en cache." : "No hay negativas en cache."}
                  </div>
                ) : (
                  <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-12 gap-2">
                    {cacheListItems.map((r) => {
                      const f = cacheListFiles[r.file_id];
                      if (!f) return null;
                      return (
                        <div key={r.file_id} className="relative group">
                          <PhotoCard file={f} onClick={() => setLightbox(f)} />
                          <div
                            className="absolute inset-0 flex flex-col items-center justify-center gap-1 opacity-0 group-hover:opacity-100 bg-black/60 rounded-lg transition-opacity pointer-events-none group-hover:pointer-events-auto cursor-pointer"
                            onClick={() => setLightbox(f)}
                          >
                            {similarTab === "positivas" && (
                              <button
                                onClick={(e) => { e.stopPropagation(); handleAddSimilarToAlbum(r.file_id); }}
                                className="px-2 py-1 rounded text-white text-xs bg-purple-600 hover:bg-purple-500"
                              >
                                + Álbum
                              </button>
                            )}
                            {similarTab === "positivas" && (
                              <button
                                onClick={(e) => { e.stopPropagation(); handleSetCacheStatus(r.file_id, "negative"); }}
                                className="px-2 py-1 rounded text-white text-xs bg-amber-700 hover:bg-amber-600"
                              >
                                → Negativas
                              </button>
                            )}
                            {similarTab === "negativas" && (
                              <button
                                onClick={(e) => { e.stopPropagation(); handleSetCacheStatus(r.file_id, "positive"); }}
                                className="px-2 py-1 rounded text-white text-xs bg-green-700 hover:bg-green-600"
                              >
                                → Positivas
                              </button>
                            )}
                          </div>
                          <span className="absolute bottom-0 left-0 right-0 text-xs bg-black/70 text-center py-0.5">
                            {Math.round(r.similarity * 100)}%
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )
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
                            onClick={(e) => { e.stopPropagation(); handleAddSimilarToAlbum(r.file_id); }}
                            className="px-2 py-1 rounded text-white text-xs bg-purple-600 hover:bg-purple-500"
                          >
                            + Álbum
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
