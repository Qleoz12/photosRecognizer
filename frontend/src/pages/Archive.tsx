import { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import {
  api,
  FileOut,
  API_BASE,
  getStoredArchivePin,
  setStoredArchivePin,
} from "../api";
import PhotoCard from "../components/PhotoCard";
import Spinner from "../components/Spinner";

const PAGE = 80;

/** Vista previa segura: original con cabecera PIN (las miniaturas estáticas pueden seguir siendo accesibles por URL directa). */
function ArchiveLightboxImage({ fileId, pin }: { fileId: number; pin: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    let cancelled = false;
    let blobUrl: string | null = null;
    fetch(`${API_BASE}/originals/${fileId}`, { headers: { "X-Archive-Pin": pin } })
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.blob();
      })
      .then((b) => {
        if (cancelled) return;
        blobUrl = URL.createObjectURL(b);
        setUrl(blobUrl);
      })
      .catch(() => {
        if (!cancelled) setErr(true);
      });
    return () => {
      cancelled = true;
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [fileId, pin]);
  if (err) return <p className="text-red-400">No se pudo cargar la imagen.</p>;
  if (!url) return <Spinner message="Cargando…" />;
  return <img src={url} alt="" className="max-w-full max-h-[75vh] object-contain rounded-lg" />;
}

export default function Archive() {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [pinInput, setPinInput] = useState("");
  const [pinSession, setPinSession] = useState<string | null>(() => getStoredArchivePin());
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [photos, setPhotos] = useState<FileOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(true);
  const [page, setPage] = useState(0);
  const [lightbox, setLightbox] = useState<FileOut | null>(null);
  const [unarchiving, setUnarchiving] = useState<number | null>(null);

  useEffect(() => {
    api
      .getArchiveStatus()
      .then((s) => setConfigured(s.configured))
      .catch(() => setConfigured(false));
  }, []);

  const loadPage = useCallback(
    async (p: number, replace: boolean) => {
      if (!pinSession) return;
      setLoading(true);
      try {
        const data = await api.listArchivedPhotos(p * PAGE, PAGE);
        if (data.length < PAGE) setHasMore(false);
        setPhotos((prev) => (replace ? data : [...prev, ...data]));
      } catch (e) {
        setVerifyError(String(e));
        if (replace) setPhotos([]);
      } finally {
        setLoading(false);
      }
    },
    [pinSession]
  );

  useEffect(() => {
    if (!configured || !pinSession) {
      setLoading(false);
      return;
    }
    setPage(0);
    setHasMore(true);
    void loadPage(0, true);
  }, [configured, pinSession, loadPage]);

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setVerifyError(null);
    const p = pinInput.replace(/\D/g, "").slice(0, 8);
    if (p.length !== 7 && p.length !== 8) {
      setVerifyError("Introduce 7 u 8 dígitos (el mismo PIN que en ARCHIVE_PIN del servidor).");
      return;
    }
    try {
      await api.verifyArchivePin(p);
      setStoredArchivePin(p);
      setPinSession(p);
      setPinInput("");
    } catch (err) {
      setVerifyError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleLogoutPin = () => {
    setStoredArchivePin(null);
    setPinSession(null);
    setPhotos([]);
    setLightbox(null);
  };

  const handleUnarchive = async (fileId: number) => {
    if (!pinSession) return;
    setUnarchiving(fileId);
    setVerifyError(null);
    try {
      await api.unarchiveFiles([fileId]);
      setPhotos((prev) => prev.filter((f) => f.id !== fileId));
      setLightbox((lb) => (lb?.id === fileId ? null : lb));
    } catch (e) {
      setVerifyError(String(e));
    } finally {
      setUnarchiving(null);
    }
  };

  const loadMore = () => {
    const next = page + 1;
    setPage(next);
    void loadPage(next, false);
  };

  if (configured === null) {
    return (
      <div className="p-6">
        <Spinner message="Comprobando archivo…" />
      </div>
    );
  }

  if (!configured) {
    return (
      <div className="p-6 max-w-xl">
        <h1 className="text-2xl font-bold text-white mb-4">Archivo</h1>
        <p className="text-gray-400">
          El archivo no está activo en el servidor. Define{" "}
          <code className="text-amber-300">ARCHIVE_PIN</code> en <code className="text-gray-400">.env</code> (7 u 8
          dígitos numéricos) y reinicia la API.
        </p>
        <Link to="/gallery" className="inline-block mt-6 text-blue-400 hover:text-blue-300">
          ← Volver a la galería
        </Link>
      </div>
    );
  }

  if (!pinSession) {
    return (
      <div className="p-6 max-w-md">
        <h1 className="text-2xl font-bold text-white mb-2">Archivo protegido</h1>
        <p className="text-gray-400 text-sm mb-6">
          Introduce el mismo PIN que en el servidor (<code className="text-gray-300">ARCHIVE_PIN</code>, 7 u 8 dígitos).
        </p>
        <form onSubmit={handleVerify} className="space-y-4">
          <input
            type="password"
            inputMode="numeric"
            autoComplete="off"
            maxLength={8}
            value={pinInput}
            onChange={(e) => setPinInput(e.target.value.replace(/\D/g, "").slice(0, 8))}
            placeholder="••••••••"
            className="w-full px-4 py-3 rounded-lg bg-gray-900 border border-gray-700 text-white text-center text-xl tracking-widest"
          />
          {verifyError && <p className="text-red-400 text-sm">{verifyError}</p>}
          <button
            type="submit"
            className="w-full py-3 rounded-lg bg-amber-700 hover:bg-amber-600 text-white font-medium"
          >
            Entrar
          </button>
        </form>
        <Link to="/gallery" className="inline-block mt-8 text-gray-500 hover:text-gray-300 text-sm">
          ← Volver a la galería
        </Link>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Archivo</h1>
          <p className="text-gray-500 text-sm">Fotos ocultas en All Photos / vídeos / personas / álbumes.</p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleLogoutPin}
            className="px-4 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm"
          >
            Cerrar sesión de archivo
          </button>
          <Link to="/gallery" className="px-4 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm">
            Galería
          </Link>
        </div>
      </div>

      {verifyError && <p className="text-red-400 text-sm mb-4">{verifyError}</p>}

      {loading && photos.length === 0 ? (
        <Spinner message="Cargando archivo…" />
      ) : photos.length === 0 ? (
        <p className="text-gray-500">No hay elementos archivados.</p>
      ) : (
        <>
          <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10 gap-2">
            {photos.map((f) => (
              <div key={f.id} className="relative group">
                <PhotoCard file={f} onClick={() => setLightbox(f)} />
                <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 bg-black/60 rounded-lg transition-opacity pointer-events-none group-hover:pointer-events-auto">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      void handleUnarchive(f.id);
                    }}
                    disabled={unarchiving === f.id}
                    className="pointer-events-auto px-2 py-1 rounded text-xs bg-green-700 hover:bg-green-600 text-white disabled:opacity-50"
                  >
                    {unarchiving === f.id ? "…" : "Restaurar"}
                  </button>
                </div>
              </div>
            ))}
          </div>
          {hasMore && !loading && (
            <div className="text-center mt-8">
              <button
                type="button"
                onClick={loadMore}
                className="px-6 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300"
              >
                Cargar más
              </button>
            </div>
          )}
          {loading && photos.length > 0 && <p className="text-center text-gray-500 mt-4">Cargando…</p>}
        </>
      )}

      {lightbox && pinSession && (
        <div
          className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center p-4"
          onClick={() => setLightbox(null)}
        >
          <div className="max-w-5xl w-full relative" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className="absolute -top-2 -right-2 text-white text-2xl z-10"
              onClick={() => setLightbox(null)}
            >
              ✕
            </button>
            {lightbox.file_type === "photo" ? (
              <ArchiveLightboxImage fileId={lightbox.id} pin={pinSession} />
            ) : (
              <p className="text-gray-400">Vídeo: usa restaurar para volver a verlo en la galería.</p>
            )}
            <div className="mt-4 flex gap-2 justify-center">
              <button
                type="button"
                onClick={() => void handleUnarchive(lightbox.id)}
                disabled={unarchiving === lightbox.id}
                className="px-4 py-2 rounded-lg bg-green-700 hover:bg-green-600 text-white disabled:opacity-50"
              >
                Restaurar a la galería
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
