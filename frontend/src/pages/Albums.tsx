import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, AlbumOut } from "../api";
import Spinner from "../components/Spinner";

export default function Albums() {
  const [albums, setAlbums] = useState<AlbumOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();

  const reload = () => {
    setLoading(true);
    api.getAlbums().then(setAlbums).finally(() => setLoading(false));
  };

  useEffect(() => { reload(); }, []);

  const handleCreate = async () => {
    setCreating(true);
    try {
      const a = await api.createAlbum(newLabel.trim() || "Sin nombre");
      setNewLabel("");
      setShowCreate(false);
      reload();
      navigate(`/albums/${a.id}`);
    } catch (e) {
      alert("Error: " + e);
    } finally {
      setCreating(false);
    }
  };

  if (loading) return <Spinner message="Cargando álbumes..." />;

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-white">
          Álbumes <span className="text-gray-500 text-lg">({albums.length})</span>
        </h1>
        <button
          onClick={() => setShowCreate(true)}
          className="px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 text-white font-medium"
        >
          Crear álbum
        </button>
      </div>

      {showCreate && (
        <div
          className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4"
          onClick={() => setShowCreate(false)}
        >
          <div
            className="bg-gray-900 rounded-xl p-6 max-w-md w-full border border-gray-700"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-semibold text-white mb-3">Crear álbum</h2>
            <p className="text-sm text-gray-400 mb-4">
              Álbumes para cosas específicas. Tras 10 fotos, usa &quot;Encontrar similares&quot; en All Photos para que el álbum crezca automáticamente.
            </p>
            <input
              type="text"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              placeholder="Nombre del álbum"
              className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-white mb-4"
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            />
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowCreate(false)} className="px-4 py-2 rounded-lg bg-gray-700 hover:bg-gray-600">
                Cancelar
              </button>
              <button
                onClick={handleCreate}
                disabled={creating}
                className="px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 disabled:opacity-50"
              >
                {creating ? "Creando..." : "Crear"}
              </button>
            </div>
          </div>
        </div>
      )}

      {albums.length === 0 ? (
        <div className="text-center py-24 text-gray-500">
          <p className="text-4xl mb-4">📂</p>
          <p className="text-lg">No hay álbumes.</p>
          <p className="text-sm mt-2">Crea uno y añade fotos desde All Photos.</p>
        </div>
      ) : (
        <div className="grid grid-cols-3 sm:grid-cols-5 md:grid-cols-7 lg:grid-cols-10 gap-4">
          {albums.map((a) => (
            <div
              key={a.id}
              onClick={() => navigate(`/albums/${a.id}`)}
              className="cursor-pointer rounded-xl overflow-hidden bg-gray-900 border border-gray-800 hover:border-gray-600 transition-colors"
            >
              <div className="aspect-square overflow-hidden bg-gray-800">
                {a.cover_thumbnail ? (
                  <img
                    src={api.thumbnailUrl(a.cover_thumbnail)!}
                    alt=""
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-4xl text-gray-600">📂</div>
                )}
              </div>
              <div className="p-2">
                <p className="text-sm font-medium text-white truncate">{a.label}</p>
                <p className="text-xs text-gray-500">{a.file_count} fotos</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
