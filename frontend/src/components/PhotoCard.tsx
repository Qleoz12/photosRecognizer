import { useState } from "react";
import { FileOut, api } from "../api";

interface Props {
  file: FileOut;
  onClick?: () => void;
  highlight?: boolean;
  selectable?: boolean;
  selected?: boolean;
  onSelect?: (e: React.MouseEvent) => void;
}

function formatDuration(sec: number | null): string | null {
  if (sec == null || !Number.isFinite(sec)) return null;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function PhotoCard({ file, onClick, highlight, selectable, selected, onSelect }: Props) {
  const [thumbError, setThumbError] = useState(false);
  const thumb = api.thumbnailUrl(file.thumbnail_path);
  const isVideo = file.file_type === "video";
  const date = file.exif_date
    ? new Date(file.exif_date).toLocaleDateString()
    : null;
  const durationStr = isVideo ? formatDuration(file.duration ?? null) : null;

  // Determine if portrait (taller than wide) to use appropriate aspect ratio
  const isPortrait = file.height && file.width ? file.height > file.width : false;
  const aspectClass = isPortrait ? "aspect-[3/4]" : "aspect-[4/3]";

  return (
    <div
      onMouseDown={
        selectable && onSelect
          ? (e: React.MouseEvent) => {
              if (e.button !== 0) return;
              if (e.shiftKey) e.preventDefault();
              onSelect(e);
            }
          : undefined
      }
      onClick={
        selectable && onSelect ? undefined : onClick
      }
      className={`group cursor-pointer rounded-lg overflow-hidden bg-gray-900 border transition-all ${
        selectable ? "select-none" : ""
      } ${
        selected ? "border-blue-500 ring-2 ring-blue-400" :
        highlight ? "border-blue-500 ring-2 ring-blue-400" : "border-gray-800 hover:border-gray-600"
      }`}
    >
      <div className={`${aspectClass} overflow-hidden bg-gray-800 relative`}>
        {thumb && !thumbError ? (
          <img
            src={thumb}
            alt={file.path}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform"
            loading="lazy"
            onError={() => setThumbError(true)}
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center bg-gray-800 border border-amber-900/50 text-amber-600/90 p-2">
            <span className="text-2xl" title="Error al cargar miniatura">{isVideo ? "🎥" : "🖼️"}</span>
            <span className="text-[10px] mt-0.5 text-amber-700/80">Error</span>
            <span className="text-[10px] truncate max-w-full opacity-75">{file.path.split(/[/\\]/).pop()}</span>
          </div>
        )}
        {/* Selection checkbox */}
        {selectable && (
          <div
            className={`absolute top-2 left-2 w-6 h-6 rounded border-2 flex items-center justify-center ${
              selected ? "bg-blue-600 border-blue-500" : "bg-black/50 border-gray-500"
            }`}
          >
            {selected && <span className="text-white text-sm">✓</span>}
          </div>
        )}
        {/* Video play badge */}
        {isVideo && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="bg-black/60 rounded-full p-2 group-hover:bg-black/80 transition-colors">
              <svg className="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
            </div>
          </div>
        )}
        {/* Video duration badge */}
        {durationStr && (
          <div className="absolute bottom-1 right-1 bg-black/70 text-white text-xs px-1.5 py-0.5 rounded">
            {durationStr}
          </div>
        )}
      </div>
      {date && (
        <p className="text-xs text-gray-500 px-2 py-1 truncate">{date}</p>
      )}
    </div>
  );
}
