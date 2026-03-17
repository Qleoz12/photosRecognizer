import { useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { api, SearchResult } from "../api";
import Spinner from "../components/Spinner";

export default function Search() {
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  const handleFile = async (file: File) => {
    setError(null);
    setResults(null);
    setPreview(URL.createObjectURL(file));
    setLoading(true);
    try {
      const res = await api.searchByFace(file);
      setResults(res);
    } catch (e: unknown) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  };

  // Deduplicate by cluster_id, keeping highest similarity
  const topClusters = (() => {
    if (!results) return [];
    const map = new Map<string, SearchResult>();
    for (const r of results) {
      const key = r.cluster_id != null ? `c:${r.cluster_id}` : `f:${r.face_id}`;
      if (!map.has(key) || map.get(key)!.similarity < r.similarity) {
        map.set(key, r);
      }
    }
    return [...map.values()].sort((a, b) => b.similarity - a.similarity);
  })();

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Search by Face</h1>

      {/* Upload zone */}
      <div
        onDrop={handleDrop}
        onDragOver={(e) => e.preventDefault()}
        onClick={() => fileRef.current?.click()}
        className="border-2 border-dashed border-gray-700 hover:border-blue-500 rounded-xl p-12 text-center cursor-pointer transition-colors mb-8"
      >
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleInputChange}
        />
        {preview ? (
          <img src={preview} alt="query" className="mx-auto max-h-48 rounded-lg object-contain" />
        ) : (
          <>
            <p className="text-4xl mb-3">🔍</p>
            <p className="text-gray-400">Drop a photo here or click to select</p>
            <p className="text-sm text-gray-600 mt-1">
              Best results with a clear frontal face photo
            </p>
          </>
        )}
      </div>

      {error && (
        <div className="mb-6 px-4 py-3 bg-red-900/40 border border-red-700 rounded-lg text-red-300 text-sm">
          {error}
        </div>
      )}

      {loading && <Spinner message="Searching faces..." />}

      {topClusters.length > 0 && (
        <>
          <h2 className="text-lg font-semibold mb-4">
            Top Matches ({topClusters.length})
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
            {topClusters.map((r) => {
              const thumb = api.thumbnailUrl(r.thumbnail_path);
              const simPct = Math.round(r.similarity * 100);
              return (
                <div
                  key={r.face_id}
                  onClick={() => r.cluster_id && navigate(`/person/${r.cluster_id}`)}
                  className="bg-gray-900 rounded-xl overflow-hidden border border-gray-800 hover:border-blue-500 cursor-pointer transition-colors"
                >
                  <div className="aspect-square bg-gray-800 overflow-hidden">
                    {thumb ? (
                      <img src={thumb} alt="" className="w-full h-full object-cover" loading="lazy" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-4xl text-gray-600">
                        👤
                      </div>
                    )}
                  </div>
                  <div className="p-3">
                    <p className="text-sm font-medium">
                      {r.cluster_id != null ? `Person #${r.cluster_id}` : "Unassigned face"}
                    </p>
                    <div className="mt-2 flex items-center gap-2">
                      <div className="flex-1 bg-gray-800 rounded-full h-1.5">
                        <div
                          className="h-1.5 rounded-full bg-gradient-to-r from-orange-500 to-green-500"
                          style={{ width: `${simPct}%` }}
                        />
                      </div>
                      <span className="text-xs text-gray-400">{simPct}%</span>
                    </div>
                    {r.exif_date && (
                      <p className="text-xs text-gray-500 mt-1">
                        {new Date(r.exif_date).toLocaleDateString()}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {results?.length === 0 && !loading && (
        <p className="text-center text-gray-500 py-12">No matches found in the library.</p>
      )}
    </div>
  );
}
