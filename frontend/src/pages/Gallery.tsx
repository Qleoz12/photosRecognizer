import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, ClusterOut, Stats } from "../api";
import PersonCard from "../components/PersonCard";
import Spinner from "../components/Spinner";

export default function Gallery() {
  const [people, setPeople] = useState<ClusterOut[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [reclustering, setReclustering] = useState(false);

  // Merge mode
  const [mergeMode, setMergeMode] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [merging, setMerging] = useState(false);
  const [creating, setCreating] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [newLabel, setNewLabel] = useState("");

  const navigate = useNavigate();

  const reload = () => {
    setLoading(true);
    Promise.all([api.getPeople(), api.getStats()])
      .then(([p, s]) => { setPeople(p); setStats(s); })
      .finally(() => setLoading(false));
  };

  useEffect(() => { reload(); }, []);

  const handleRecluster = async () => {
    setReclustering(true);
    try {
      await api.triggerRecluster();
      alert("Re-clustering iniciado. Recarga en unos segundos.");
    } finally {
      setReclustering(false);
    }
  };

  const toggleSelect = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleMerge = async () => {
    if (selected.size < 2) return;
    const [target, ...sources] = Array.from(selected);
    setMerging(true);
    try {
      let currentTarget = target;
      for (const src of sources) {
        const merged = await api.mergePeople(src, currentTarget);
        currentTarget = merged.id;
      }
      setMergeMode(false);
      setSelected(new Set());
      reload();
    } catch (e) {
      alert("Error al unir personas: " + e);
    } finally {
      setMerging(false);
    }
  };

  const cancelMerge = () => {
    setMergeMode(false);
    setSelected(new Set());
  };

  const handleCreatePerson = async () => {
    setCreating(true);
    try {
      const created = await api.createPerson(newLabel.trim() || undefined);
      setNewLabel("");
      setShowCreate(false);
      reload();
      navigate(`/person/${created.id}`);
    } catch (e) {
      alert("Error: " + e);
    } finally {
      setCreating(false);
    }
  };

  if (loading) return <Spinner message="Cargando personas..." />;

  return (
    <div className="p-6">
      {/* Stats bar */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-8">
          {[
            { label: "Archivos", value: stats.total_files },
            { label: "Fotos", value: stats.total_photos },
            { label: "Videos", value: stats.total_videos },
            { label: "Caras detectadas", value: stats.total_faces },
            { label: "Sin asignar", value: stats.unassigned_faces },
          ].map(({ label, value }) => (
            <div key={label} className="bg-gray-900 rounded-xl p-4 border border-gray-800">
              <p className="text-2xl font-bold text-white">{value.toLocaleString()}</p>
              <p className="text-xs text-gray-400 mt-1">{label}</p>
            </div>
          ))}
        </div>
      )}

      {/* Toolbar */}
      <div className="flex items-center justify-between mb-6 gap-3 flex-wrap">
        <h1 className="text-2xl font-bold text-white">
          Personas <span className="text-gray-500 text-lg">({people.length})</span>
        </h1>

        <div className="flex gap-2 flex-wrap">
          {!mergeMode ? (
            <>
              <button
                onClick={() => setShowCreate(true)}
                className="text-sm px-4 py-2 rounded-lg bg-green-700 hover:bg-green-600 transition-colors"
              >
                Crear persona
              </button>
              <button
                onClick={() => setMergeMode(true)}
                className="text-sm px-4 py-2 rounded-lg bg-purple-700 hover:bg-purple-600 transition-colors"
              >
                Unir personas
              </button>
              <button
                onClick={handleRecluster}
                disabled={reclustering}
                className="text-sm px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 transition-colors"
              >
                {reclustering ? "Iniciando..." : "Re-agrupar caras"}
              </button>
            </>
          ) : (
            <>
              <span className="text-sm text-gray-400 self-center">
                {selected.size === 0
                  ? "Selecciona 2 o más personas para unir"
                  : `${selected.size} seleccionada${selected.size > 1 ? "s" : ""}`}
              </span>
              <button
                onClick={handleMerge}
                disabled={selected.size < 2 || merging}
                className="text-sm px-4 py-2 rounded-lg bg-green-600 hover:bg-green-500 disabled:opacity-40 transition-colors"
              >
                {merging ? "Uniendo..." : `Unir ${selected.size}`}
              </button>
              <button
                onClick={cancelMerge}
                className="text-sm px-4 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 transition-colors"
              >
                Cancelar
              </button>
            </>
          )}
        </div>
      </div>

      {/* Modal Crear persona */}
      {showCreate && (
        <div
          className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4"
          onClick={() => setShowCreate(false)}
        >
          <div
            className="bg-gray-900 rounded-xl p-6 max-w-md w-full border border-gray-700"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-semibold text-white mb-3">Crear persona</h2>
            <p className="text-sm text-gray-400 mb-4">
              Crea una persona vacía (ej. Perro, Tema). Luego en All Photos podrás asignar fotos con &quot;Cotejar contra rostros&quot;.
            </p>
            <input
              type="text"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              placeholder="Nombre (opcional)"
              className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-white mb-4"
              onKeyDown={(e) => e.key === "Enter" && handleCreatePerson()}
            />
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setShowCreate(false)}
                className="px-4 py-2 rounded-lg bg-gray-700 hover:bg-gray-600"
              >
                Cancelar
              </button>
              <button
                onClick={handleCreatePerson}
                disabled={creating}
                className="px-4 py-2 rounded-lg bg-green-600 hover:bg-green-500 disabled:opacity-50"
              >
                {creating ? "Creando..." : "Crear"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Merge hint banner */}
      {mergeMode && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-purple-900/40 border border-purple-700 text-sm text-purple-200">
          Haz clic en las personas que son la misma para seleccionarlas, luego pulsa <strong>Unir</strong>.
          La primera seleccionada será la persona principal.
        </div>
      )}

      {people.length === 0 ? (
        <div className="text-center py-24 text-gray-500">
          <p className="text-4xl mb-4">😶</p>
          <p className="text-lg">No se encontraron personas.</p>
          <p className="text-sm mt-2">Ejecuta el indexer y el clustering primero.</p>
        </div>
      ) : (
        <div className="grid grid-cols-3 sm:grid-cols-5 md:grid-cols-7 lg:grid-cols-10 gap-4">
          {people.map((p) => (
            <PersonCard
              key={p.id}
              cluster={p}
              selectable={mergeMode}
              selected={selected.has(p.id)}
              onClick={() => {
                if (mergeMode) {
                  toggleSelect(p.id);
                } else {
                  navigate(`/person/${p.id}`);
                }
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
