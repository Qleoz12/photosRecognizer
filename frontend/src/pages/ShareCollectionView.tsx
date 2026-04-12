import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { sharePublicBaseUrl } from "../api";

interface ManifestPerson {
  id: number;
  label: string | null;
  size: number;
}

interface ManifestItem {
  file_id: number;
  file_type: string;
  name: string;
  thumb_path: string;
  original_path: string;
}

interface ManifestOk {
  expires_at: string | null;
  persons: ManifestPerson[];
  items: ManifestItem[];
  truncated: boolean;
  max_files: number;
}

export default function ShareCollectionView() {
  const { token } = useParams<{ token: string }>();
  const [loading, setLoading] = useState(true);
  const [gone, setGone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ManifestOk | null>(null);
  const [preview, setPreview] = useState<ManifestItem | null>(null);

  useEffect(() => {
    if (!token) {
      setLoading(false);
      setError("Enlace no válido");
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const base = sharePublicBaseUrl();
        const url = new URL(`/api/share/${encodeURIComponent(token)}/manifest`, base || "http://localhost").href;
        const res = await fetch(url);
        if (res.status === 410) {
          if (!cancelled) setGone(true);
          return;
        }
        if (!res.ok) {
          if (!cancelled) setError(`Error ${res.status}`);
          return;
        }
        const json = (await res.json()) as ManifestOk;
        if (!cancelled) setData(json);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (loading) {
    return (
      <div className="p-8 text-center text-gray-400">Cargando colección compartida…</div>
    );
  }

  if (gone) {
    return (
      <div className="p-8 max-w-md mx-auto text-center">
        <p className="text-xl text-amber-200 mb-2">Este enlace ha caducado</p>
        <p className="text-sm text-gray-500 mb-6">Pide al autor uno nuevo si aún quieren compartir.</p>
        <p className="text-xs text-gray-600">Cierra esta pestaña o pide un enlace nuevo.</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-8 max-w-md mx-auto text-center">
        <p className="text-red-400 mb-4">{error ?? "No se pudo cargar"}</p>
        <p className="text-xs text-gray-600">Revisa la conexión o pide un enlace nuevo a quien compartió.</p>
      </div>
    );
  }

  const mediaBase = sharePublicBaseUrl();

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-white">Colección compartida</h1>
          <p className="text-sm text-gray-500 mt-1">
            {data.persons.map((p) => p.label ?? `Persona #${p.id}`).join(" · ")}
          </p>
          {data.expires_at && (
            <p className="text-xs text-gray-600 mt-1">Válido hasta: {data.expires_at}</p>
          )}
        </div>
        <span className="text-sm text-gray-500 shrink-0">Vista solo lectura</span>
      </div>

      {data.truncated && (
        <p className="text-sm text-amber-200/90 mb-4 rounded-lg border border-amber-900/50 bg-amber-950/30 px-3 py-2">
          Se muestran solo las primeras {data.max_files} fotos de la colección.
        </p>
      )}

      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-2">
        {data.items.map((item) => (
          <button
            key={item.file_id}
            type="button"
            onClick={() => setPreview(item)}
            className="relative aspect-square rounded-lg overflow-hidden border border-gray-800 bg-gray-900 hover:border-sky-600/60 focus:outline-none focus:ring-2 focus:ring-sky-500"
          >
            <img
              src={new URL(item.thumb_path, `${mediaBase}/`).href}
              alt=""
              className="w-full h-full object-cover"
              loading="lazy"
            />
            {item.file_type === "video" && (
              <span className="absolute bottom-1 right-1 text-[10px] px-1 rounded bg-black/70 text-white">
                ▶
              </span>
            )}
          </button>
        ))}
      </div>

      {data.items.length === 0 && (
        <p className="text-gray-500 text-center py-12">No hay fotos en esta colección.</p>
      )}

      {preview && (
        <div
          className="fixed inset-0 z-[70] bg-black/95 flex flex-col items-center justify-center p-4"
          onClick={() => setPreview(null)}
        >
          <button
            type="button"
            className="absolute top-4 right-4 text-white text-2xl hover:text-gray-300"
            onClick={() => setPreview(null)}
          >
            ✕
          </button>
          <div className="max-w-full max-h-[85vh] flex flex-col items-center gap-2" onClick={(e) => e.stopPropagation()}>
            <p className="text-xs text-gray-500 truncate max-w-full">
              {preview.name?.trim() ? preview.name : "Vista previa"}
            </p>
            {preview.file_type === "video" ? (
              <video
                src={new URL(preview.original_path, `${mediaBase}/`).href}
                controls
                className="max-w-full max-h-[75vh] rounded-lg"
                autoPlay
              />
            ) : (
              <img
                src={new URL(preview.original_path, `${mediaBase}/`).href}
                alt=""
                className="max-w-full max-h-[75vh] object-contain rounded-lg"
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
