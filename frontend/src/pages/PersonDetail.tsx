import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api, ClusterOut, ClusterSimilarOut, FileOut, SearchResult } from "../api";
import FaceCropSelector from "../components/FaceCropSelector";
import PhotoCard from "../components/PhotoCard";
import PersonCard from "../components/PersonCard";
import Spinner from "../components/Spinner";
import { useInfiniteScroll } from "../hooks/useInfiniteScroll";

const PAGE_SIZE = 100;

export default function PersonDetail() {
  const { id } = useParams<{ id: string }>();
  const personId = Number(id);
  const navigate = useNavigate();

  const [person, setPerson] = useState<ClusterOut | null>(null);
  const [files, setFiles] = useState<FileOut[]>([]);
  const [similar, setSimilar] = useState<ClusterSimilarOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [editing, setEditing] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [merging, setMerging] = useState<number | null>(null);
  const [onlyClearFaces, setOnlyClearFaces] = useState(false);
  const [lightbox, setLightbox] = useState<FileOut | null>(null);
  const [lightboxIdx, setLightboxIdx] = useState<number>(0);
  const [cropMode, setCropMode] = useState(false);
  const [cropResults, setCropResults] = useState<{
    faces: Array<{ bbox: number[]; det_score: number; suggestions: SearchResult[]; embedding_b64?: string }>;
  } | null>(null);
  const [, setCropBbox] = useState<[number, number, number, number] | null>(null);
  const [cropSearching, setCropSearching] = useState(false);
  const [addingFace, setAddingFace] = useState<{ faceIdx: number; clusterId: number } | null>(null);
  const [allPeople, setAllPeople] = useState<ClusterOut[]>([]);
  const [assigningFace, setAssigningFace] = useState<number | null>(null);
  const [editingDateFor, setEditingDateFor] = useState<number | null>(null);
  const [dateInput, setDateInput] = useState("");
  const [lightboxZoom, setLightboxZoom] = useState(1);
  const [lightboxPan, setLightboxPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const panStartRef = useRef<{ x: number; y: number; startPanX: number; startPanY: number } | null>(null);
  const zoomContainerRef = useRef<HTMLDivElement>(null);
  const [showCoverPicker, setShowCoverPicker] = useState(false);
  const [settingCover, setSettingCover] = useState(false);
  const [coverVersion, setCoverVersion] = useState(0);
  const [coverUpdatedMsg, setCoverUpdatedMsg] = useState(false);
  const [removingFace, setRemovingFace] = useState<number | null>(null);
  const [settingCanonical, setSettingCanonical] = useState<number | null>(null);
  const [dateMetadata, setDateMetadata] = useState<{
    file_modified: string | null;
    file_created: string | null;
    exif_date: string | null;
    exif_datetime_original: string | null;
    exif_datetime_digitized: string | null;
    exif_image_datetime: string | null;
  } | null>(null);
  const [similarModalOpen, setSimilarModalOpen] = useState(false);
  const [similarResults, setSimilarResults] = useState<{ file_id: number; similarity: number }[]>([]);
  const [findingSimilar, setFindingSimilar] = useState(false);
  const [similarPoolCount, setSimilarPoolCount] = useState(0);
  const [similarFiles, setSimilarFiles] = useState<Record<number, FileOut>>({});

  useEffect(() => {
    Promise.all([
      api.getPerson(personId),
      api.getPersonPhotos(personId, 0, PAGE_SIZE),
      api.getSimilarPeople(personId, 15, 0.5),
    ])
      .then(([p, ph, sim]) => {
        setPerson(p);
        setNewLabel(p.label ?? "");
        setFiles(ph);
        setHasMore(ph.length === PAGE_SIZE);
        setSimilar(sim);
      })
      .finally(() => setLoading(false));
  }, [personId]);

  // Zoom con scroll en lightbox (passive: false para preventDefault)
  useEffect(() => {
    const el = zoomContainerRef.current;
    if (!el || lightbox?.file_type === "video" || cropMode) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.deltaY < 0) setLightboxZoom((z) => Math.min(4, z + 0.15));
      else setLightboxZoom((z) => Math.max(0.5, z - 0.15));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [lightbox?.id, lightbox?.file_type, cropMode]);

  // Arrastrar (pan) cuando hay zoom
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!panStartRef.current) return;
      const dx = e.clientX - panStartRef.current.x;
      const dy = e.clientY - panStartRef.current.y;
      setLightboxPan({
        x: panStartRef.current.startPanX + dx,
        y: panStartRef.current.startPanY + dy,
      });
    };
    const onUp = () => {
      panStartRef.current = null;
      setIsPanning(false);
    };
    if (isPanning) {
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
      return () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
    }
  }, [isPanning]);

  // Reset pan cuando zoom vuelve a 1
  useEffect(() => {
    if (lightboxZoom <= 1) setLightboxPan({ x: 0, y: 0 });
  }, [lightboxZoom]);

  // Flechas del teclado en lightbox (← → para navegar, Esc para cerrar)
  useEffect(() => {
    if (!lightbox) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (cropMode) setCropMode(false), setCropResults(null);
        else if (cropResults) setCropResults(null);
        else setLightbox(null);
      } else if (!cropMode && !cropResults) {
        if (e.key === "ArrowLeft") { e.preventDefault(); prevPhoto(); }
        else if (e.key === "ArrowRight") { e.preventDefault(); nextPhoto(); }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightbox, lightboxIdx, cropMode, cropResults]);

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const more = await api.getPersonPhotos(personId, files.length, PAGE_SIZE);
      setFiles((prev) => [...prev, ...more]);
      setHasMore(more.length === PAGE_SIZE);
    } finally {
      setLoadingMore(false);
    }
  }, [personId, files.length, loadingMore, hasMore]);

  const loadMoreSentinelRef = useInfiniteScroll(loadMore, loadingMore, hasMore);

  const handleRename = async () => {
    if (!person) return;
    const updated = await api.renamePerson(person.id, newLabel);
    setPerson(updated);
    setEditing(false);
  };

  const personFileIds = new Set(files.map((f) => f.id));

  const handleFindSimilarHere = async () => {
    setSimilarModalOpen(true);
    setFindingSimilar(true);
    setSimilarResults([]);
    setSimilarPoolCount(0);
    setSimilarFiles({});
    try {
      const pool: number[] = [];
      const poolFiles: Record<number, FileOut> = {};
      const BATCH = 1000;
      const MAX = 5000;
      for (let skip = 0; skip < MAX; skip += BATCH) {
        const batch = await api.getPhotos(skip, BATCH, "photo");
        if (batch.length === 0) break;
        for (const f of batch) {
          if (!personFileIds.has(f.id)) {
            pool.push(f.id);
            poolFiles[f.id] = f;
          }
        }
        setSimilarPoolCount(pool.length);
        if (batch.length < BATCH) break;
      }
      const results = await api.findSimilarPersonInPage(personId, pool);
      setSimilarResults(results);
      const byId: Record<number, FileOut> = {};
      for (const r of results) {
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

  const handleAddSimilarToPerson = async (fileId: number) => {
    try {
      await api.addFaceToPerson(personId, fileId, [0, 0, 1, 1]);
      setSimilarResults((prev) => prev.filter((r) => r.file_id !== fileId));
      const [updated, newFiles] = await Promise.all([
        api.getPerson(personId),
        api.getPersonPhotos(personId, 0, Math.max(files.length, PAGE_SIZE)),
      ]);
      setPerson(updated);
      setFiles(newFiles);
    } catch (e) {
      alert("Error: " + e);
    }
  };

  const handleMerge = async (sourceId: number) => {
    if (!person) return;
    setMerging(sourceId);
    try {
      const merged = await api.mergePeople(sourceId, person.id);
      setPerson(merged);
      setSimilar((prev) => prev.filter((s) => s.id !== sourceId));
      // Recargar personas similares (el centroide cambió al fusionar)
      const sim = await api.getSimilarPeople(personId, 15, 0.5);
      setSimilar(sim);
    } finally {
      setMerging(null);
    }
  };

  const openLightbox = (f: FileOut) => {
    const idx = filteredFiles.indexOf(f);
    setLightboxIdx(idx);
    setLightbox(f);
    setCropMode(false);
    setCropResults(null);
    setCropBbox(null);
    setLightboxZoom(1);
    setLightboxPan({ x: 0, y: 0 });
    if (f.faces?.length) api.getPeople(0, 300).then(setAllPeople).catch(() => setAllPeople([]));
  };

  const handleSetCoverFace = async (faceId: number): Promise<boolean> => {
    try {
      const updated = await api.setPersonCoverFace(personId, faceId);
      setPerson(updated);
      setCoverVersion((v) => v + 1);
      return true;
    } catch (e) {
      alert("Error: " + e);
      return false;
    }
  };

  const handleSetFaceCanonical = async (faceId: number, isCanonical: boolean) => {
    setSettingCanonical(faceId);
    try {
      const updated = await api.setFaceCanonical(personId, faceId, isCanonical);
      setPerson(updated);
      const newFiles = await api.getPersonPhotos(personId, 0, Math.max(files.length, PAGE_SIZE));
      setFiles(newFiles);
      setLightbox((prev) => {
        if (!prev?.faces?.some((f) => f.id === faceId)) return prev;
        return {
          ...prev,
          faces: prev.faces!.map((f) =>
            f.id === faceId ? { ...f, is_canonical: isCanonical } : f
          ),
        };
      });
    } catch (e) {
      alert("Error: " + e);
    } finally {
      setSettingCanonical(null);
    }
  };

  const handleRemoveFaceFromPerson = async (faceId: number) => {
    setRemovingFace(faceId);
    try {
      const updated = await api.removeFaceFromPerson(personId, faceId);
      setPerson(updated);
      const newFiles = await api.getPersonPhotos(personId, 0, Math.max(files.length, PAGE_SIZE));
      setFiles(newFiles);
      setLightbox((prev) => {
        if (!prev?.faces?.some((f) => f.id === faceId)) return prev;
        return {
          ...prev,
          faces: prev.faces!.map((f) =>
            f.id === faceId ? { ...f, cluster_id: null } : f
          ),
        };
      });
    } catch (e) {
      alert("Error: " + e);
    } finally {
      setRemovingFace(null);
    }
  };

  /** Usar la foto como perfil: elige el rostro de esta persona con mayor det_score */
  const handleSetCoverFromPhoto = async (file: FileOut) => {
    const myFaces = file.faces?.filter((fa) => fa.cluster_id === personId) ?? [];
    if (myFaces.length === 0) {
      alert("Esta foto no tiene rostros asignados a esta persona.");
      return;
    }
    const best = myFaces.reduce((a, b) =>
      (a.det_score ?? 0) >= (b.det_score ?? 0) ? a : b
    );
    setSettingCover(true);
    try {
      const ok = await handleSetCoverFace(best.id);
      if (ok) {
        setLightbox(null);
        setCoverUpdatedMsg(true);
        setTimeout(() => setCoverUpdatedMsg(false), 2500);
      }
    } finally {
      setSettingCover(false);
    }
  };

  const handleAssignFace = async (faceId: number, targetPersonId: number) => {
    setAssigningFace(faceId);
    try {
      await api.assignFaceToPerson(targetPersonId, faceId);
      const [updated, sim, newFiles] = await Promise.all([
        api.getPerson(personId),
        api.getSimilarPeople(personId, 15, 0.5),
        api.getPersonPhotos(personId, 0, Math.max(files.length, PAGE_SIZE)),
      ]);
      setPerson(updated);
      setSimilar(sim);
      setFiles(newFiles);
      setLightbox((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          faces: prev.faces.map((fa) =>
            fa.id === faceId ? { ...fa, cluster_id: targetPersonId } : fa
          ),
        };
      });
    } catch (e) {
      alert("Error: " + e);
    } finally {
      setAssigningFace(null);
    }
  };

  const handleCropComplete = async (bbox: [number, number, number, number]) => {
    if (!lightbox || lightbox.file_type === "video") return;
    setCropBbox(bbox);
    setCropSearching(true);
    setCropResults(null);
    try {
      const { faces } = await api.searchFacesFromRegion(lightbox.id, bbox, 10);
      setCropResults({ faces });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      alert(
        msg.includes("422")
          ? "No se detectaron rostros en la región. Intenta con un área más amplia que incluya claramente los rostros."
          : msg
      );
    } finally {
      setCropSearching(false);
    }
  };

  const handleAddFaceToCluster = async (
    clusterId: number,
    faceBbox: number[],
    faceIndex: number,
    face?: { embedding_b64?: string; det_score: number }
  ) => {
    if (!lightbox || lightbox.file_type === "video") return;
    setAddingFace({ faceIdx: faceIndex, clusterId });
    try {
      await api.addFaceToPerson(clusterId, lightbox.id, faceBbox, {
        embedding_b64: face?.embedding_b64,
        det_score: face?.det_score,
      });
      // Quitar solo este rostro de los resultados (ya asignado)
      const bboxKey = faceBbox.map((v) => v.toFixed(4)).join(",");
      setCropResults((prev) => {
        if (!prev) return null;
        const remaining = prev.faces.filter(
          (f) => f.bbox.map((v) => v.toFixed(4)).join(",") !== bboxKey
        );
        if (remaining.length === 0) {
          setCropMode(false);
          setCropBbox(null);
          return null;
        }
        return { faces: remaining };
      });
      // Recargar datos: la foto debe aparecer en todas las galerías asignadas
      const [updated, sim, newFiles] = await Promise.all([
        api.getPerson(personId),
        api.getSimilarPeople(personId, 15, 0.5),
        api.getPersonPhotos(personId, 0, Math.max(files.length, PAGE_SIZE)),
      ]);
      setPerson(updated);
      setSimilar(sim);
      setFiles(newFiles);
      if (clusterId !== personId) {
        alert(`Rostro agregado. La foto aparecerá en la galería de Persona #${clusterId} y en la tuya.`);
      }
    } catch (e) {
      alert("Error: " + e);
    } finally {
      setAddingFace(null);
    }
  };

  const handleSetDate = async (fileId: number) => {
    const val = dateInput.trim();
    const exifDate = val ? `${val}T12:00:00.000Z` : null;
    try {
      const updated = await api.updatePhotoDate(fileId, exifDate);
      setFiles((prev) => prev.map((f) => (f.id === fileId ? updated : f)));
      setLightbox((prev) => (prev?.id === fileId ? updated : prev ?? null));
      setEditingDateFor(null);
      setDateInput("");
    } catch (e) {
      alert("Error: " + e);
    }
  };

  const handleUseDate = async (fileId: number, isoDate: string) => {
    // Usar solo la parte de fecha (YYYY-MM-DD) + mediodía UTC para evitar cambios por zona horaria
    const datePart = isoDate.slice(0, 10);
    const exifDate = `${datePart}T12:00:00.000Z`;
    try {
      const updated = await api.updatePhotoDate(fileId, exifDate);
      setFiles((prev) => prev.map((f) => (f.id === fileId ? updated : f)));
      setLightbox((prev) => (prev?.id === fileId ? updated : prev ?? null));
      setDateInput(datePart);
    } catch (e) {
      alert("Error: " + e);
    }
  };

  const openDateEditor = (file: FileOut) => {
    setEditingDateFor(file.id);
    setDateInput(file.exif_date ? new Date(file.exif_date).toISOString().slice(0, 10) : "");
    api.getPhotoDateMetadata(file.id).then(setDateMetadata).catch(() => setDateMetadata(null));
  };

  const prevPhoto = () => {
    const idx = Math.max(0, lightboxIdx - 1);
    setLightboxIdx(idx);
    setLightbox(filteredFiles[idx]);
    setLightboxZoom(1);
    setLightboxPan({ x: 0, y: 0 });
  };

  const nextPhoto = async () => {
    const idx = lightboxIdx + 1;
    if (idx >= filteredFiles.length && hasMore) await loadMore();
    if (idx < filteredFiles.length) {
      setLightboxIdx(idx);
      setLightbox(filteredFiles[idx]);
      setLightboxZoom(1);
      setLightboxPan({ x: 0, y: 0 });
    }
  };

  if (loading) return <Spinner message="Cargando persona..." />;
  if (!person) return <p className="p-6 text-red-400">Persona no encontrada.</p>;

  const videos = files.filter((f) => f.file_type === "video");

  // Filter: only files where this person's face has clear detection (det_score >= 0.6)
  const filteredFiles = onlyClearFaces
    ? files.filter((f) =>
        f.faces.some(
          (fa) => fa.cluster_id === personId && (fa.det_score ?? 0) >= 0.6
        )
      )
    : files;

  // Group by year
  const byYear: Record<string, FileOut[]> = {};
  for (const f of filteredFiles) {
    const year = f.exif_date ? new Date(f.exif_date).getFullYear().toString() : "Sin fecha";
    (byYear[year] ??= []).push(f);
  }
  const years = Object.keys(byYear).sort((a, b) => {
    if (a === "Sin fecha") return 1;
    if (b === "Sin fecha") return -1;
    return b.localeCompare(a);
  });

  const fileName = (f: FileOut) => f.path.split(/[\\/]/).pop() ?? f.path;

  return (
    <div className="p-6">
      {coverUpdatedMsg && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-lg bg-green-600 text-white text-sm font-medium shadow-lg">
          ✓ Foto de perfil actualizada
        </div>
      )}

      {/* Header */}
      <div className="flex items-center gap-6 mb-8">
        <button onClick={() => navigate(-1)} className="text-gray-400 hover:text-white text-2xl">
          ←
        </button>
        <div className="relative group">
          <div className="w-20 h-20 rounded-full overflow-hidden bg-gray-800 shrink-0">
            {api.thumbnailUrl(person.cover_thumbnail) ? (
              <img
                key={`cover-${person.cover_face_id ?? 0}-${coverVersion}`}
                src={`${api.thumbnailUrl(person.cover_thumbnail)!}?v=${coverVersion}`}
                alt={person.label ?? ""}
                className="w-full h-full object-cover"
                onError={(e) => {
                  const t = e.target as HTMLImageElement;
                  if (person.cover_face_id) t.src = api.faceCropByIdUrl(person.cover_face_id);
                }}
              />
            ) : person.cover_face_id ? (
              <img
                key={`cover-${person.cover_face_id}-${coverVersion}`}
                src={api.faceCropByIdUrl(person.cover_face_id)}
                alt={person.label ?? ""}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-3xl">👤</div>
            )}
          </div>
          <button
            onClick={() => setShowCoverPicker(true)}
            className="absolute inset-0 flex items-center justify-center bg-black/50 rounded-full opacity-0 group-hover:opacity-100 transition-opacity text-sm text-white"
            title="Configurar foto de perfil"
          >
            📷
          </button>
        </div>
        <div>
          {editing ? (
            <div className="flex items-center gap-2">
              <input
                autoFocus
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleRename()}
                className="bg-gray-800 border border-gray-600 rounded px-3 py-1 text-white text-xl"
              />
              <button onClick={handleRename} className="text-sm text-blue-400 hover:text-blue-300">Guardar</button>
              <button onClick={() => setEditing(false)} className="text-sm text-gray-500">Cancelar</button>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold">
                {person.label ?? `Persona #${person.id}`}
              </h1>
              {person.is_manual && <span className="text-xs text-purple-400 font-medium border border-purple-700 rounded-full px-2 py-0.5">✓ confirmada</span>}
              <button onClick={() => setEditing(true)} className="text-gray-500 hover:text-gray-300 text-sm">
                ✏️ Renombrar
              </button>
              <button onClick={() => setShowCoverPicker(true)} className="text-gray-500 hover:text-gray-300 text-sm">
                📷 Configurar foto
              </button>
            </div>
          )}
          <p className="text-gray-400 mt-1">
            {person.size.toLocaleString()} fotos en total
            {" · "}mostrando {files.length.toLocaleString()}
            {videos.length > 0 && ` · ${videos.length} video${videos.length !== 1 ? "s" : ""}`}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleFindSimilarHere}
              disabled={findingSimilar}
              className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-medium"
            >
              {findingSimilar ? "Buscando..." : "Buscar similares aquí"}
            </button>
            <span className="text-xs text-gray-500 self-center max-w-md">
              Busca entre las primeras ~10 000 fotos. Las sugerencias aparecen aquí (no te envía a la galería).
            </span>
          </div>
        </div>
      </div>

      {/* Modal: Rostros + Foto de perfil */}
      {showCoverPicker && (
        <div
          className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center p-4"
          onClick={() => setShowCoverPicker(false)}
        >
          <div
            className="bg-gray-900 rounded-xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-4 border-b border-gray-700 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-white">
                Rostros de {person?.label ?? `Persona #${personId}`}
              </h2>
              <button
                onClick={() => setShowCoverPicker(false)}
                className="text-gray-400 hover:text-white text-2xl"
              >
                ✕
              </button>
            </div>
            <div className="p-4 border-b border-gray-700 text-sm text-gray-400">
              <p><strong className="text-purple-400">Perfil</strong> = foto que se muestra. <strong className="text-amber-400">Centroide</strong> = rostros usados para comparaciones. <strong className="text-red-400">✕</strong> = quitar del conjunto.</p>
            </div>
            <div className="p-4 overflow-y-auto flex-1">
              <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-4">
                {filteredFiles
                  .flatMap((f) =>
                    (f.faces ?? [])
                      .filter((fa) => fa.cluster_id === personId)
                      .map((fa) => ({ file: f, face: fa }))
                  )
                  .map(({ file, face }) => (
                    <div
                      key={face.id}
                      className={`flex flex-col items-center gap-2 p-2 rounded-lg border transition-colors ${
                        face.id === person?.cover_face_id
                          ? "bg-purple-900/30 border-purple-500"
                          : (face.is_canonical !== false ? "bg-gray-800 border-gray-700 hover:border-purple-500" : "bg-gray-800/60 border-amber-900/50 opacity-75")
                      }`}
                    >
                      <img
                        src={api.faceCropByIdUrl(face.id)}
                        alt=""
                        className="w-16 h-16 rounded-lg object-cover"
                        onError={(e) => {
                          (e.target as HTMLImageElement).src = api.thumbnailUrl(file.thumbnail_path) ?? "";
                        }}
                      />
                      {face.id === person?.cover_face_id && (
                        <span className="text-xs text-purple-400 font-medium">Foto de perfil</span>
                      )}
                      <div className="flex flex-wrap gap-1 w-full justify-center">
                        <button
                          onClick={async () => {
                            try {
                              const updated = await api.setPersonCoverFace(personId, face.id);
                              setPerson(updated);
                              setCoverVersion((v) => v + 1);
                              setShowCoverPicker(false);
                            } catch (err) {
                              alert("Error: " + err);
                            }
                          }}
                          className="text-xs px-2 py-1 rounded bg-purple-600 hover:bg-purple-500 text-white"
                        >
                          Perfil
                        </button>
                        <button
                          onClick={() => handleSetFaceCanonical(face.id, face.is_canonical === false)}
                          disabled={settingCanonical === face.id}
                          title={face.is_canonical !== false ? "Excluir del centroide (no usará en comparaciones)" : "Incluir en centroide (usará en comparaciones)"}
                          className={`text-xs px-2 py-1 rounded ${face.is_canonical !== false ? "bg-amber-700 hover:bg-amber-600" : "bg-green-800 hover:bg-green-700"} text-white disabled:opacity-50`}
                        >
                          {settingCanonical === face.id ? "…" : (face.is_canonical !== false ? "Excluir" : "Incluir")}
                        </button>
                        <button
                          onClick={() => handleRemoveFaceFromPerson(face.id)}
                          disabled={removingFace === face.id}
                          title="Quitar del conjunto (quedará sin asignar)"
                          className="text-xs px-2 py-1 rounded bg-red-900/80 hover:bg-red-800 text-white disabled:opacity-50"
                        >
                          {removingFace === face.id ? "…" : "✕"}
                        </button>
                      </div>
                    </div>
                  ))}
              </div>
              {filteredFiles.flatMap((f) => f.faces?.filter((fa) => fa.cluster_id === personId) ?? []).length === 0 && (
                <p className="text-gray-500 text-center py-8">
                  No hay rostros. Usa &quot;Seleccionar persona en foto&quot; para asignar rostros primero.
                </p>
              )}
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
            <div className="p-4 border-b border-gray-700 flex items-center justify-between shrink-0">
              <h2 className="text-lg font-semibold text-white">
                Similares a la persona — busca en {similarPoolCount.toLocaleString()} fotos cargadas
              </h2>
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
                  {similarPoolCount > 0 ? "No se encontraron fotos con esta persona." : "Sin resultados."}
                </div>
              ) : (
                <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-12 gap-2">
                  {similarResults.map((r) => {
                    const f = similarFiles[r.file_id];
                    if (!f) return null;
                    return (
                      <div key={r.file_id} className="relative group">
                        <PhotoCard file={f} onClick={() => setLightbox(f)} />
                        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 bg-black/60 rounded-lg transition-opacity">
                          <button
                            onClick={() => handleAddSimilarToPerson(r.file_id)}
                            className="px-2 py-1 rounded text-white text-xs bg-blue-600 hover:bg-blue-500"
                          >
                            + Persona
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

      {/* Personas similares — ordenadas por parecido para validar merges */}
      {similar.length > 0 && (
        <div className="mb-10">
          <h2 className="text-lg font-semibold text-gray-300 mb-3 border-b border-gray-800 pb-2">
            Personas similares
            <span className="text-sm font-normal text-gray-500 ml-2">
              (posibles duplicados — ordenadas por parecido)
            </span>
          </h2>
          <div className="flex flex-wrap gap-4">
            {similar.map((s) => (
              <div key={s.id} className="flex flex-col items-center gap-2">
                <PersonCard
                  cluster={s}
                  similarity={s.similarity}
                  onClick={() => navigate(`/person/${s.id}`)}
                />
                <button
                  onClick={() => handleMerge(s.id)}
                  disabled={merging === s.id}
                  className="px-3 py-1 text-xs rounded-lg bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white"
                >
                  {merging === s.id ? "Uniendo..." : "Unir aquí"}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Filtro: ocultar fotos sin rostro claro */}
      <div className="flex items-center gap-2 mb-4">
        <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-400">
          <input
            type="checkbox"
            checked={onlyClearFaces}
            onChange={(e) => setOnlyClearFaces(e.target.checked)}
            className="rounded"
          />
          Ocultar fotos sin rostro claro
        </label>
        {onlyClearFaces && (
          <span className="text-xs text-gray-500">
            (mostrando {filteredFiles.length} de {files.length})
          </span>
        )}
      </div>

      {/* Timeline por año */}
      {years.map((year) => (
        <div key={year} className="mb-10">
          <h2 className="text-xl font-semibold text-gray-300 mb-4 border-b border-gray-800 pb-2">
            {year}
            <span className="text-sm text-gray-500 ml-2">({byYear[year].length})</span>
          </h2>
          <div className="grid grid-cols-3 sm:grid-cols-5 md:grid-cols-8 lg:grid-cols-10 gap-2">
            {byYear[year].map((f) => (
              <PhotoCard key={f.id} file={f} onClick={() => openLightbox(f)} />
            ))}
          </div>
        </div>
      ))}

      {/* Load more — auto-dispara al hacer scroll cuando el botón entra en vista */}
      {hasMore && (
        <div ref={loadMoreSentinelRef} className="flex justify-center mt-4 mb-10 min-h-[60px]">
          <button
            onClick={loadMore}
            disabled={loadingMore}
            className="px-6 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 disabled:opacity-50 transition-colors"
          >
            {loadingMore ? "Cargando..." : `Cargar más fotos (${(person?.size ?? 0) - files.length} restantes)`}
          </button>
        </div>
      )}

      {/* Lightbox */}
      {lightbox && (
        <div
          className="fixed inset-0 bg-black/95 z-50 flex items-center justify-center p-4"
          onClick={() => setLightbox(null)}
        >
          {/* Prev */}
          {lightboxIdx > 0 && (
            <button
              className="absolute left-4 text-white text-4xl hover:text-gray-300 z-10 select-none"
              onClick={(e) => { e.stopPropagation(); prevPhoto(); }}
            >
              ‹
            </button>
          )}
          {/* Next */}
          {(lightboxIdx < filteredFiles.length - 1 || hasMore) && (
            <button
              className="absolute right-4 text-white text-4xl hover:text-gray-300 z-10 select-none"
              onClick={(e) => { e.stopPropagation(); nextPhoto(); }}
            >
              ›
            </button>
          )}

          <div
            className="max-w-5xl w-full max-h-screen flex flex-col items-center overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            {lightbox.file_type === "video" ? (
              <video
                src={api.originalUrl(lightbox.id)}
                controls
                controlsList="nodownload"
                preload="auto"
                autoPlay
                className="max-w-full max-h-[80vh] rounded-lg bg-black"
              />
            ) : cropMode ? (
              <FaceCropSelector
                imageUrl={api.originalUrl(lightbox.id)}
                onComplete={handleCropComplete}
                onCancel={() => setCropMode(false)}
                searching={cropSearching}
              />
            ) : (
              <div
                ref={zoomContainerRef}
                className="overflow-hidden flex items-center justify-center max-h-[80vh] select-none"
                style={{
                  cursor: lightboxZoom > 1 ? (isPanning ? "grabbing" : "grab") : "zoom-in",
                }}
                onMouseDown={(e) => {
                  if (lightboxZoom > 1 && e.button === 0) {
                    panStartRef.current = {
                      x: e.clientX,
                      y: e.clientY,
                      startPanX: lightboxPan.x,
                      startPanY: lightboxPan.y,
                    };
                    setIsPanning(true);
                  }
                }}
                onMouseLeave={() => {
                  if (!isPanning) panStartRef.current = null;
                }}
              >
                <img
                  src={api.originalUrl(lightbox.id)}
                  alt=""
                  className="max-w-full max-h-[80vh] object-contain rounded-lg transition-transform duration-150 pointer-events-none"
                  style={{
                    transform: `translate(${lightboxPan.x}px, ${lightboxPan.y}px) scale(${lightboxZoom})`,
                    transformOrigin: "center center",
                  }}
                  draggable={false}
                />
              </div>
            )}

            {cropSearching && (
              <p className="mt-2 text-amber-400">Buscando personas similares...</p>
            )}

            {cropResults && !cropSearching && lightbox && (
              <div className="mt-4 w-full max-w-2xl space-y-4">
                <h3 className="text-sm font-medium text-gray-300">
                  {cropResults.faces.length > 1
                    ? `${cropResults.faces.length} rostros detectados — asigna cada uno:`
                    : "Agregar rostro a:"}
                </h3>
                <p className="text-xs text-gray-500">
                  La foto aparecerá en la galería de quien elijas. Si ya tiene rostros de otras personas, seguirá en sus galerías también.
                </p>
                {cropResults.faces.map((face, faceIdx) => {
                  const MIN_SIMILARITY = 0.35; // Filtrar ruido (ej. perro vs personas)
                  const suggestions = face.suggestions
                    .filter((r) => r.cluster_id != null && r.similarity >= MIN_SIMILARITY)
                    .reduce((acc: SearchResult[], r) => {
                      if (!acc.some((x) => x.cluster_id === r.cluster_id)) acc.push(r);
                      return acc;
                    }, []);
                  return (
                    <div
                      key={faceIdx}
                      className="flex items-start gap-4 p-3 rounded-lg bg-gray-800/80 border border-gray-700"
                    >
                      <img
                        src={api.faceCropUrl(lightbox.id, face.bbox)}
                        alt={`Rostro ${faceIdx + 1}`}
                        className="w-16 h-16 rounded-lg object-cover shrink-0 border border-gray-600"
                      />
                      <div className="flex-1 min-w-0 flex flex-col gap-2">
                        <span className="text-sm text-gray-400">
                          Rostro {faceIdx + 1} ({Math.round(face.det_score * 100)}%)
                        </span>
                        <div className="flex flex-wrap gap-2">
                          <button
                            onClick={() => handleAddFaceToCluster(personId, face.bbox, faceIdx, face)}
                            disabled={addingFace?.faceIdx === faceIdx && addingFace?.clusterId === personId}
                            className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-sm"
                          >
                            {addingFace?.faceIdx === faceIdx && addingFace?.clusterId === personId
                              ? "..."
                              : `Agregar a ${person?.label ?? `Persona #${personId}`}`}
                          </button>
                          {suggestions.map((r) => (
                            <button
                              key={r.cluster_id!}
                              onClick={() => handleAddFaceToCluster(r.cluster_id!, face.bbox, faceIdx, face)}
                              disabled={addingFace?.faceIdx === faceIdx && addingFace?.clusterId === r.cluster_id}
                              className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-sm"
                            >
                              {addingFace?.faceIdx === faceIdx && addingFace?.clusterId === r.cluster_id
                                ? "..."
                                : `Persona #${r.cluster_id} (${Math.round(r.similarity * 100)}%)`}
                            </button>
                          ))}
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

            {/* Usar esta foto como perfil — botón principal */}
            {!cropMode && lightbox.file_type === "photo" && (() => {
              const myFaces = lightbox.faces?.filter((fa) => fa.cluster_id === personId) ?? [];
              if (myFaces.length === 0) return null;
              return (
                <button
                  onClick={() => handleSetCoverFromPhoto(lightbox)}
                  disabled={settingCover}
                  className="mt-4 px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 disabled:opacity-60 text-white font-medium"
                >
                  {settingCover ? "Guardando..." : "Usar esta foto como perfil"}
                </button>
              );
            })()}

            {/* Rostros ya detectados en la foto — asignar a personas */}
            {!cropMode && lightbox.file_type === "photo" && lightbox.faces?.length > 0 && (
              <div className="mt-4 w-full max-w-2xl">
                <h3 className="text-sm font-medium text-gray-300 mb-2">
                  Rostros en esta foto ({lightbox.faces.length})
                </h3>
                <p className="text-xs text-gray-500 mb-2">
                  Perfil = foto de perfil. Centroide = usado para comparaciones. Quitar = sacar del conjunto.
                </p>
                <div className="flex flex-wrap gap-2">
                  {lightbox.faces.map((fa) => (
                    <div
                      key={fa.id}
                      className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-gray-800 border border-gray-700"
                    >
                      {fa.file_id && (
                        <img
                          src={api.faceCropByIdUrl(fa.id)}
                          alt=""
                          className="w-10 h-10 rounded object-cover shrink-0"
                          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                        />
                      )}
                      {fa.cluster_id != null ? (
                        <span className="text-sm text-gray-300 flex items-center gap-2">
                          Persona #{fa.cluster_id}
                          {fa.det_score != null && (
                            <span className="text-gray-500">({Math.round(fa.det_score * 100)}%)</span>
                          )}
                          {fa.cluster_id === personId && (
                            <>
                              <button
                                onClick={() => handleSetCoverFace(fa.id)}
                                className="text-xs px-2 py-0.5 rounded bg-purple-600 hover:bg-purple-500 text-white"
                              >
                                Perfil
                              </button>
                              <button
                                onClick={() => handleSetFaceCanonical(fa.id, fa.is_canonical === false)}
                                disabled={settingCanonical === fa.id}
                                title={fa.is_canonical !== false ? "Excluir del centroide" : "Incluir en centroide"}
                                className={`text-xs px-2 py-0.5 rounded ${fa.is_canonical !== false ? "bg-amber-700 hover:bg-amber-600" : "bg-green-800 hover:bg-green-700"} text-white disabled:opacity-50`}
                              >
                                {settingCanonical === fa.id ? "…" : (fa.is_canonical !== false ? "Excluir" : "Incluir")}
                              </button>
                              <button
                                onClick={() => handleRemoveFaceFromPerson(fa.id)}
                                disabled={removingFace === fa.id}
                                title="Quitar del conjunto"
                                className="text-xs px-2 py-0.5 rounded bg-red-900/80 hover:bg-red-800 text-white disabled:opacity-50"
                              >
                                {removingFace === fa.id ? "…" : "✕"}
                              </button>
                            </>
                          )}
                        </span>
                      ) : (
                        <>
                          <span className="text-sm text-gray-500">Sin asignar</span>
                          <select
                            className="text-sm bg-gray-700 rounded px-2 py-0.5"
                            value=""
                            onChange={(e) => {
                              const v = e.target.value;
                              if (v) handleAssignFace(fa.id, Number(v));
                              e.target.value = "";
                            }}
                            disabled={assigningFace === fa.id}
                          >
                            <option value="">Agregar a...</option>
                            {[person, ...allPeople.filter((p) => p.id !== person?.id)].filter(Boolean).map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.label ?? `Persona #${p.id}`}
                              </option>
                            ))}
                          </select>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {!cropMode && lightbox.file_type === "photo" && (
              <button
                onClick={() => setCropMode(true)}
                className="mt-2 px-3 py-1.5 rounded-lg bg-amber-700 hover:bg-amber-600 text-sm"
              >
                Seleccionar persona en foto
              </button>
            )}

            <div className="mt-3 w-full flex flex-col gap-2">
              <div className="flex items-center justify-between text-sm text-gray-400">
                <span className="truncate max-w-xs">{fileName(lightbox)}</span>
                <div className="flex items-center gap-4 shrink-0">
                  <span className="text-gray-600">{lightboxIdx + 1} / {filteredFiles.length}</span>
                  {lightbox.exif_date ? (
                    <span>{new Date(lightbox.exif_date).toLocaleDateString()}</span>
                  ) : editingDateFor !== lightbox.id ? (
                    <span className="text-amber-400/90">Sin fecha</span>
                  ) : null}
                  {lightbox.file_type === "video" && (
                  <a
                    href={api.originalUrl(lightbox.id)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-400 hover:text-blue-300"
                    onClick={(e) => e.stopPropagation()}
                  >
                    Abrir ↗
                  </a>
                )}
                <span className="text-gray-500 text-xs">← → navegar · Scroll zoom · Arrastrar para mover · Esc cerrar</span>
                <button onClick={() => setLightbox(null)} className="hover:text-white">✕</button>
              </div>
            </div>
            {/* Date metadata, "Usar esta fecha" buttons, and manual input */}
            <div className="mt-2 p-3 rounded-lg bg-gray-800/60 border border-gray-700 text-xs">
              {editingDateFor === lightbox.id ? (
                <>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-gray-400 font-medium">Fechas disponibles</span>
                    <button
                      onClick={() => { setEditingDateFor(null); setDateMetadata(null); }}
                      className="text-gray-500 hover:text-gray-400"
                    >
                      Cerrar
                    </button>
                  </div>
                  {dateMetadata && (
                    <div className="space-y-1.5 mb-3">
                      {[
                        { key: "file_created", label: "Creado (archivo)", val: dateMetadata.file_created },
                        { key: "file_modified", label: "Modificado (archivo)", val: dateMetadata.file_modified },
                        { key: "exif_datetime_original", label: "EXIF Original", val: dateMetadata.exif_datetime_original },
                        { key: "exif_datetime_digitized", label: "EXIF Digitizado", val: dateMetadata.exif_datetime_digitized },
                        { key: "exif_image_datetime", label: "EXIF Imagen", val: dateMetadata.exif_image_datetime },
                        { key: "exif_date", label: "Fecha actual (DB)", val: dateMetadata.exif_date },
                      ].filter((x) => x.val).map(({ key, label, val }) => (
                        <div key={key} className="flex items-center justify-between gap-2">
                          <span className="text-gray-500 truncate">
                            {label}: {new Date(val!).toLocaleString()}
                          </span>
                          <button
                            onClick={() => handleUseDate(lightbox.id, val!)}
                            className="shrink-0 px-2 py-0.5 rounded bg-green-700 hover:bg-green-600 text-white"
                          >
                            Usar esta fecha
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="flex items-center gap-2 flex-wrap border-t border-gray-700 pt-2">
                    <span className="text-gray-500">Manual:</span>
                    <input
                      type="date"
                      value={dateInput}
                      onChange={(e) => setDateInput(e.target.value)}
                      className="bg-gray-800 border border-gray-600 rounded px-2 py-1 text-white"
                    />
                    <button
                      onClick={() => handleSetDate(lightbox.id)}
                      className="px-2 py-1 rounded bg-blue-600 hover:bg-blue-500 text-white"
                    >
                      Guardar
                    </button>
                  </div>
                </>
              ) : (
                <button
                  onClick={() => openDateEditor(lightbox)}
                  className="text-blue-400 hover:text-blue-300"
                >
                  {lightbox.exif_date ? "Editar fecha" : "Establecer fecha"}
                </button>
              )}
            </div>
          </div>
          </div>
        </div>
      )}
    </div>
  );
}
