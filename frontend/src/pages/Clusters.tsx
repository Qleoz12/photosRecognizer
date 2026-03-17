import { useEffect, useState } from "react";
import { api, ClusterOut } from "../api";
import PersonCard from "../components/PersonCard";
import Spinner from "../components/Spinner";

export default function Clusters() {
  const [people, setPeople] = useState<ClusterOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<number[]>([]);
  const [merging, setMerging] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);

  const load = () => {
    setLoading(true);
    api.getPeople(0, 500).then(setPeople).finally(() => setLoading(false));
  };

  useEffect(load, []);

  const toggleSelect = (id: number) => {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const handleMerge = async () => {
    if (selected.length < 2) return;
    setMerging(true);
    setMessage(null);
    try {
      // Merge all selected into the first one selected (keep it as target)
      const [target, ...sources] = selected;
      for (const src of sources) {
        await api.mergePeople(src, target);
      }
      setMessage({ text: `${sources.length + 1} grupos fusionados en Person #${target}.`, ok: true });
      setSelected([]);
      load();
    } catch (e: unknown) {
      setMessage({ text: `Error: ${(e as Error).message}`, ok: false });
    } finally {
      setMerging(false);
    }
  };

  if (loading) return <Spinner message="Loading clusters..." />;

  const selectedPeople = people.filter((p) => selected.includes(p.id));

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">Fusionar personas</h1>
        <button
          onClick={handleMerge}
          disabled={selected.length < 2 || merging}
          className="px-5 py-2 text-sm rounded-lg bg-purple-600 hover:bg-purple-500 disabled:opacity-40 transition-colors font-medium"
        >
          {merging ? "Fusionando..." : `Fusionar ${selected.length > 0 ? `(${selected.length})` : ""}`}
        </button>
      </div>

      <p className="text-sm text-gray-400 mb-4">
        Selecciona 2 o más personas que son la misma. Todos se fusionarán en el primero que seleccionaste.
      </p>

      {/* Selected preview bar */}
      {selected.length > 0 && (
        <div className="mb-6 p-4 bg-gray-900 border border-purple-700 rounded-xl flex items-center gap-4 flex-wrap">
          <span className="text-sm text-purple-300 font-medium shrink-0">Seleccionados:</span>
          <div className="flex gap-3 flex-wrap flex-1">
            {selectedPeople.map((p, i) => (
              <div key={p.id} className="flex items-center gap-2 bg-gray-800 rounded-full pl-1 pr-3 py-1">
                <div className="w-7 h-7 rounded-full overflow-hidden bg-gray-700 shrink-0">
                  {api.thumbnailUrl(p.cover_thumbnail) ? (
                    <img src={api.thumbnailUrl(p.cover_thumbnail)!} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-xs">👤</div>
                  )}
                </div>
                <span className="text-xs text-gray-200">{p.label ?? `#${p.id}`}</span>
                {i === 0 && (
                  <span className="text-xs text-purple-400 ml-1">(destino)</span>
                )}
                <button
                  onClick={() => toggleSelect(p.id)}
                  className="text-gray-500 hover:text-white ml-1 text-xs"
                >✕</button>
              </div>
            ))}
          </div>
          <button
            onClick={() => setSelected([])}
            className="text-xs text-gray-500 hover:text-white shrink-0"
          >
            Limpiar
          </button>
        </div>
      )}

      {message && (
        <div className={`mb-5 px-4 py-3 rounded-lg text-sm border ${
          message.ok
            ? "bg-green-900/30 border-green-700 text-green-300"
            : "bg-red-900/30 border-red-700 text-red-300"
        }`}>
          {message.text}
        </div>
      )}

      <div className="grid grid-cols-3 sm:grid-cols-5 md:grid-cols-7 lg:grid-cols-10 gap-4">
        {people.map((p) => {
          const isSelected = selected.includes(p.id);
          const selIndex = selected.indexOf(p.id);
          return (
            <div key={p.id} className="relative" onClick={() => toggleSelect(p.id)}>
              {/* Selection badge */}
              <div className={`absolute top-1 right-1 z-10 w-6 h-6 rounded-full border-2 flex items-center justify-center text-xs font-bold transition-colors ${
                isSelected
                  ? "bg-purple-500 border-purple-300 text-white"
                  : "bg-gray-900/80 border-gray-600"
              }`}>
                {isSelected ? selIndex + 1 : ""}
              </div>
              <div className={`rounded-xl transition-all ${
                isSelected ? "ring-2 ring-purple-500 ring-offset-2 ring-offset-gray-950" : ""
              }`}>
                <PersonCard cluster={p} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
