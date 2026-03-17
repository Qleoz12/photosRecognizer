import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, ClusterOut, FileOut, SearchResult } from "../api";
import FaceCropSelector from "../components/FaceCropSelector";
import PhotoCard from "../components/PhotoCard";
import Spinner from "../components/Spinner";

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
  const navigate = useNavigate();
  const PAGE_SIZE = 200;

  const loadMore = async (pageNum: number) => {
    setLoading(true);
    const data = await api.getPhotos(pageNum * PAGE_SIZE, PAGE_SIZE);
    if (data.length < PAGE_SIZE) setHasMore(false);
    setPhotos((prev) => (pageNum === 0 ? data : [...prev, ...data]));
    setLoading(false);
  };

  useEffect(() => { loadMore(0); }, []);

  const handleLoadMore = () => {
    const next = page + 1;
    setPage(next);
    loadMore(next);
  };

  const handleCropComplete = async (bbox: [number, number, number, number]) => {
    if (!lightbox || lightbox.file_type !== "photo") return;
    setCropSearching(true);
    setCropResults(null);
    try {
      const [people, { faces }] = await Promise.all([
        api.getPeople(0, 300),
        api.searchFacesFromRegion(lightbox.id, bbox, 15, true),
      ]);
      setAllPeople(people);
      setCropResults({ faces });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      alert(
        msg.includes("422")
          ? "No se pudo procesar la región seleccionada. Intenta con un área más amplia."
          : msg
      );
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
      navigate(`/person/${clusterId}`);
    } catch (e) {
      alert("Error: " + e);
    } finally {
      setAddingFace(null);
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
      navigate(`/person/${created.id}`);
    } catch (e) {
      alert("Error: " + e);
    } finally {
      setCreatingNew(null);
    }
  };

  // Group by year
  const byYear: Record<string, FileOut[]> = {};
  for (const f of photos) {
    const year = f.exif_date ? new Date(f.exif_date).getFullYear().toString() : "Unknown";
    (byYear[year] ??= []).push(f);
  }
  const years = Object.keys(byYear).sort((a, b) => b.localeCompare(a));

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-6">All Photos & Videos</h1>

      {years.map((year) => (
        <div key={year} className="mb-10">
          <h2 className="text-xl font-semibold text-gray-300 mb-4 border-b border-gray-800 pb-2">
            {year} <span className="text-sm text-gray-500">({byYear[year].length})</span>
          </h2>
          <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-12 gap-1">
            {byYear[year].map((f) => (
              <PhotoCard key={f.id} file={f} onClick={() => { setLightbox(f); setCropResults(null); setCropMode(false); }} />
            ))}
          </div>
        </div>
      ))}

      {loading && <Spinner message="Loading photos..." />}

      {!loading && hasMore && (
        <div className="text-center py-8">
          <button
            onClick={handleLoadMore}
            className="px-6 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-sm transition-colors"
          >
            Load More
          </button>
        </div>
      )}

      {/* Lightbox */}
      {lightbox && (
        <div
          className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center p-4 overflow-y-auto"
          onClick={() => { setLightbox(null); setCropResults(null); setCropMode(false); }}
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
                className="max-w-full max-h-[70vh] rounded-lg"
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
              <button onClick={() => { setLightbox(null); setCropResults(null); setCropMode(false); }} className="hover:text-white">
                ✕ Cerrar
              </button>
            </div>

            {/* Resultados de selección */}
            {cropResults && cropResults.faces.length > 0 && (
              <div className="mt-4 p-4 rounded-lg bg-gray-900/80 border border-gray-700">
                <h3 className="text-sm font-medium text-gray-300 mb-2">
                  Posibles personas reconocidas — o crear nueva:
                </h3>
                <div className="space-y-3">
                  {cropResults.faces.map((face, faceIdx) => {
                    const clusterSuggestions = face.suggestions
                      .filter((r) => r.cluster_id != null)
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
                        className="flex items-center gap-4 p-3 rounded-lg bg-gray-800 border border-gray-700"
                      >
                        <img
                          src={api.faceCropUrl(lightbox.id, face.bbox)}
                          alt={`Rostro ${faceIdx + 1}`}
                          className="w-14 h-14 rounded-lg object-cover shrink-0"
                        />
                        <div className="flex-1 flex flex-wrap gap-2 items-center">
                          <span className="text-sm text-gray-400">
                            Rostro {faceIdx + 1} ({Math.round(face.det_score * 100)}%)
                          </span>
                          {clusterSuggestions.map((r) => (
                            <button
                              key={r.cluster_id!}
                              onClick={() => handleAddFaceToPerson(r.cluster_id!, face.bbox, faceIdx, face)}
                              disabled={addingFace?.faceIdx === faceIdx && addingFace?.clusterId === r.cluster_id}
                              className="px-3 py-1.5 rounded-lg bg-green-600 hover:bg-green-500 disabled:opacity-50 text-sm"
                            >
                              {addingFace?.faceIdx === faceIdx && addingFace?.clusterId === r.cluster_id
                                ? "..."
                                : `Agregar a ${personLabel(r.cluster_id!)}`}
                            </button>
                          ))}
                          <div className="flex items-center gap-2">
                            <input
                              type="text"
                              value={newPersonLabels[faceIdx] ?? ""}
                              onChange={(e) => setNewPersonLabels((p) => ({ ...p, [faceIdx]: e.target.value }))}
                              placeholder="Nueva persona (ej. Perro)"
                              className="w-32 bg-gray-700 border border-gray-600 rounded px-2 py-1 text-sm text-white"
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
                    );
                  })}
                </div>
                <button
                  onClick={() => setCropResults(null)}
                  className="mt-2 text-xs text-gray-500 hover:text-gray-400"
                >
                  Cerrar resultados
                </button>
              </div>
            )}
            {cropResults && cropResults.faces.length === 0 && (
              <p className="mt-4 text-amber-400 text-sm">No se detectaron rostros en esta foto.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
