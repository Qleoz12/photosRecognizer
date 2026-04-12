import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { useLocation, useNavigate, Link } from "react-router-dom";
import { api, ClusterOut, FileOut, MemoryOut, AlbumOut, SearchResult, Stats } from "../api";
import FaceCropSelector from "../components/FaceCropSelector";
import PhotoCard from "../components/PhotoCard";
import Spinner from "../components/Spinner";
import AssignDropdown from "../components/AssignDropdown";
import { useInfiniteScroll } from "../hooks/useInfiniteScroll";

const UNDATED_PAGE_SIZE = 500;

export default function AllPhotos() {
  const [datedPhotos, setDatedPhotos] = useState<FileOut[]>([]);
  const [undatedPhotos, setUndatedPhotos] = useState<FileOut[]>([]);
  const [undatedSkip, setUndatedSkip] = useState(0);
  const [undatedHasMore, setUndatedHasMore] = useState(false);
  const [undatedLoading, setUndatedLoading] = useState(false);
  const [galleryStats, setGalleryStats] = useState<Stats | null>(null);
  /** Totales en BD por año (EXIF), para comparar con miniaturas cargadas en pantalla */
  const [yearTotals, setYearTotals] = useState<Record<string, number>>({});
  /** false hasta que termine la petición de /stats/by-year (éxito o error) */
  const [yearStatsReady, setYearStatsReady] = useState(false);
  const [yearStatsError, setYearStatsError] = useState<string | null>(null);
  const [bulkAssignYear, setBulkAssignYear] = useState(() => String(new Date().getFullYear()));
  const [bulkAssigning, setBulkAssigning] = useState(false);
  const [loading, setLoading] = useState(true);
  /** Solo paginación con fecha; no reutilizar `loading` o el scroll muestra el spinner a pantalla completa. */
  const [loadingMoreDated, setLoadingMoreDated] = useState(false);
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
  const [similarSearchMeta, setSimilarSearchMeta] = useState<{
    pool_size?: number;
    uncached_remaining_after?: number;
    total_cached_album?: number;
    cached_count?: number;
    computed_count?: number;
    skipped_already_in_person?: number;
    skipped_no_faces?: number;
  } | null>(null);
  const [assignMenu, setAssignMenu] = useState<null | "memory" | "person" | "album">(null);
  const [pickMemoryId, setPickMemoryId] = useState("");
  const [pickPersonId, setPickPersonId] = useState("");
  const [pickAlbumId, setPickAlbumId] = useState("");
  const [archiveConfigured, setArchiveConfigured] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [lightboxArchiving, setLightboxArchiving] = useState(false);
  const [lightboxMediaLoading, setLightboxMediaLoading] = useState(false);
  const personMenuRef = useRef<HTMLDivElement>(null);
  const memoryMenuRef = useRef<HTMLDivElement>(null);
  const albumMenuRef = useRef<HTMLDivElement>(null);
  const PAGE_SIZE = 60;
  const [loadError, setLoadError] = useState<string | null>(null);

  const photos = useMemo(() => [...datedPhotos, ...undatedPhotos], [datedPhotos, undatedPhotos]);

  const removeFromGallery = useCallback((ids: Set<number> | number[]) => {
    const s = ids instanceof Set ? ids : new Set(ids);
    setDatedPhotos((prev) => prev.filter((p) => !s.has(p.id)));
    setUndatedPhotos((prev) => prev.filter((p) => !s.has(p.id)));
  }, []);

  const loadInitial = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [dated, undated] = await Promise.all([
        api.getPhotos(0, PAGE_SIZE, { hasExifDate: true }),
        api.getPhotos(0, UNDATED_PAGE_SIZE, { hasExifDate: false }),
      ]);
      setDatedPhotos(dated);
      setHasMore(dated.length === PAGE_SIZE);
      setUndatedPhotos(undated);
      setUndatedSkip(undated.length);
      setUndatedHasMore(undated.length === UNDATED_PAGE_SIZE);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setLoadError(msg);
      setDatedPhotos([]);
      setUndatedPhotos([]);
      setUndatedSkip(0);
      setUndatedHasMore(false);
    } finally {
      setLoading(false);
    }
  };

  const loadMoreDated = async (pageNum: number) => {
    setLoadingMoreDated(true);
    setLoadError(null);
    try {
      const data = await api.getPhotos(pageNum * PAGE_SIZE, PAGE_SIZE, { hasExifDate: true });
      if (data.length < PAGE_SIZE) setHasMore(false);
      setDatedPhotos((prev) => (pageNum === 0 ? data : [...prev, ...data]));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setLoadError(msg);
      if (pageNum === 0) setDatedPhotos([]);
    } finally {
      setLoadingMoreDated(false);
    }
  };

  const loadMoreUndated = async () => {
    if (!undatedHasMore || undatedLoading) return;
    setUndatedLoading(true);
    try {
      const data = await api.getPhotos(undatedSkip, UNDATED_PAGE_SIZE, { hasExifDate: false });
      setUndatedHasMore(data.length === UNDATED_PAGE_SIZE);
      setUndatedSkip((s) => s + data.length);
      setUndatedPhotos((prev) => [...prev, ...data]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setLoadError(msg);
    } finally {
      setUndatedLoading(false);
    }
  };

  const refreshGalleryAndYearStats = useCallback(() => {
    api.getStats().then(setGalleryStats).catch(() => setGalleryStats(null));
    setYearStatsReady(false);
    setYearStatsError(null);
    api
      .getPhotoStatsByYear()
      .then((d) => {
        const m: Record<string, number> = {};
        for (const r of d.by_year) m[String(r.year)] = r.count;
        setYearTotals(m);
        setYearStatsError(null);
      })
      .catch((e) => {
        setYearTotals({});
        setYearStatsError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => setYearStatsReady(true));
  }, []);

  useEffect(() => {
    void loadInitial();
  }, []);

  useEffect(() => {
    refreshGalleryAndYearStats();
  }, [refreshGalleryAndYearStats]);

  const yearTableRows = useMemo(() => {
    return Object.entries(yearTotals)
      .map(([y, c]) => ({ year: y, count: c }))
      .sort((a, b) => b.year.localeCompare(a.year));
  }, [yearTotals]);

  const yearRangeLabel = useMemo(() => {
    const keys = Object.keys(yearTotals);
    if (keys.length === 0) return null;
    const sorted = [...keys].sort((a, b) => a.localeCompare(b));
    const oldest = sorted[0];
    const newest = sorted[sorted.length - 1];
    if (oldest === newest) return oldest;
    return `De ${oldest} a ${newest}`;
  }, [yearTotals]);

  useEffect(() => {
    api.getArchiveStatus().then((s) => setArchiveConfigured(s.configured)).catch(() => setArchiveConfigured(false));
  }, []);

  useEffect(() => {
    if (!lightbox) return;
    if (cropMode) {
      setLightboxMediaLoading(false);
      return;
    }
    setLightboxMediaLoading(true);
  }, [lightbox?.id, cropMode]);

  useEffect(() => {
    if (!selectionMode) return;
    let cancelled = false;
    Promise.all([api.getMemories(), api.getAlbums()]).then(([m, a]) => {
      if (!cancelled) {
        setMemories(m);
        setAlbums(a);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [selectionMode]);

  useEffect(() => {
    if (selectionMode) {
      api.getPeople(0, 300).then(setAllPeople);
    }
  }, [selectionMode]);

  const handleLoadMore = () => {
    const next = page + 1;
    setPage(next);
    void loadMoreDated(next);
  };

  const loadMoreSentinelRef = useInfiniteScroll(
    handleLoadMore,
    loading || loadingMoreDated,
    hasMore,
  );

  const undatedSentinelRef = useInfiniteScroll(
    () => {
      void loadMoreUndated();
    },
    undatedLoading,
    undatedHasMore,
  );

  const { byYear, years, photosInOrder } = useMemo(() => {
    const by: Record<string, FileOut[]> = {};
    for (const f of datedPhotos) {
      if (!f.exif_date) continue;
      const year = new Date(f.exif_date).getFullYear().toString();
      (by[year] ??= []).push(f);
    }
    const yrs = Object.keys(by).sort((a, b) => b.localeCompare(a));
    const datedOrder = yrs.flatMap((y) => by[y]);
    return {
      byYear: by,
      years: yrs,
      photosInOrder: [...datedOrder, ...undatedPhotos],
    };
  }, [datedPhotos, undatedPhotos]);

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

  const handleArchiveSelected = async () => {
    const ids = Array.from(selectedPhotos);
    if (ids.length === 0) return;
    if (!archiveConfigured) return;
    if (!confirm(`¿Archivar ${ids.length} elemento(s)? Dejarán de verse en la galería principal.`)) return;
      setArchiving(true);
    try {
      const r = await api.archiveFiles(ids);
      removeFromGallery(ids);
      setSelectedPhotos(new Set());
      setSelectionMode(false);
      setAssignMenu(null);
      lastSelectedIndexRef.current = null;
      if (r.archived < ids.length) {
        alert(`Archivadas: ${r.archived} (algunos id. no existían o el servidor rechazó la operación).`);
      }
    } catch (e) {
      alert("No se pudo archivar: " + e);
    } finally {
      setArchiving(false);
    }
  };

  const handleBulkAssignExifYear = async () => {
    const y = parseInt(bulkAssignYear, 10);
    if (!Number.isFinite(y) || y < 1900 || y > 2100) {
      alert("Año inválido: usa un número entre 1900 y 2100.");
      return;
    }
    const ids = Array.from(selectedPhotos);
    if (ids.length === 0) return;
    if (
      !confirm(
        `¿Asignar año EXIF ${y} a ${ids.length} elemento(s)? En base de datos se guarda como 1 de julio de ${y} (mediodía).`,
      )
    ) {
      return;
    }
    setBulkAssigning(true);
    try {
      const r = await api.batchSetExifYear(ids, y);
      alert(`Actualizados en biblioteca: ${r.updated}`);
      setSelectedPhotos(new Set());
      setSelectionMode(false);
      setAssignMenu(null);
      lastSelectedIndexRef.current = null;
      setPage(0);
      setHasMore(true);
      await loadInitial();
      refreshGalleryAndYearStats();
    } catch (e) {
      alert("No se pudo asignar el año: " + e);
    } finally {
      setBulkAssigning(false);
    }
  };

  const handleArchiveFromLightbox = async () => {
    if (!lightbox || !archiveConfigured) return;
    if (!confirm("¿Archivar este elemento? Dejará de verse en la galería (fotos/vídeos).")) return;
    setLightboxArchiving(true);
    try {
      await api.archiveFiles([lightbox.id]);
      removeFromGallery([lightbox.id]);
      setLightbox(null);
      setCropResults(null);
      setCropMode(false);
      setManualAssignBbox(null);
    } catch (e) {
      alert("No se pudo archivar: " + e);
    } finally {
      setLightboxArchiving(false);
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
    setSimilarSearchMeta(null);
    try {
      const fileIds = photos.map((p) => p.id);
      if (findSimilarAlbumId) {
        const data = await api.findSimilarInPage(findSimilarAlbumId, fileIds, 0.35, true, 500);
        setSimilarResults(data.results);
        setSimilarSearchMeta({
          pool_size: data.pool_size,
          uncached_remaining_after: data.uncached_remaining_after,
          total_cached_album: data.total_cached_album,
          cached_count: data.cached_count,
          computed_count: data.computed_count,
        });
      } else if (findSimilarPersonId) {
        const data = await api.findSimilarPersonInPage(findSimilarPersonId, fileIds);
        setSimilarResults(data.results);
        setSimilarSearchMeta({
          pool_size: data.pool_size,
          skipped_already_in_person: data.skipped_already_in_person,
          skipped_no_faces: data.skipped_no_faces,
        });
      }
    } catch (e) {
      alert("Error: " + e);
    } finally {
      setFindingSimilar(false);
    }
  }, [findSimilarAlbumId, findSimilarPersonId, photos]);

  /** Desde álbum/persona: tras la 1.ª página, buscar similares con retardo para no competir con el pintado de la galería. */
  const similarAutoRunKeyRef = useRef("");
  useEffect(() => {
    if (!autoRunSimilar || (!findSimilarAlbumId && !findSimilarPersonId)) return;
    if (photos.length === 0 || loading || loadingMoreDated) return;
    const k = `${findSimilarAlbumId ?? ""}-${findSimilarPersonId ?? ""}-${similarTrigger}`;
    if (similarAutoRunKeyRef.current === k) return;
    similarAutoRunKeyRef.current = k;
    const t = window.setTimeout(() => {
      void handleFindSimilar();
    }, 150);
    return () => window.clearTimeout(t);
  }, [
    autoRunSimilar,
    findSimilarAlbumId,
    findSimilarPersonId,
    similarTrigger,
    photos.length,
    loading,
    loadingMoreDated,
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
      <div className="sticky top-14 z-40 -mx-6 px-6 pt-6 -mt-6 mb-6 flex flex-col gap-4 bg-gray-950 border-b border-gray-800 pb-4 shadow-lg">
        <div className="flex w-full min-w-0 flex-col gap-4">
          <div className="flex w-full min-w-0 flex-wrap items-start justify-between gap-3">
            <h1 className="text-2xl font-bold shrink-0">All Photos & Videos</h1>
            <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
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
              <div className="flex items-center gap-2 shrink-0 flex-wrap border border-gray-700 rounded-lg px-2 py-1.5 bg-gray-900/50">
                <span className="text-xs text-gray-500 whitespace-nowrap">Año EXIF</span>
                <input
                  type="number"
                  min={1900}
                  max={2100}
                  value={bulkAssignYear}
                  onChange={(e) => setBulkAssignYear(e.target.value)}
                  className="w-[5.5rem] px-2 py-1 rounded bg-gray-800 border border-gray-600 text-white text-sm"
                  aria-label="Año para asignar a la selección"
                />
                <button
                  type="button"
                  onClick={() => void handleBulkAssignExifYear()}
                  disabled={selectedPhotos.size === 0 || bulkAssigning}
                  className="px-3 py-1.5 rounded-lg text-sm font-medium bg-teal-700 hover:bg-teal-600 text-white disabled:opacity-50"
                >
                  {bulkAssigning ? "…" : "Asignar año a selección"}
                </button>
              </div>
              {archiveConfigured && (
                <button
                  type="button"
                  onClick={() => void handleArchiveSelected()}
                  disabled={selectedPhotos.size === 0 || archiving}
                  className="px-4 py-2 rounded-lg text-sm font-medium shrink-0 bg-stone-700 hover:bg-stone-600 text-stone-100 disabled:opacity-50"
                >
                  {archiving ? "Archivando…" : "Archivar"}
                </button>
              )}
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

          {galleryStats != null && (
            <div className="w-full min-w-0 space-y-3">
              <p className="text-xs text-gray-600">
                EXIF = fecha de captura guardada en el archivo (no archivados). La cuadrícula abajo carga al hacer
                scroll o «Cargar más».
              </p>

              <div className="w-full min-w-0 rounded-lg border border-gray-800 bg-gray-900/40 overflow-hidden">
                <div className="px-2 py-1 border-b border-gray-800 text-xs text-gray-500 font-medium">Resumen</div>
                <div
                  className="flex w-full min-w-0 flex-nowrap divide-x divide-gray-800 overflow-x-auto [scrollbar-width:thin]"
                  style={{ scrollbarColor: "rgb(75 85 99) transparent" }}
                >
                  <div
                    className="flex min-w-0 flex-1 basis-0 flex-col justify-center gap-0.5 px-3 py-2"
                    title="Con fecha en metadatos (biblioteca)"
                  >
                    <span className="text-[10px] leading-tight text-gray-400 sm:text-xs">Con fecha (biblioteca)</span>
                    <span className="text-sm font-medium tabular-nums text-gray-200">
                      {(galleryStats.dated_count ?? 0).toLocaleString()}
                    </span>
                  </div>
                  <div
                    className="flex min-w-0 flex-1 basis-0 flex-col justify-center gap-0.5 px-3 py-2"
                    title="Sin fecha en metadatos (biblioteca)"
                  >
                    <span className="text-[10px] leading-tight text-gray-400 sm:text-xs">Sin fecha (biblioteca)</span>
                    <span className="text-sm font-medium tabular-nums text-gray-200">
                      {(galleryStats.undated_count ?? 0).toLocaleString()}
                    </span>
                  </div>
                  <div
                    className="flex min-w-0 flex-1 basis-0 flex-col justify-center gap-0.5 px-3 py-2"
                    title="Cargadas ahora en pantalla con fecha EXIF"
                  >
                    <span className="text-[10px] leading-tight text-gray-400 sm:text-xs">Cargadas (+fecha)</span>
                    <span className="text-sm font-medium tabular-nums text-amber-200/90">
                      {datedPhotos.length.toLocaleString()}
                    </span>
                  </div>
                  <div
                    className="flex min-w-0 flex-1 basis-0 flex-col justify-center gap-0.5 px-3 py-2"
                    title="Cargadas ahora en pantalla sin fecha EXIF"
                  >
                    <span className="text-[10px] leading-tight text-gray-400 sm:text-xs">Cargadas (sin fecha)</span>
                    <span className="text-sm font-medium tabular-nums text-amber-200/90">
                      {undatedPhotos.length.toLocaleString()}
                    </span>
                  </div>
                </div>
              </div>

              <div className="w-full min-w-0">
                <div className="text-[10px] sm:text-xs text-gray-500 mb-0.5 flex flex-wrap items-baseline gap-x-1.5 gap-y-0">
                  <span className="font-medium text-gray-400">Por año</span>
                  <span className="text-gray-600">(EXIF en biblioteca)</span>
                  {!yearStatsReady && <span className="italic">cargando…</span>}
                  {yearStatsReady && yearRangeLabel && (
                    <span className="text-gray-500">{yearRangeLabel}</span>
                  )}
                </div>
                {!yearStatsReady ? (
                  <div className="w-full text-xs text-gray-500 italic border border-dashed border-gray-700/90 rounded-md px-2 py-1">
                    No disponible aún…
                  </div>
                ) : yearStatsError ? (
                  <div className="w-full text-xs text-amber-200/90 border border-amber-900/50 rounded-md px-2 py-1">
                    No se pudieron cargar totales por año: {yearStatsError}
                  </div>
                ) : yearTableRows.length === 0 ? (
                  <div className="w-full text-xs text-gray-500 border border-gray-800/80 rounded-md px-2 py-1">
                    Sin datos por año.
                  </div>
                ) : (
                  <div
                    className="flex w-full min-w-0 flex-nowrap items-center gap-0.5 overflow-x-auto rounded-md border border-gray-800/70 bg-gray-900/25 py-0.5 px-0.5 [scrollbar-width:thin]"
                    style={{ scrollbarColor: "rgb(75 85 99) transparent" }}
                  >
                    {yearTableRows.map(({ year, count }) => (
                      <div
                        key={year}
                        className="flex shrink-0 items-baseline gap-0.5 rounded border border-gray-700/60 bg-gray-950/50 px-1 py-px text-[10px] leading-tight tabular-nums sm:text-[11px]"
                        title={`${year}: ${count.toLocaleString()} fotos con fecha EXIF`}
                      >
                        <span className="font-medium text-amber-200/90">{year}</span>
                        <span className="text-gray-600">·</span>
                        <span className="text-gray-400">{count.toLocaleString()}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
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
              setSimilarSearchMeta(null);
            }}
            className="text-gray-400 hover:text-white"
          >
            Cerrar
          </button>
          {similarResults !== null && (
            <span className="text-xs">
              {similarResults.length} coincidencias
              {similarSearchMeta && findSimilarAlbumId && similarSearchMeta.pool_size != null && (
                <>
                  {" "}
                  · pool {similarSearchMeta.pool_size.toLocaleString()}
                  {similarSearchMeta.cached_count != null && similarSearchMeta.computed_count != null && (
                    <span>
                      {" "}
                      · caché {similarSearchMeta.cached_count} + nuevas {similarSearchMeta.computed_count}
                    </span>
                  )}
                  {similarSearchMeta.uncached_remaining_after != null && (
                    <span> · restan sin caché ~{similarSearchMeta.uncached_remaining_after.toLocaleString()}</span>
                  )}
                  {similarSearchMeta.total_cached_album != null && (
                    <span> · total en caché álbum {similarSearchMeta.total_cached_album.toLocaleString()}</span>
                  )}
                </>
              )}
              {similarSearchMeta && findSimilarPersonId && similarSearchMeta.pool_size != null && (
                <>
                  {" "}
                  · pool {similarSearchMeta.pool_size.toLocaleString()}
                  {similarSearchMeta.skipped_already_in_person != null && (
                    <span> · ya en persona {similarSearchMeta.skipped_already_in_person}</span>
                  )}
                  {similarSearchMeta.skipped_no_faces != null && (
                    <span> · sin rostro {similarSearchMeta.skipped_no_faces}</span>
                  )}
                </>
              )}
            </span>
          )}
        </div>
      )}

      {loadError && !loading && !loadingMoreDated && (
        <div className="mb-4 p-4 rounded-lg bg-red-900/30 border border-red-800 text-red-200 text-sm flex flex-wrap items-center gap-3">
          <span>No se pudo cargar fotos: {loadError}</span>
          <button
            type="button"
            className="px-3 py-1 rounded bg-red-800 hover:bg-red-700 text-white text-xs"
            onClick={() => {
              setPage(0);
              setHasMore(true);
              setUndatedSkip(0);
              void loadInitial();
              refreshGalleryAndYearStats();
            }}
          >
            Reintentar
          </button>
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
        const undatedTotal = galleryStats?.undated_count ?? 0;
        const showUndatedBlock = undatedTotal > 0 || undatedPhotos.length > 0;
        return (
          <>
            {years.map((year) => (
              <div key={year} className="mb-10">
                <h2 className="text-xl font-semibold text-gray-300 mb-4 border-b border-gray-800 pb-2">
                  {year}{" "}
                  <span className="text-sm text-gray-500 font-normal">
                    (
                    {byYear[year].length.toLocaleString()} visibles
                    {yearStatsReady && yearTotals[String(year)] != null
                      ? ` · ${yearTotals[String(year)]!.toLocaleString()} en biblioteca`
                      : yearStatsReady
                        ? ""
                        : " · biblioteca …"}
                    )
                  </span>
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
            ))}
            {showUndatedBlock && (
              <div className="mb-10 border-t border-gray-800 pt-8">
                <h2 className="text-xl font-semibold text-amber-200/90 mb-2 border-b border-gray-800 pb-2">
                  Sin fecha EXIF
                  <span className="text-sm text-gray-500 font-normal ml-2">
                    (mostrando {undatedPhotos.length}
                    {undatedTotal > 0 ? ` de ${undatedTotal.toLocaleString()}` : ""})
                  </span>
                </h2>
                <p className="text-sm text-gray-500 mb-4">
                  Sin fecha EXIF: se cargan de {UNDATED_PAGE_SIZE} en {UNDATED_PAGE_SIZE}. Al llegar al final de este bloque se cargan más solas; también puedes usar el botón.
                </p>
                <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-12 gap-1">
                  {undatedPhotos.map((f) => {
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
                {undatedLoading && (
                  <div className="mt-4">
                    <Spinner message="Cargando sin fecha…" />
                  </div>
                )}
                {undatedHasMore && (
                  <>
                    <div ref={undatedSentinelRef} className="min-h-[24px] mt-4" aria-hidden />
                    <div className="text-center mt-2">
                      <button
                        type="button"
                        onClick={() => void loadMoreUndated()}
                        disabled={undatedLoading}
                        className="px-6 py-2 bg-amber-900/50 hover:bg-amber-800/60 border border-amber-800/80 disabled:opacity-60 rounded-lg text-sm text-amber-100 transition-colors"
                      >
                        {undatedLoading ? "Cargando…" : `Cargar más sin fecha (${UNDATED_PAGE_SIZE} por vez)`}
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
          </>
        );
      })()}

      {loading && photos.length === 0 && <Spinner message="Loading photos..." />}

      {hasMore && (
        <div ref={loadMoreSentinelRef} className="text-center py-8 min-h-[60px] flex flex-col items-center justify-center gap-3">
          {loadingMoreDated && (
            <Spinner message="Cargando más fotos…" />
          )}
          <button
            onClick={handleLoadMore}
            disabled={loading || loadingMoreDated}
            className="px-6 py-2 bg-gray-800 hover:bg-gray-700 disabled:opacity-60 rounded-lg text-sm transition-colors"
          >
            {loadingMoreDated ? "Cargando…" : "Cargar más"}
          </button>
        </div>
      )}

      {/* Lightbox */}
      {lightbox && (
        <div
          className="fixed inset-0 bg-black/90 z-50 flex flex-col p-0 sm:p-4 overflow-hidden"
          onClick={() => { if (!cropMode && !manualAssignBbox) { setLightbox(null); setCropResults(null); setCropMode(false); setManualAssignBbox(null); } }}
        >
          <div
            className="max-w-5xl w-full mx-auto flex flex-col max-h-full min-h-0 flex-1"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 z-20 flex flex-wrap items-center gap-2 px-3 py-3 bg-gray-950/95 border-b border-gray-800 shadow-lg shrink-0">
              <span className="truncate flex-1 min-w-[8rem] text-sm text-gray-100 font-medium" title={lightbox.path}>
                {lightbox.path.split(/[\\/]/).pop()}
              </span>
              {lightbox.exif_date && (
                <span className="text-xs text-gray-500 shrink-0">{new Date(lightbox.exif_date).toLocaleDateString()}</span>
              )}
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
                <span className="text-xs text-amber-600/90 max-w-[10rem] leading-tight" title="Añade ARCHIVE_PIN en .env (7–8 dígitos) y reinicia la API">
                  Sin archivo (PIN API)
                </span>
              )}
              {lightbox.file_type === "photo" && !cropMode && (
                <button
                  type="button"
                  onClick={() => setCropMode(true)}
                  className="px-3 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-sm font-medium shrink-0"
                >
                  Persona en foto
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setLightbox(null);
                  setCropResults(null);
                  setCropMode(false);
                  setManualAssignBbox(null);
                }}
                className="px-3 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-200 text-sm shrink-0"
              >
                ✕ Cerrar
              </button>
            </div>

            <div className="overflow-y-auto flex-1 min-h-0 px-3 pb-4 pt-3">
              {lightbox.file_type === "photo" && cropMode ? (
                <FaceCropSelector
                  imageUrl={api.originalUrl(lightbox.id)}
                  onComplete={handleCropComplete}
                  onCancel={() => setCropMode(false)}
                  searching={cropSearching}
                />
              ) : (
                <div className="relative flex justify-center items-center min-h-[40vh]">
                  {lightboxMediaLoading && (
                    <div className="absolute inset-0 flex items-center justify-center z-10 bg-black/40 rounded-lg">
                      <Spinner message="Cargando vista previa…" />
                    </div>
                  )}
                  {lightbox.file_type === "photo" ? (
                    <img
                      src={api.originalUrl(lightbox.id)}
                      alt=""
                      decoding="async"
                      loading="eager"
                      onLoad={() => setLightboxMediaLoading(false)}
                      onError={() => setLightboxMediaLoading(false)}
                      className="max-w-full max-h-[min(70vh,800px)] w-auto object-contain rounded-lg"
                    />
                  ) : (
                    <video
                      src={api.originalUrl(lightbox.id)}
                      controls
                      preload="metadata"
                      playsInline
                      onLoadedMetadata={() => setLightboxMediaLoading(false)}
                      onLoadedData={() => setLightboxMediaLoading(false)}
                      onCanPlay={() => setLightboxMediaLoading(false)}
                      onError={() => setLightboxMediaLoading(false)}
                      className="max-w-full max-h-[min(70vh,800px)] rounded-lg bg-black"
                    />
                  )}
                </div>
              )}
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
                        <div className="flex flex-col gap-2">
                          {clusterSuggestions.map((r) => {
                            const cid = r.cluster_id!;
                            const busy = addingFace?.faceIdx === faceIdx && addingFace?.clusterId === cid;
                            return (
                              <div
                                key={cid}
                                className="flex flex-wrap items-center gap-2 py-1.5 px-2 rounded-lg bg-gray-900/70 border border-gray-600/80"
                              >
                                <span className="text-sm text-gray-200 min-w-0 flex-1">
                                  {personLabel(cid)}{" "}
                                  <span className="text-amber-400 font-medium">
                                    ({Math.round(r.similarity * 100)}%)
                                  </span>
                                </span>
                                <div className="flex items-center gap-1.5 shrink-0">
                                  <Link
                                    to={`/person/${cid}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="px-2.5 py-1 rounded-md bg-gray-700 hover:bg-gray-600 text-xs font-semibold text-gray-100 border border-gray-500/80"
                                  >
                                    Ver
                                  </Link>
                                  <button
                                    type="button"
                                    onClick={() => handleAddFaceToPerson(cid, face.bbox, faceIdx, face)}
                                    disabled={busy}
                                    className="px-2.5 py-1 rounded-md bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-xs font-semibold text-white"
                                  >
                                    {busy ? "…" : "Agregar"}
                                  </button>
                                </div>
                              </div>
                            );
                          })}
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
