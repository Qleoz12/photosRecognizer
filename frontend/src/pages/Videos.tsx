import { useEffect, useState, useRef } from "react";
import { api, ClusterOut, FileOut, MemoryOut, AlbumOut } from "../api";
import PhotoCard from "../components/PhotoCard";
import Spinner from "../components/Spinner";
import AssignDropdown from "../components/AssignDropdown";
import { useInfiniteScroll } from "../hooks/useInfiniteScroll";

const PAGE_SIZE = 80;

function getYear(f: FileOut): string {
  if (f.exif_date) return new Date(f.exif_date).getFullYear().toString();
  if (f.file_modified) return new Date(f.file_modified).getFullYear().toString();
  return "Unknown";
}

export default function Videos() {
  const [videos, setVideos] = useState<FileOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [lightbox, setLightbox] = useState<FileOut | null>(null);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedVideos, setSelectedVideos] = useState<Set<number>>(new Set());
  const [allPeople, setAllPeople] = useState<ClusterOut[]>([]);
  const [memories, setMemories] = useState<MemoryOut[]>([]);
  const [albums, setAlbums] = useState<AlbumOut[]>([]);
  const [addingToPerson, setAddingToPerson] = useState(false);
  const [addingToMemory, setAddingToMemory] = useState(false);
  const [addingToAlbum, setAddingToAlbum] = useState(false);
  const [assignMenu, setAssignMenu] = useState<null | "memory" | "person" | "album">(null);
  const [pickMemoryId, setPickMemoryId] = useState("");
  const [pickPersonId, setPickPersonId] = useState("");
  const [pickAlbumId, setPickAlbumId] = useState("");
  const [newMemoryLabel, setNewMemoryLabel] = useState("");
  const [newPersonLabel, setNewPersonLabel] = useState("");
  const [newAlbumLabel, setNewAlbumLabel] = useState("");
  const [archiveConfigured, setArchiveConfigured] = useState(false);
  const [lightboxArchiving, setLightboxArchiving] = useState(false);
  const [archivingSelection, setArchivingSelection] = useState(false);
  const [lightboxMediaLoading, setLightboxMediaLoading] = useState(true);
  const personMenuRef = useRef<HTMLDivElement>(null);
  const memoryMenuRef = useRef<HTMLDivElement>(null);
  const albumMenuRef = useRef<HTMLDivElement>(null);
  const lastSelectedIndexRef = useRef<number | null>(null);

  const loadMore = async (pageNum: number) => {
    setLoading(true);
    try {
      const data = await api.getVideos(pageNum * PAGE_SIZE, PAGE_SIZE);
      if (data.length < PAGE_SIZE) setHasMore(false);
      setVideos((prev) => (pageNum === 0 ? data : [...prev, ...data]));
    } catch {
      if (pageNum === 0) setVideos([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadMore(0);
  }, []);

  useEffect(() => {
    api.getMemories().then(setMemories);
    api.getAlbums().then(setAlbums);
    api.getArchiveStatus().then((s) => setArchiveConfigured(s.configured)).catch(() => setArchiveConfigured(false));
  }, []);

  useEffect(() => {
    if (lightbox) setLightboxMediaLoading(true);
  }, [lightbox?.id]);

  useEffect(() => {
    if (selectionMode) api.getPeople(0, 300).then(setAllPeople);
  }, [selectionMode]);

  const handleLoadMore = () => {
    const next = page + 1;
    setPage(next);
    loadMore(next);
  };

  const loadMoreSentinelRef = useInfiniteScroll(handleLoadMore, loading, hasMore);

  const handleAddToPerson = async (personId: number) => {
    const ids = Array.from(selectedVideos);
    if (ids.length === 0) return;
    setAddingToPerson(true);
    try {
      for (const fileId of ids) {
        await api.addVideoToPerson(personId, fileId);
      }
      setSelectedVideos(new Set());
      setSelectionMode(false);
    } catch (e) {
      alert("Error: " + e);
    } finally {
      setAddingToPerson(false);
    }
  };

  const handleAddToMemory = async (memoryId: number) => {
    const ids = Array.from(selectedVideos);
    if (ids.length === 0) return;
    setAddingToMemory(true);
    try {
      await api.addFilesToMemory(memoryId, ids);
      setSelectedVideos(new Set());
      setSelectionMode(false);
    } catch (e) {
      alert("Error: " + e);
    } finally {
      setAddingToMemory(false);
    }
  };

  const handleAddToAlbum = async (albumId: number) => {
    const ids = Array.from(selectedVideos);
    if (ids.length === 0) return;
    setAddingToAlbum(true);
    try {
      await api.addFilesToAlbum(albumId, ids);
      setSelectedVideos(new Set());
      setSelectionMode(false);
      api.getAlbums().then(setAlbums);
    } catch (e) {
      alert("Error: " + e);
    } finally {
      setAddingToAlbum(false);
    }
  };

  const handleCreateMemoryAndAdd = async () => {
    const ids = Array.from(selectedVideos);
    if (ids.length === 0) return;
    setAddingToMemory(true);
    try {
      const m = await api.createMemory(newMemoryLabel.trim() || "Sin nombre");
      await api.addFilesToMemory(m.id, ids);
      setNewMemoryLabel("");
      setSelectedVideos(new Set());
      setSelectionMode(false);
      api.getMemories().then(setMemories);
    } catch (e) {
      alert("Error: " + e);
    } finally {
      setAddingToMemory(false);
    }
  };

  const handleCreatePersonAndAdd = async () => {
    const ids = Array.from(selectedVideos);
    if (ids.length === 0) return;
    setAddingToPerson(true);
    try {
      const created = await api.createPerson(newPersonLabel.trim() || undefined);
      for (const fileId of ids) {
        await api.addVideoToPerson(created.id, fileId);
      }
      setNewPersonLabel("");
      setSelectedVideos(new Set());
      setSelectionMode(false);
    } catch (e) {
      alert("Error: " + e);
    } finally {
      setAddingToPerson(false);
    }
  };

  const handleCreateAlbumAndAdd = async () => {
    const ids = Array.from(selectedVideos);
    if (ids.length === 0) return;
    setAddingToAlbum(true);
    try {
      const a = await api.createAlbum(newAlbumLabel.trim() || "Sin nombre");
      await api.addFilesToAlbum(a.id, ids);
      setNewAlbumLabel("");
      setSelectedVideos(new Set());
      setSelectionMode(false);
      api.getAlbums().then(setAlbums);
    } catch (e) {
      alert("Error: " + e);
    } finally {
      setAddingToAlbum(false);
    }
  };

  const byYear: Record<string, FileOut[]> = {};
  for (const f of videos) {
    const year = getYear(f);
    (byYear[year] ??= []).push(f);
  }
  const years = Object.keys(byYear).sort((a, b) => b.localeCompare(a));
  const videosInOrder = years.flatMap((y) => byYear[y]);

  const handleArchiveFromLightbox = async () => {
    if (!lightbox || !archiveConfigured) return;
    if (!confirm("¿Archivar este vídeo? Dejará de verse en la galería de vídeos.")) return;
    setLightboxArchiving(true);
    try {
      await api.archiveFiles([lightbox.id]);
      setVideos((prev) => prev.filter((v) => v.id !== lightbox.id));
      setLightbox(null);
    } catch (e) {
      alert("No se pudo archivar: " + e);
    } finally {
      setLightboxArchiving(false);
    }
  };

  const handleArchiveSelectedVideos = async () => {
    const ids = Array.from(selectedVideos);
    if (ids.length === 0 || !archiveConfigured) return;
    if (!confirm(`¿Archivar ${ids.length} vídeo(s)? Dejarán de verse en esta lista.`)) return;
    setArchivingSelection(true);
    try {
      await api.archiveFiles(ids);
      setVideos((prev) => prev.filter((v) => !selectedVideos.has(v.id)));
      setSelectedVideos(new Set());
      setSelectionMode(false);
      setAssignMenu(null);
      lastSelectedIndexRef.current = null;
    } catch (e) {
      alert("No se pudo archivar: " + e);
    } finally {
      setArchivingSelection(false);
    }
  };

  const toggleSelectVideo = (fileId: number, index: number, e: React.MouseEvent) => {
    if (e.shiftKey) e.preventDefault();
    const shift = e.shiftKey;
    setSelectedVideos((prev) => {
      if (shift && lastSelectedIndexRef.current !== null) {
        const lo = Math.min(lastSelectedIndexRef.current, index);
        const hi = Math.max(lastSelectedIndexRef.current, index);
        const next = new Set<number>();
        for (let i = lo; i <= hi; i++) {
          const v = videosInOrder[i];
          if (v) next.add(v.id);
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

  return (
    <div className="p-6">
      <div className="sticky top-14 z-40 -mx-6 px-6 pt-6 -mt-6 mb-6 flex items-center justify-between flex-wrap gap-3 bg-gray-950 border-b border-gray-800 pb-4 shadow-lg">
        <h1 className="text-2xl font-bold shrink-0">Videos</h1>
        <div className="flex gap-2 flex-wrap items-center min-w-0">
          <button
            onClick={() => setSelectionMode(!selectionMode)}
            className={`px-4 py-2 rounded-lg font-medium shrink-0 ${selectionMode ? "bg-amber-700" : "bg-amber-600 hover:bg-amber-500"} text-white`}
          >
            Seleccionar videos
          </button>
          {selectionMode && (
            <>
              <span className="text-sm text-gray-400 shrink-0">
                {selectedVideos.size} seleccionado{selectedVideos.size !== 1 ? "s" : ""}
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
                  disabled={false}
                  noSelection={selectedVideos.size === 0}
                  items={allPeople.map((p) => ({ id: p.id, label: p.label ?? `Persona #${p.id}` }))}
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
                  disabled={false}
                  noSelection={selectedVideos.size === 0}
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
                  disabled={false}
                  noSelection={selectedVideos.size === 0}
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
              {archiveConfigured && (
                <button
                  type="button"
                  onClick={() => void handleArchiveSelectedVideos()}
                  disabled={selectedVideos.size === 0 || archivingSelection}
                  className="px-4 py-2 rounded-lg text-sm font-medium shrink-0 bg-stone-700 hover:bg-stone-600 text-stone-100 disabled:opacity-50"
                >
                  {archivingSelection ? "Archivando…" : "Archivar"}
                </button>
              )}
              <button
                onClick={() => {
                  setSelectionMode(false);
                  setSelectedVideos(new Set());
                  setAssignMenu(null);
                  lastSelectedIndexRef.current = null;
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
          <strong>Clic</strong>: marcar o desmarcar. <strong>Shift + clic</strong>: rango entre el último clic y este.
        </div>
      )}

      {videos.length === 0 && !loading ? (
        <div className="text-center py-24 text-gray-500">
          <p className="text-4xl mb-4">🎥</p>
          <p className="text-lg">No hay videos indexados.</p>
          <p className="text-sm mt-2">Ejecuta el indexer y el clustering para indexar videos.</p>
        </div>
      ) : (
        <>
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
                        onClick={selectionMode ? undefined : () => setLightbox(f)}
                        selectable={selectionMode}
                        selected={selectedVideos.has(f.id)}
                        onSelect={
                          selectionMode ? (e) => toggleSelectVideo(f.id, idx, e) : undefined
                        }
                      />
                    );
                  })}
                </div>
              </div>
            ));
          })()}

          {loading && <Spinner message="Cargando videos..." />}

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
        </>
      )}

      {lightbox && (
        <div
          className="fixed inset-0 bg-black/90 z-50 flex flex-col p-0 sm:p-4 overflow-hidden"
          onClick={() => setLightbox(null)}
        >
          <div
            className="max-w-5xl w-full mx-auto flex flex-col max-h-full flex-1 min-h-0"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 z-20 flex flex-wrap items-center gap-2 px-3 py-3 bg-gray-950/95 border-b border-gray-800 shrink-0">
              <span className="truncate flex-1 min-w-0 text-sm text-gray-100 font-medium" title={lightbox.path}>
                {lightbox.path.split(/[/\\]/).pop()}
              </span>
              {archiveConfigured ? (
                <button
                  type="button"
                  onClick={() => void handleArchiveFromLightbox()}
                  disabled={lightboxArchiving}
                  className="px-3 py-2 rounded-lg border border-stone-500 bg-stone-800 hover:bg-stone-700 text-stone-100 disabled:opacity-50 text-sm font-semibold shrink-0"
                >
                  {lightboxArchiving ? "…" : "Archivar"}
                </button>
              ) : (
                <span className="text-xs text-amber-600/90 shrink-0" title="ARCHIVE_PIN en .env (7–8 dígitos)">
                  Sin archivo (PIN API)
                </span>
              )}
              <button
                type="button"
                onClick={() => setLightbox(null)}
                className="px-3 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-200 text-sm shrink-0"
              >
                Cerrar
              </button>
            </div>
            <div className="relative flex justify-center items-center flex-1 min-h-0 p-3 overflow-auto">
              {lightboxMediaLoading && (
                <div className="absolute inset-3 flex items-center justify-center z-10 bg-black/40 rounded-lg">
                  <Spinner message="Cargando vídeo…" />
                </div>
              )}
              <video
                src={api.originalUrl(lightbox.id)}
                controls
                preload="metadata"
                playsInline
                onLoadedMetadata={() => setLightboxMediaLoading(false)}
                onLoadedData={() => setLightboxMediaLoading(false)}
                onCanPlay={() => setLightboxMediaLoading(false)}
                onError={() => setLightboxMediaLoading(false)}
                className="max-w-full max-h-[min(85vh,900px)] rounded-lg bg-black"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
