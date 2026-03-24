import { useEffect, useState } from "react";
import { api } from "../api";
import PhotoCard from "../components/PhotoCard";
import Spinner from "../components/Spinner";

type ExtInfo = { extension: string; count: number; example_file_id: number; file_type: string };

export default function FileTypes() {
  const [exts, setExts] = useState<ExtInfo[]>([]);
  const [files, setFiles] = useState<Record<number, Awaited<ReturnType<typeof api.getPhoto>>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [lightbox, setLightbox] = useState<number | null>(null);

  useEffect(() => {
    api
      .getFileExtensions()
      .then(async (data) => {
        setExts(data);
        const byId: Record<number, Awaited<ReturnType<typeof api.getPhoto>>> = {};
        await Promise.all(
          data.map((e) =>
            api.getPhoto(e.example_file_id).then((f) => {
              byId[e.example_file_id] = f;
            })
          )
        );
        setFiles(byId);
      })
      .catch((e) => alert("Error: " + e))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Spinner message="Cargando tipos de archivo..." />;

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold text-white mb-2">Tipos de archivo</h1>
      <p className="text-gray-400 text-sm mb-6">
        Un ejemplo por extensión para probar la visualización. Clic en una miniatura para ver el original.
      </p>
      <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-12 gap-4">
        {exts.map((e) => {
          const f = files?.[e.example_file_id];
          if (!f) return null;
          return (
            <div key={e.extension} className="rounded-lg border border-gray-700 overflow-hidden bg-gray-900">
              <div className="p-2 bg-gray-800 text-center">
                <span className="font-mono text-sm text-gray-300">{e.extension}</span>
                <span className="block text-xs text-gray-500">{e.count.toLocaleString()} archivos</span>
              </div>
              <PhotoCard file={f} onClick={() => setLightbox(e.example_file_id)} />
              <p className="px-2 py-1 text-xs text-gray-500 truncate" title={f.path}>
                {f.path.split(/[/\\]/).pop()}
              </p>
            </div>
          );
        })}
      </div>

      {lightbox !== null && files?.[lightbox] && (
        <div
          className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center p-4"
          onClick={() => setLightbox(null)}
        >
          <div onClick={(e) => e.stopPropagation()} className="max-w-5xl w-full">
            {files[lightbox].file_type === "photo" ? (
              <img
                src={api.originalUrl(lightbox)}
                alt=""
                className="max-w-full max-h-[90vh] object-contain rounded-lg"
              />
            ) : (
              <video
                src={api.originalUrl(lightbox)}
                controls
                preload="auto"
                className="max-w-full max-h-[90vh] rounded-lg bg-black"
              />
            )}
            <button
              onClick={() => setLightbox(null)}
              className="mt-2 text-gray-400 hover:text-white"
            >
              ✕ Cerrar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
