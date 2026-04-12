import type { MouseEvent } from "react";
import { api, ClusterOut } from "../api";

interface Props {
  cluster: ClusterOut;
  onClick?: () => void;
  selectable?: boolean;
  selected?: boolean;
  /** 0–1 similarity score; shown as percentage when present */
  similarity?: number;
  /** Ocultar del listado principal (icono en la tarjeta) */
  onHide?: (e: MouseEvent) => void;
  /** Volver a mostrar (sección personas ocultas) */
  onRestore?: (e: MouseEvent) => void;
}

export default function PersonCard({
  cluster,
  onClick,
  selectable,
  selected,
  similarity,
  onHide,
  onRestore,
}: Props) {
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
        {onHide && !selectable && (
          <button
            type="button"
            title="Ocultar del listado"
            className="absolute top-0 right-0 z-10 rounded-bl-md bg-gray-950/85 p-1 text-gray-400 hover:text-amber-200 opacity-80 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity"
            onClick={(e) => {
              e.stopPropagation();
              onHide(e);
            }}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"
              />
            </svg>
          </button>
        )}
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
            onError={(e) => {
              const t = e.target as HTMLImageElement;
              const fallback = api.thumbnailUrl(cluster.cover_thumbnail);
              if (fallback) t.src = fallback;
              else t.style.display = "none";
            }}
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
      {onRestore && (
        <button
          type="button"
          className="text-xs text-sky-400 hover:text-sky-300 font-medium"
          onClick={(e) => {
            e.stopPropagation();
            onRestore(e);
          }}
        >
          Restaurar en listado
        </button>
      )}
    </div>
  );
}
