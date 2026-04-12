import { useCallback, useEffect, useMemo, useState } from "react";
import { api, API_BASE } from "../api";

const TTL_OPTIONS = [6, 12, 24, 48, 72, 168] as const;

/** Puertos por defecto (deben coincidir con ngrok_photos.yml y start.bat). */
const DEFAULT_WEB_PORT = "5892";
const DEFAULT_API_PORT = "8732";

/** Un solo agente ngrok (plan gratis); no uses dos ventanas `ngrok http` (ERR_NGROK_108). */
const NGROK_ONE_AGENT_CMD =
  "ngrok start --config ngrok_photos.yml photos_web photos_api";

interface Props {
  personIds: number[];
  onClose: () => void;
}

function tunnelPublicUrlForPort(
  tunnels: Array<{ public_url?: string; config?: { addr?: string } }> | undefined,
  port: string
): string | null {
  if (!port || !tunnels?.length) return null;
  const needle = `:${port}`;
  const pick = (prefix: string) => {
    for (const t of tunnels) {
      const addr = String(t.config?.addr ?? "");
      if (!addr.includes(needle) && !addr.endsWith(port)) continue;
      const u = t.public_url;
      if (typeof u === "string" && u.startsWith(prefix)) return u.replace(/\/$/, "");
    }
    return null;
  };
  return pick("https") || pick("http");
}

export default function ShareLinkModal({ personIds, onClose }: Props) {
  const [ttl, setTtl] = useState<number>(24);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [viewerUrl, setViewerUrl] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [ngrokTunnels, setNgrokTunnels] = useState<
    Array<{ public_url?: string; config?: { addr?: string } }>
  >([]);
  const [ngrokFetchErr, setNgrokFetchErr] = useState<string | null>(null);

  const webPort = typeof window !== "undefined" ? window.location.port || DEFAULT_WEB_PORT : DEFAULT_WEB_PORT;
  const apiPort = useMemo(() => {
    try {
      return new URL(API_BASE).port || DEFAULT_API_PORT;
    } catch {
      return DEFAULT_API_PORT;
    }
  }, []);

  const ngrokCommands = useMemo(() => NGROK_ONE_AGENT_CMD, []);

  const sharePath = useMemo(() => {
    if (!viewerUrl) return "";
    try {
      return new URL(viewerUrl).pathname || "";
    } catch {
      return "";
    }
  }, [viewerUrl]);

  const ngrokWebBase = tunnelPublicUrlForPort(ngrokTunnels, webPort);
  const ngrokApiBase = tunnelPublicUrlForPort(ngrokTunnels, apiPort);
  const ngrokShareUrl =
    ngrokWebBase && sharePath ? `${ngrokWebBase}${sharePath}` : null;

  const pollNgrok = useCallback(async () => {
    try {
      const data = await api.getNgrokTunnels();
      setNgrokTunnels(data.tunnels ?? []);
      setNgrokFetchErr(null);
    } catch (e) {
      setNgrokFetchErr(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    if (!viewerUrl) return;
    void pollNgrok();
    const id = window.setInterval(() => void pollNgrok(), 4000);
    return () => window.clearInterval(id);
  }, [viewerUrl, pollNgrok]);

  const generate = async () => {
    setBusy(true);
    setErr(null);
    try {
      const out = await api.createShareCollection(personIds, ttl);
      const path = `/share/${out.token}`;
      setViewerUrl(`${window.location.origin}${path}`);
      setExpiresAt(out.expires_at);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const copy = async (text: string, doneMsg = "Copiado al portapapeles.") => {
    try {
      await navigator.clipboard.writeText(text);
      alert(doneMsg);
    } catch {
      alert("No se pudo copiar; selecciona el texto manualmente.");
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/80 z-[60] flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-gray-900 rounded-xl p-6 max-w-lg w-full border border-gray-700 shadow-xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-white mb-2">Enlace para compartir</h2>
        <p className="text-sm text-gray-400 mb-4">
          Genera una URL secreta (caduca sola) para que otros vean solo las fotos de{" "}
          {personIds.length === 1 ? "esta persona" : `estas ${personIds.length} personas`} en modo lectura.
          No sube nada a internet: solo funciona si tu servidor es accesible (red local, ngrok, etc.).
        </p>

        <label className="block text-sm text-gray-300 mb-2">
          Caducidad
          <select
            value={ttl}
            onChange={(e) => setTtl(Number(e.target.value))}
            className="mt-1 w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-white"
          >
            {TTL_OPTIONS.map((h) => (
              <option key={h} value={h}>
                {h === 168 ? "7 días" : `${h} horas`}
              </option>
            ))}
          </select>
        </label>

        {!viewerUrl ? (
          <div className="flex gap-2 justify-end mt-4">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-white text-sm"
            >
              Cancelar
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={generate}
              className="px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white text-sm font-medium"
            >
              {busy ? "Generando…" : "Generar enlace"}
            </button>
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            <div>
              <p className="text-xs text-gray-500 mb-1">Enlace local (solo tu PC / misma red)</p>
              <input
                readOnly
                value={viewerUrl}
                className="w-full text-sm bg-gray-950 border border-gray-600 rounded-lg px-3 py-2 text-amber-100/95 break-all"
              />
            </div>

            <div className="rounded-lg border border-amber-900/50 bg-amber-950/15 p-3 space-y-1.5 mb-1">
              <p className="text-xs font-semibold text-amber-200/95">Cuenta ngrok (obligatorio)</p>
              <p className="text-xs text-gray-500">
                Sin token: <code className="text-gray-400">ERR_NGROK_4018</code>. Dos ventanas ngrok en plan gratis:{" "}
                <code className="text-gray-400">ERR_NGROK_108</code> — usá solo{" "}
                <code className="text-gray-400">start_ngrok_share.bat</code> o el comando de abajo. Configurá token con{" "}
                <code className="text-gray-400">ngrok_add_authtoken.bat</code> o{" "}
                <code className="text-gray-400">ngrok config add-authtoken TU_TOKEN</code> (token en{" "}
                <a
                  href="https://dashboard.ngrok.com/get-started/your-authtoken"
                  className="text-sky-500 hover:underline"
                  target="_blank"
                  rel="noreferrer"
                >
                  dashboard.ngrok.com
                </a>
                ).
              </p>
            </div>

            <div className="rounded-lg border border-emerald-900/60 bg-emerald-950/20 p-3 space-y-2">
              <p className="text-xs font-semibold text-emerald-200/95">Enlace público con ngrok</p>
              {ngrokShareUrl ? (
                <>
                  <p className="text-xs text-gray-500">Detectado ngrok (API local :4040). Envía este enlace:</p>
                  <input
                    readOnly
                    value={ngrokShareUrl}
                    className="w-full text-sm bg-gray-950 border border-emerald-800/50 rounded-lg px-3 py-2 text-emerald-100 break-all"
                  />
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void copy(ngrokShareUrl, "Enlace ngrok copiado.")}
                      className="px-3 py-1.5 rounded-lg bg-emerald-800 hover:bg-emerald-700 text-white text-xs font-medium"
                    >
                      Copiar enlace ngrok
                    </button>
                  </div>
                </>
              ) : (
                <p className="text-xs text-gray-500">
                  Aún no hay túnel al puerto <strong className="text-gray-400">{webPort}</strong>. En la carpeta del
                  proyecto ejecutá <code className="text-gray-400">start_ngrok_share.bat</code> (una sola ventana, dos
                  URLs) o el comando de abajo desde esa carpeta. Se actualiza solo cada pocos segundos.
                </p>
              )}
              {ngrokApiBase && (
                <p className="text-xs text-gray-500">
                  Túnel API detectado: <code className="text-gray-400 break-all">{ngrokApiBase}</code>. Para{" "}
                  <strong className="text-gray-400">solo el enlace compartido</strong> no hace falta: Vite reenvía{" "}
                  <code className="text-gray-400">/api</code> al API local. Usá{" "}
                  <code className="text-gray-400">VITE_API_URL</code> con URL ngrok del API solo si querés usar toda la
                  app (galería, etc.) desde fuera.
                </p>
              )}
              {ngrokFetchErr && (
                <p className="text-xs text-amber-600/90">No se pudo consultar ngrok: {ngrokFetchErr}</p>
              )}
            </div>

            {expiresAt && <p className="text-xs text-gray-500">Caduca (aprox.): {expiresAt}</p>}

            <div className="rounded-lg border border-gray-700 bg-gray-950/50 p-3 space-y-2">
              <p className="text-xs font-medium text-gray-300">Ngrok plan gratis (1 agente)</p>
              <p className="text-xs text-gray-500">
                Dos procesos <code className="text-gray-400">ngrok http</code> dan ERR_NGROK_108. Usá{" "}
                <code className="text-gray-400">ngrok_photos.yml</code> + un solo comando.
              </p>
              <pre className="text-xs text-gray-400 whitespace-pre-wrap break-all font-mono bg-black/40 rounded p-2 border border-gray-800">
                {ngrokCommands}
              </pre>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() =>
                    void copy(ngrokCommands, "Comando copiado. Ejecutalo en la raíz del proyecto (donde está el .yml).")
                  }
                  className="px-3 py-1.5 rounded-lg bg-gray-700 hover:bg-gray-600 text-white text-xs"
                >
                  Copiar comando
                </button>
                <p className="text-xs text-gray-500 self-center">
                  O doble clic: <code className="text-gray-400">start_ngrok_share.bat</code> (una ventana).
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void copy(viewerUrl)}
                className="px-4 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-white text-sm"
              >
                Copiar enlace local
              </button>
              <a
                href={viewerUrl}
                target="_blank"
                rel="noreferrer"
                className="px-4 py-2 rounded-lg bg-sky-700 hover:bg-sky-600 text-white text-sm inline-flex items-center"
              >
                Abrir vista previa
              </a>
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm"
              >
                Cerrar
              </button>
            </div>

            <details className="text-xs text-gray-500 pt-2 border-t border-gray-800">
              <summary className="cursor-pointer text-gray-400">CORS y acceso completo desde fuera</summary>
              <ol className="list-decimal list-inside mt-2 space-y-1 text-gray-500">
                <li>
                  <strong>Vista compartida (/share/…):</strong> con el túnel ngrok al <strong>front</strong> (Vite) basta;
                  las peticiones van a la misma URL pública y el dev server hace proxy de <code className="text-gray-400">/api</code>{" "}
                  al puerto local del API.
                </li>
                <li>
                  <strong>Toda la app por ngrok:</strong> añadí la URL pública del front a{" "}
                  <code className="text-gray-400">CORS_EXTRA_ORIGINS</code> en el <code className="text-gray-400">.env</code> del
                  API, y en <code className="text-gray-400">frontend/.env</code> poné{" "}
                  <code className="text-gray-400">VITE_API_URL</code> con la URL pública del API; reiniciá API y Vite.
                </li>
                <li>
                  Cuenta ngrok autenticada si hace falta:{" "}
                  <code className="text-gray-400">ngrok config add-authtoken</code>.
                </li>
              </ol>
            </details>
          </div>
        )}

        {err && <p className="text-sm text-red-400 mt-3">{err}</p>}
      </div>
    </div>
  );
}
