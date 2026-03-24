import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { api, ClusterOut, FileOut, MemoryOut, AlbumOut, SearchResult } from "../api";
import FaceCropSelector from "../components/FaceCropSelector";
import PhotoCard from "../components/PhotoCard";
import Spinner from "../components/Spinner";
import AssignDropdown from "../components/AssignDropdown";
import { useInfiniteScroll } from "../hooks/useInfiniteScroll";

export default function AllPhotos() {
  const [photos, setPhotos] = useState<FileOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [lightbox, setLightbox] = useState<FileOut | null>(null);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [cropMode, setCropMode] = useState(false);
  const [cropResults, setCropResults] = useState<{
    faces: Array<{ bbox: number[]; det_score: number; suggestions: SearchResult[]; embedding_b64?: string }>;
  } | null>(null);
  const [cropSearching, setCropSearching] = useState(false);
  const [allPeople, setAllPeople] = useState<ClusterOut[]>([]);
  const [addingFace, setAddingFace] = useState<{ faceIdx: number; clusterId: number } | null>(null);
  const [creatingNew, setCreatingNew] = useState<{ faceIdx: number } | null>(null);
  const [newPersonLabels, setNewPersonLabels] = useState<Record<number, string>>({});
  const [manualAssignBbox, setManualAssignBbox] = useState<[number, number, number, number] | null>(null);
  const [manualAssignLabel, setManualAssignLabel] = useState("");
  const [addingManual, setAddingManual] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedPhotos, setSelectedPhotos] = useState<Set<number>>(new Set());
  const [memories, setMemories] = useState<MemoryOut[]>([]);
  const [addingToMemory, setAddingToMemory] = useState(false);
  const [newMemoryLabel, setNewMemoryLabel] = useState("");
  const [addingToPerson, setAddingToPerson] = useState(false);
  const [newPersonLabel, setNewPersonLabel] = useState("");
  const [albums, setAlbums] = useState<AlbumOut[]>([]);
  const [addingToAlbum, setAddingToAlbum] = useState(false);
  const [newAlbumLabel, setNewAlbumLabel] = useState("");
  const lastSelectedIndexRef = useRef<number | null>(null);
  const location = useLocation();
  const navigate = useNavigate();
  const galleryState = location.state as {
    findSimilarForAlbum?: number;
    findSimilarForPerson?: number;
    /** Si true, al tener fotos cargadas se llama a la API de similares una vez por cada similarTrigger */
    autoRunSimilar?: boolean;
    similarTrigger?: number;
  } | null;
  const findSimilarAlbumId = galleryState?.findSimilarForAlbum ?? null;
  const findSimilarPersonId = galleryState?.findSimilarForPerson ?? null;
  const autoRunSimilar = galleryState?.autoRunSimilar ?? false;
  const similarTrigger = galleryState?.similarTrigger ?? 0;
  const [similarResults, setSimilarResults] = useState<{ file_id: number; similarity: number }[] | null>(null);
  const [findingSimilar, setFindingSimilar] = useState(false);
  const [assignMenu, setAssignMenu] = useState<null | "memory" | "person" | "album">(null);
  const [pickMemoryId, setPickMemoryId] = useState("");
  const [pickPersonId, setPickPersonId] = useState("");
  const [pickAlbumId, setPickAlbumId] = useState("");
  const personMenuRef = useRef<HTMLDivElement>(null);
  const memoryMenuRef = useRef<HTMLDivElement>(null);
  const albumMenuRef = useRef<HTMLDivElement>(null);
  const PAGE_SIZE = 80;

  const loadMore = async (pageNum: number) => {
    setLoading(true);
    const data = await api.getPhotos(pageNum * PAGE_SIZE, PAGE_SIZE);
    if (data.length < PAGE_SIZE) setHasMore(false);
    setPhotos((prev) => (pageNum === 0 ? data : [...prev, ...data]));
    setLoading(false);
  };

  useEffect(() => { loadMore(0); }, []);

  useEffect(() => {
    api.getMemories().then(setMemories);
    api.getAlbums().then(setAlbums);
  }, []);

  useEffect(() => {
    if (selectionMode) {
      api.getPeople(0, 300).then(setAllPeople);
    }
  }, [selectionMode]);

  const handleLoadMore = () => {
    const next = page + 1;
    setPage(next);
    loadMore(next);
  };

  const loadMoreSentinelRef = useInfiniteScroll(handleLoadMore, loading, hasMore);

  const { byYear, years, photosInOrder } = useMemo(() => {
    const by: Record<string, FileOut[]> = {};
    for (const f of photos) {
      const year = f.exif_date ? new Date(f.exif_date).getFullYear().toString() : "Unknown";
      (by[year] ??= []).push(f);
    }
    const yrs = Object.keys(by).sort((a, b) => b.localeCompare(a));
    return { byYear: by, years: yrs, photosInOrder: yrs.flatMap((y) => by[y]) };
  }, [photos]);

  /** Clic: alternar selección de este elemento. Shift + clic: rango entre el último clic y este (sustituye la selección por ese bloque). */
  const toggleSelectPhoto = (fileId: number, index: number, e: React.MouseEvent) => {
    if (e.shiftKey) e.preventDefault();
    const shift = e.shiftKey;
    setSelectedPhotos((prev) => {
      if (shift && lastSelectedIndexRef.current !== null) {
        const lo = Math.min(lastSelectedIndexRef.current, index);
        const hi = Math.max(lastSelectedIndexRef.current, index);
        const next = new Set<number>();
        for (let i = lo; i <= hi; i++) {
          const p = photosInOrder[i];
          if (p) next.add(p.id);
        }
        lastSelectedIndexRef.current = index;
        return next;
      }
      lastSelectedIndexRef.current = index;
      const next = new Set(prev);
      if (next.has(fileId)) next.delete(fileId);
      else next.add(fileId);
      return next;
    });
  };

  const handleCropComplete = async (bbox: [number, number, number, number]) => {
    if (!lightbox || lightbox.file_type !== "photo") return;
    setCropSearching(true);
    setCropResults(null);
    try {
      const [people, { faces }] = await Promise.all([
        api.getPeople(0, 300),
        api.searchFacesFromRegion(lightbox.id, bbox, 15),
      ]);
      setAllPeople(people);
      setCropResults({ faces });
      setManualAssignBbox(bbox); // Siempre disponible para asignación manual
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("422")) {
        const people = await api.getPeople(0, 300);
        setAllPeople(people);
        setManualAssignBbox(bbox);
        setCropMode(false);
      } else {
        alert(msg);
      }
    } finally {
      setCropSearching(false);
    }
  };

  const personLabel = (clusterId: number) =>
    allPeople.find((p) => p.id === clusterId)?.label ?? `Persona #${clusterId}`;

  const handleAddFaceToPerson = async (
    clusterId: number,
    faceBbox: number[],
    faceIndex: number,
    face?: { embedding_b64?: string; det_score: number }
  ) => {
    if (!lightbox || lightbox.file_type !== "photo") return;
    setAddingFace({ faceIdx: faceIndex, clusterId });
    try {
      await api.addFaceToPerson(clusterId, lightbox.id, faceBbox, {
        embedding_b64: face?.embedding_b64,
        det_score: face?.det_score,
      });
      setCropResults((prev) => {
        if (!prev) return null;
        const bboxKey = faceBbox.map((v) => v.toFixed(4)).join(",");
        const remaining = prev.faces.filter(
          (f) => f.bbox.map((v) => v.toFixed(4)).join(",") !== bboxKey
        );
        if (remaining.length === 0) {
          setCropMode(false);
          return null;
        }
        return { faces: remaining };
      });
      setLightbox(null);
    } catch (e) {
      alert("Error: " + e);
    } finally {
      setAddingFace(null);
    }
  };

  const handleManualAssign = async (clusterId: number) => {
    if (!lightbox || !manualAssignBbox) return;
    setAddingManual(true);
    try {
      await api.addFaceToPerson(clusterId, lightbox.id, manualAssignBbox);
      setManualAssignBbox(null);
      setManualAssignLabel("");
      setLightbox(null);
    } catch (e) {
      alert("Error: " + e);
    } finally {
      setAddingManual(false);
    }
  };

  const handleManualCreateNew = async () => {
    if (!lightbox || !manualAssignBbox) return;
    setAddingManual(true);
    try {
      const label = manualAssignLabel.trim() || undefined;
      const created = await api.createPerson(label);
      await api.addFaceToPerson(created.id, lightbox.id, manualAssignBbox);
      setManualAssignBbox(null);
      setManualAssignLabel("");
      setLightbox(null);
    } catch (e) {
      alert("Error: " + e);
    } finally {
      setAddingManual(false);
    }
  };

  const handleAddToMemory = async (memoryId: number) => {
    const ids = Array.from(selectedPhotos);
    if (ids.length === 0) return;
    setAddingToMemory(true);
    try {
      await api.addFilesToMemory(memoryId, ids);
      setSelectedPhotos(new Set());
      setSelectionMode(false);
    } catch (e) {
      alert("Error: " + e);
    } finally {
      setAddingToMemory(false);
    }
  };

  const handleCreateMemoryAndAdd = async () => {
    const ids = Array.from(selectedPhotos);
    if (ids.length === 0) return;
    setAddingToMemory(true);
    try {
      const m = await api.createMemory(newMemoryLabel.trim() || "Sin nombre");
      await api.addFilesToMemory(m.id, ids);
      setNewMemoryLabel("");
      setSelectedPhotos(new Set());
      setSelectionMode(false);
    } catch (e) {
      alert("Error: " + e);
    } finally {
      setAddingToMemory(false);
    }
  };

  const handleAddToPerson = async (personId: number) => {
    const ids = Array.from(selectedPhotos);
    if (ids.length === 0) return;
    const items = ids.map((id) => photos.find((p) => p.id === id)).filter(Boolean) as FileOut[];
    if (items.length === 0) return;
    setAddingToPerson(true);
    try {
      for (const f of items) {
        if (f.file_type === "photo") {
          await api.addFaceToPerson(personId, f.id, [0, 0, 1, 1]);
        } else if (f.file_type === "video") {
          await api.addVideoToPerson(personId, f.id);
        }
      }
      setSelectedPhotos(new Set());
      setSelectionMode(false);
    } catch (e) {
      alert("Error: " + e);
    } finally {
      setAddingToPerson(false);
    }
  };

  const handleAddToAlbum = async (albumId: number) => {
    const ids = Array.from(selectedPhotos);
    if (ids.length === 0) return;
    setAddingToAlbum(true);
    try {
      await api.addFilesToAlbum(albumId, ids);
      setSelectedPhotos(new Set());
      setSelectionMode(false);
      api.getAlbums().then(setAlbums);
    } catch (e) {
      alert("Error: " + e);
    } finally {
      setAddingToAlbum(false);
    }
  };

  const handleFindSimilar = useCallback(async () => {
    if ((!findSimilarAlbumId && !findSimilarPersonId) || photos.length === 0) return;
    setFindingSimilar(true);
    setSimilarResults(null);
    try {
      const fileIds = photos.map((p) => p.id);
      if (findSimilarAlbumId) {
        const data = await api.findSimilarInPage(findSimilarAlbumId, fileIds, 0.35, true);
        setSimilarResults(data.results);
      } else if (findSimilarPersonId) {
        const results = await api.findSimilarPersonInPage(findSimilarPersonId, fileIds);
        setSimilarResults(results);
      }
    } catch (e) {
      alert("Error: " + e);
    } finally {
      setFindingSimilar(false);
    }
  }, [findSimilarAlbumId, findSimilarPersonId, photos]);

  /** Desde álbum/persona: abrir galería con autoRunSimilar + similarTrigger para ejecutar o re-ejecutar */
  const similarAutoRunKeyRef = useRef("");
  useEffect(() => {
    if (!autoRunSimilar || (!findSimilarAlbumId && !findSimilarPersonId)) return;
    if (photos.length === 0 || loading) return;
    const k = `${findSimilarAlbumId ?? ""}-${findSimilarPersonId ?? ""}-${similarTrigger}`;
    if (similarAutoRunKeyRef.current === k) return;
    similarAutoRunKeyRef.current = k;
    void handleFindSimilar();
  }, [
    autoRunSimilar,
    findSimilarAlbumId,
    findSimilarPersonId,
    similarTrigger,
    photos.length,
    loading,
    handleFindSimilar,
  ]);

  const handleAddSimilarToAlbum = async (fileId: number) => {
    if (!findSimilarAlbumId) return;
    try {
      await api.addFilesToAlbum(findSimilarAlbumId, [fileId]);
      setSimilarResults((prev) => prev?.filter((r) => r.file_id !== fileId) ?? null);
      api.getAlbums().then(setAlbums);
    } catch (e) {
      alert("Error: " + e);
    }
  };

  const handleAddSimilarToPerson = async (fileId: number) => {
    if (!findSimilarPersonId) return;
    try {
      await api.addFaceToPerson(findSimilarPersonId, fileId, [0, 0, 1, 1]);
      setSimilarResults((prev) => prev?.filter((r) => r.file_id !== fileId) ?? null);
    } catch (e) {
      alert("Error: " + e);
    }
  };

  const handleCreateAlbumAndAdd = async () => {
    const ids = Array.from(selectedPhotos);
    if (ids.length === 0) return;
    setAddingToAlbum(true);
    try {
      const a = await api.createAlbum(newAlbumLabel.trim() || "Sin nombre");
      await api.addFilesToAlbum(a.id, ids);
      setNewAlbumLabel("");
      setSelectedPhotos(new Set());
      setSelectionMode(false);
      api.getAlbums().then(setAlbums);
    } catch (e) {
      alert("Error: " + e);
    } finally {
      setAddingToAlbum(false);
    }
  };

  const handleCreatePersonAndAdd = async () => {
    const ids = Array.from(selectedPhotos);
    if (ids.length === 0) return;
    const items = ids.map((id) => photos.find((p) => p.id === id)).filter(Boolean) as FileOut[];
    if (items.length === 0) return;
    setAddingToPerson(true);
    try {
      const created = await api.createPerson(newPersonLabel.trim() || undefined);
      for (const f of items) {
        if (f.file_type === "photo") {
          await api.addFaceToPerson(created.id, f.id, [0, 0, 1, 1]);
        } else if (f.file_type === "video") {
          await api.addVideoToPerson(created.id, f.id);
        }
      }
      setNewPersonLabel("");
      setSelectedPhotos(new Set());
      setSelectionMode(false);
    } catch (e) {
      alert("Error: " + e);
    } finally {
      setAddingToPerson(false);
    }
  };

  const handleCreateNewPerson = async (
    faceBbox: number[],
    faceIndex: number,
    face?: { embedding_b64?: string; det_score: number }
  ) => {
    if (!lightbox || lightbox.file_type !== "photo") return;
    setCreatingNew({ faceIdx: faceIndex });
    try {
      const label = newPersonLabels[faceIndex]?.trim() || undefined;
      const created = await api.createPerson(label);
      await api.addFaceToPerson(created.id, lightbox.id, faceBbox, {
        embedding_b64: face?.embedding_b64,
        det_score: face?.det_score,
      });
      setNewPersonLabels((prev) => { const next = { ...prev }; delete next[faceIndex]; return next; });
      setCreatingNew(null);
      setCropResults((prev) => {
        if (!prev) return null;
        const bboxKey = faceBbox.map((v) => v.toFixed(4)).join(",");
        const remaining = prev.faces.filter(
          (f) => f.bbox.map((v) => v.toFixed(4)).join(",") !== bboxKey
        );
        if (remaining.length === 0) {
          setCropMode(false);
          return null;
        }
        return { faces: remaining };
      });
      setLightbox(null);
    } catch (e) {
      alert("Error: " + e);
    } finally {
      setCreatingNew(null);
    }
  };

  return (
    <div className="p-6">
      <div className="sticky top-14 z-40 -mx-6 px-6 pt-6 -mt-6 mb-6 flex items-center justify-between flex-wrap gap-3 bg-gray-950 border-b border-gray-800 pb-4 shadow-lg">
        <h1 className="text-2xl font-bold shrink-0">All Photos & Videos</h1>
        <div className="flex gap-2 flex-wrap items-center min-w-0">
          <button
            onClick={() => setSelectionMode(!selectionMode)}
            className={`px-4 py-2 rounded-lg font-medium shrink-0 ${selectionMode ? "bg-amber-700" : "bg-amber-600 hover:bg-amber-500"} text-white`}
          >
            Seleccionar fotos
          </button>
          {selectionMode && (
            <>
              <span className="text-sm text-gray-400 shrink-0">
                {selectedPhotos.size} seleccionada{selectedPhotos.size !== 1 ? "s" : ""}
              </span>
              <div ref={personMenuRef} className="relative shrink-0">
                <button
                  type="button"
                  onClick={() => setAssignMenu((m) => (m === "person" ? null : "person"))}
                  className={`px-4 py-2 rounded-lg text-sm font-medium text-white ${assignMenu === "person" ? "bg-blue-700" : "bg-blue-600 hover:bg-blue-500"}`}
                >
                  Persona
                </button>
                <AssignDropdown
                  kind="person"
                  open={assignMenu === "person"}
                  onClose={() => setAssignMenu(null)}
                  containerRef={personMenuRef}
                  disabled={!selectionMode}
                  noSelection={selectedPhotos.size === 0}
                  items={allPeople.map((p) => ({ id: p.id, label: personLabel(p.id) }))}
                  pickId={pickPersonId}
                  onPickIdChange={setPickPersonId}
                  newLabel={newPersonLabel}
                  onNewLabelChange={setNewPersonLabel}
                  onAssignExisting={() => handleAddToPerson(parseInt(pickPersonId, 10))}
                  onCreateAndAssign={handleCreatePersonAndAdd}
                  loading={addingToPerson}
                />
              </div>
              <div ref={memoryMenuRef} className="relative shrink-0">
                <button
                  type="button"
                  onClick={() => setAssignMenu((m) => (m === "memory" ? null : "memory"))}
                  className={`px-4 py-2 rounded-lg text-sm font-medium text-white ${assignMenu === "memory" ? "bg-green-700" : "bg-green-600 hover:bg-green-500"}`}
                >
                  Recuerdo
                </button>
                <AssignDropdown
                  kind="memory"
                  open={assignMenu === "memory"}
                  onClose={() => setAssignMenu(null)}
                  containerRef={memoryMenuRef}
                  disabled={!selectionMode}
                  noSelection={selectedPhotos.size === 0}
                  items={memories.map((m) => ({ id: m.id, label: m.label }))}
                  pickId={pickMemoryId}
                  onPickIdChange={setPickMemoryId}
                  newLabel={newMemoryLabel}
                  onNewLabelChange={setNewMemoryLabel}
                  onAssignExisting={() => handleAddToMemory(parseInt(pickMemoryId, 10))}
                  onCreateAndAssign={handleCreateMemoryAndAdd}
                  loading={addingToMemory}
                />
              </div>
              <div ref={albumMenuRef} className="relative shrink-0">
                <button
                  type="button"
                  onClick={() => setAssignMenu((m) => (m === "album" ? null : "album"))}
                  className={`px-4 py-2 rounded-lg text-sm font-medium text-white ${assignMenu === "album" ? "bg-purple-700" : "bg-purple-600 hover:bg-purple-500"}`}
                >
                  Álbum
                </button>
                <AssignDropdown
                  kind="album"
                  open={assignMenu === "album"}
                  onClose={() => setAssignMenu(null)}
                  containerRef={albumMenuRef}
                  disabled={!selectionMode}
                  noSelection={selectedPhotos.size === 0}
                  items={albums.map((a) => ({ id: a.id, label: a.label }))}
                  pickId={pickAlbumId}
                  onPickIdChange={setPickAlbumId}
                  newLabel={newAlbumLabel}
                  onNewLabelChange={setNewAlbumLabel}
                  onAssignExisting={() => handleAddToAlbum(parseInt(pickAlbumId, 10))}
                  onCreateAndAssign={handleCreateAlbumAndAdd}
                  loading={addingToAlbum}
                />
              </div>
              <button
                onClick={() => {
                  setSelectionMode(false);
                  setSelectedPhotos(new Set());
                  lastSelectedIndexRef.current = null;
                  setAssignMenu(null);
                }}
                className="px-4 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 shrink-0"
              >
                Cancelar
              </button>
            </>
          )}
        </div>
      </div>

      {selectionMode && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-amber-900/40 border border-amber-700 text-sm text-amber-200">
          <strong>Clic</strong>: marcar o desmarcar cada foto. <strong>Shift + clic</strong>: rango entre el último clic y este. Luego{" "}
          <strong>Persona</strong>, <strong>Recuerdo</strong> o <strong>Álbum</strong>.
        </div>
      )}

      {(findSimilarAlbumId || findSimilarPersonId) && (
        <div
          className={`mb-4 px-4 py-3 rounded-lg border text-sm flex flex-wrap items-center gap-3 ${
            findSimilarPersonId
              ? "bg-blue-900/40 border-blue-700 text-blue-200"
              : "bg-purple-900/40 border-purple-700 text-purple-200"
          }`}
        >
          <span className="max-w-xl">
            {findSimilarPersonId ? (
              <>
                Buscar entre las <strong>fotos ya cargadas en esta página</strong> (usa &quot;Cargar más&quot; o scroll para
                ampliar). No se escanea toda la biblioteca.
              </>
            ) : (
              <>
                Mismo criterio: solo se comparan las <strong>fotos visibles cargadas aquí</strong> con el álbum.
              </>
            )}
          </span>
          <button
            type="button"
            onClick={handleFindSimilar}
            disabled={findingSimilar || photos.length === 0}
            className={`px-4 py-2 rounded-lg disabled:opacity-50 text-white ${
              findSimilarPersonId ? "bg-blue-600 hover:bg-blue-500" : "bg-purple-600 hover:bg-purple-500"
            }`}
          >
            {findingSimilar
              ? "Buscando..."
              : similarResults !== null
                ? "Volver a buscar (fotos cargadas)"
                : "Buscar similares"}
          </button>
          <button
            onClick={() => {
              navigate("/gallery", { replace: true, state: {} });
              setSimilarResults(null);
            }}
            className="text-gray-400 hover:text-white"
          >
            Cerrar
          </button>
          {similarResults !== null && (
            <span className="text-xs">{similarResults.length} coincidencias</span>
          )}
        </div>
      )}

      {similarResults && similarResults.length > 0 && (
        <div className="mb-6 p-4 rounded-lg bg-gray-900/80 border border-gray-700">
          <h3 className="text-sm font-medium text-gray-300 mb-3">
            {findSimilarPersonId ? "Similares a la persona — añadir:" : "Similares al álbum — añadir:"}
          </h3>
          <div className="grid grid-cols-6 sm:grid-cols-8 md:grid-cols-12 gap-2">
            {similarResults.map((r) => {
              const f = photos.find((p) => p.id === r.file_id);
              if (!f) return null;
              return (
                <div key={r.file_id} className="relative group">
                  <PhotoCard file={f} onClick={() => {}} />
                  <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 bg-black/60 rounded-lg transition-opacity">
                    <button
                      onClick={() =>
                        findSimilarPersonId
                          ? handleAddSimilarToPerson(r.file_id)
                          : handleAddSimilarToAlbum(r.file_id)
                      }
                      className={`px-2 py-1 rounded text-white text-xs ${
                        findSimilarPersonId ? "bg-blue-600 hover:bg-blue-500" : "bg-purple-600 hover:bg-purple-500"
                      }`}
                    >
                      {findSimilarPersonId ? "+ Persona" : "+ Álbum"}
                    </button>
                  </div>
                  <span className="absolute bottom-0 left-0 right-0 text-xs bg-black/70 text-center py-0.5">
                    {Math.round(r.similarity * 100)}%
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {(() => {
        let globalIndex = 0;
        return years.map((year) => (
          <div key={year} className="mb-10">
            <h2 className="text-xl font-semibold text-gray-300 mb-4 border-b border-gray-800 pb-2">
              {year} <span className="text-sm text-gray-500">({byYear[year].length})</span>
            </h2>
            <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-12 gap-1">
              {byYear[year].map((f) => {
                const idx = globalIndex++;
                return (
                  <PhotoCard
                    key={f.id}
                    file={f}
                    onClick={selectionMode ? undefined : () => {
                      setLightbox(f);
                      setCropResults(null);
                      setCropMode(false);
                      if (f.file_type === "photo") {
                        setManualAssignBbox([0, 0, 1, 1]);
                        api.getPeople(0, 300).then(setAllPeople);
                      } else {
                        setManualAssignBbox(null);
                      }
                    }}
                    selectable={selectionMode}
                    selected={selectedPhotos.has(f.id)}
                    onSelect={selectionMode ? (e) => toggleSelectPhoto(f.id, idx, e) : undefined}
                  />
                );
              })}
            </div>
          </div>
        ));
      })()}

      {loading && <Spinner message="Loading photos..." />}

      {hasMore && (
        <div ref={loadMoreSentinelRef} className="text-center py-8 min-h-[60px] flex items-center justify-center">
          <button
            onClick={handleLoadMore}
            disabled={loading}
            className="px-6 py-2 bg-gray-800 hover:bg-gray-700 disabled:opacity-60 rounded-lg text-sm transition-colors"
          >
            {loading ? "Cargando..." : "Cargar más"}
          </button>
        </div>
      )}

      {/* Lightbox */}
      {lightbox && (
        <div
          className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center p-4 overflow-y-auto"
          onClick={() => { if (!cropMode && !manualAssignBbox) { setLightbox(null); setCropResults(null); setCropMode(false); setManualAssignBbox(null); } }}
        >
          <div
            className="max-w-5xl w-full"
            onClick={(e) => e.stopPropagation()}
          >
            {lightbox.file_type === "photo" && cropMode ? (
              <FaceCropSelector
                imageUrl={api.originalUrl(lightbox.id)}
                onComplete={handleCropComplete}
                onCancel={() => setCropMode(false)}
                searching={cropSearching}
              />
            ) : lightbox.file_type === "photo" ? (
              <img
                src={api.originalUrl(lightbox.id)}
                alt=""
                className="max-w-full max-h-[70vh] object-contain rounded-lg"
              />
            ) : (
              <video
                src={api.originalUrl(lightbox.id)}
                controls
                preload="auto"
                className="max-w-full max-h-[70vh] rounded-lg bg-black"
              />
            )}
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm text-gray-400">
              <span className="truncate">{lightbox.path.split(/[\\/]/).pop()}</span>
              {lightbox.exif_date && (
                <span>{new Date(lightbox.exif_date).toLocaleDateString()}</span>
              )}
              {lightbox.file_type === "photo" && !cropMode && (
                <button
                  onClick={() => setCropMode(true)}
                  className="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-medium"
                >
                  Seleccionar persona en foto
                </button>
              )}
              <button onClick={() => { setLightbox(null); setCropResults(null); setCropMode(false); setManualAssignBbox(null); }} className="hover:text-white">
                ✕ Cerrar
              </button>
            </div>

            {/* Resultados de selección — mismo estilo que PersonDetail */}
            {cropResults && cropResults.faces.length > 0 && (
              <div className="mt-4 w-full max-w-2xl space-y-4">
                <h3 className="text-sm font-medium text-gray-300">
                  {cropResults.faces.length > 1
                    ? `${cropResults.faces.length} rostros detectados — asigna cada uno:`
                    : "Posibles personas reconocidas — o crear nueva:"}
                </h3>
                <p className="text-xs text-gray-500">
                  La foto aparecerá en la galería de quien elijas. Si ya tiene rostros de otras personas, seguirá en sus galerías también.
                </p>
                {cropResults.faces.map((face, faceIdx) => {
                  const MIN_SIMILARITY = 0.35; // Filtrar ruido (ej. perro vs personas)
                  const clusterSuggestions = face.suggestions
                    .filter((r) => r.cluster_id != null && r.similarity >= MIN_SIMILARITY)
                    .reduce((acc: SearchResult[], r) => {
                      const existing = acc.find((x) => x.cluster_id === r.cluster_id);
                      if (!existing || r.similarity > existing.similarity) {
                        return [...acc.filter((x) => x.cluster_id !== r.cluster_id), r];
                      }
                      return acc;
                    }, [] as SearchResult[])
                    .sort((a, b) => b.similarity - a.similarity);
                  return (
                    <div
                      key={faceIdx}
                      className="flex items-start gap-4 p-3 rounded-lg bg-gray-800/80 border border-gray-700"
                    >
                      <img
                        src={api.faceCropUrl(lightbox.id, face.bbox)}
                        alt={`Rostro ${faceIdx + 1}`}
                        className="w-16 h-16 rounded-full object-cover shrink-0 border border-gray-600"
                      />
                      <div className="flex-1 min-w-0 flex flex-col gap-2">
                        <span className="text-sm text-gray-400">
                          Rostro {faceIdx + 1} ({Math.round(face.det_score * 100)}%)
                        </span>
                        <div className="flex flex-wrap gap-2">
                          {clusterSuggestions.map((r) => (
                            <button
                              key={r.cluster_id!}
                              onClick={() => handleAddFaceToPerson(r.cluster_id!, face.bbox, faceIdx, face)}
                              disabled={addingFace?.faceIdx === faceIdx && addingFace?.clusterId === r.cluster_id}
                              className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-sm"
                            >
                              {addingFace?.faceIdx === faceIdx && addingFace?.clusterId === r.cluster_id
                                ? "..."
                                : `${personLabel(r.cluster_id!)} (${Math.round(r.similarity * 100)}%)`}
                            </button>
                          ))}
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-xs text-gray-500">o elegir:</span>
                            <select
                              value=""
                              onChange={(e) => {
                                const v = e.target.value;
                                e.target.value = "";
                                if (v) handleAddFaceToPerson(parseInt(v, 10), face.bbox, faceIdx, face);
                              }}
                              disabled={addingFace?.faceIdx === faceIdx}
                              className="bg-gray-700 border border-gray-600 rounded-lg px-2 py-1 text-sm text-white"
                            >
                              <option value="">— persona —</option>
                              {allPeople.map((p) => (
                                <option key={p.id} value={p.id}>
                                  {personLabel(p.id)}
                                </option>
                              ))}
                            </select>
                            <input
                              type="text"
                              value={newPersonLabels[faceIdx] ?? ""}
                              onChange={(e) => setNewPersonLabels((p) => ({ ...p, [faceIdx]: e.target.value }))}
                              placeholder="Nueva persona (ej. Perro)"
                              className="w-36 bg-gray-700 border border-gray-600 rounded-lg px-2 py-1.5 text-sm text-white"
                            />
                            <button
                              onClick={() => handleCreateNewPerson(face.bbox, faceIdx, face)}
                              disabled={creatingNew?.faceIdx === faceIdx}
                              className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-sm"
                            >
                              {creatingNew?.faceIdx === faceIdx ? "Creando..." : "Crear nueva"}
                            </button>
                          </div>
                          {clusterSuggestions.length === 0 && (
                            <span className="text-sm text-amber-400">Sin coincidencias — crea nueva persona</span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
                <button
                  onClick={() => setCropResults(null)}
                  className="text-xs text-gray-500 hover:text-gray-400"
                >
                  Cerrar resultados
                </button>
              </div>
            )}
            {cropResults && cropResults.faces.length === 0 && (
              <p className="mt-4 text-amber-400 text-sm">No se detectaron rostros en esta foto.</p>
            )}

            {/* Selector manual — siempre disponible tras buscar */}
            {manualAssignBbox && lightbox?.file_type === "photo" && (
              <div className="mt-4 w-full max-w-2xl p-4 rounded-lg bg-gray-900/80 border border-gray-700">
                <h3 className="text-sm font-medium text-gray-300 mb-2">
                  O asignar región manualmente a:
                </h3>
                <div className="flex flex-wrap gap-2 items-center">
                  <select
                    value=""
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v && v !== "_new") handleManualAssign(parseInt(v, 10));
                    }}
                    disabled={addingManual}
                    className="bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm min-w-[180px]"
                  >
                    <option value="">— Elegir persona —</option>
                    {allPeople.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label || `Persona #${p.id}`}
                      </option>
                    ))}
                  </select>
                  <input
                    type="text"
                    value={manualAssignLabel}
                    onChange={(e) => setManualAssignLabel(e.target.value)}
                    placeholder="Nueva persona (ej. Perro)"
                    className="w-40 bg-gray-700 border border-gray-600 rounded-lg px-2 py-1.5 text-sm text-white"
                  />
                  <button
                    onClick={handleManualCreateNew}
                    disabled={addingManual}
                    className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-sm"
                  >
                    {addingManual ? "Creando..." : "Crear nueva"}
                  </button>
                  <button
                    onClick={() => setManualAssignBbox(null)}
                    className="text-xs text-gray-500 hover:text-gray-400"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
