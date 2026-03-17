import { api, ClusterOut } from "../api";

interface Props {
  cluster: ClusterOut;
  onClick?: () => void;
  selectable?: boolean;
  selected?: boolean;
  /** 0–1 similarity score; shown as percentage when present */
  similarity?: number;
}

export default function PersonCard({ cluster, onClick, selectable, selected, similarity }: Props) {
  const thumb = api.thumbnailUrl(cluster.cover_thumbnail);
  const label = cluster.label ?? `Persona #${cluster.id}`;

  return (
    <div
      onClick={onClick}
      className={`cursor-pointer group flex flex-col items-center gap-2 p-3 rounded-xl transition-all border
        ${selected
          ? "bg-purple-900/60 border-purple-400 ring-2 ring-purple-400"
          : selectable
            ? "bg-gray-900 border-gray-700 hover:border-purple-500 hover:bg-purple-900/20"
            : "bg-gray-900 border-gray-800 hover:bg-gray-800 hover:border-blue-500"
        }`}
    >
      <div className="relative w-20 h-20 rounded-full overflow-hidden bg-gray-700 flex-shrink-0">
        {thumb ? (
          <img
            src={thumb}
            alt={label}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform"
            loading="lazy"
            onError={(e) => {
              const t = e.target as HTMLImageElement;
              if (cluster.cover_face_id) t.src = api.faceCropByIdUrl(cluster.cover_face_id);
              else t.style.display = "none";
            }}
          />
        ) : cluster.cover_face_id ? (
          <img
            src={api.faceCropByIdUrl(cluster.cover_face_id)}
            alt={label}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform"
            loading="lazy"
          />
        ) : null}
        {!cluster.cover_face_id && !thumb && (
          <div className="w-full h-full flex items-center justify-center text-3xl text-gray-500">
            👤
          </div>
        )}
        {selected && (
          <div className="absolute inset-0 flex items-center justify-center bg-purple-900/70 rounded-full">
            <svg className="w-8 h-8 text-white" fill="currentColor" viewBox="0 0 24 24">
              <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
            </svg>
          </div>
        )}
      </div>
      <p className="text-sm font-medium text-center truncate w-full text-gray-200">{label}</p>
      <span className="text-xs text-gray-500">{cluster.size} fotos</span>
      {similarity != null && (
        <span className="text-xs text-amber-400 font-medium">
          {Math.round(similarity * 100)}% parecido
        </span>
      )}
      {cluster.is_manual && (
        <span className="text-xs text-purple-400 font-medium">✓ confirmada</span>
      )}
    </div>
  );
}
