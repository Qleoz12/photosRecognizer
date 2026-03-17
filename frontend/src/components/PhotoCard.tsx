import { FileOut, api } from "../api";

interface Props {
  file: FileOut;
  onClick?: () => void;
  highlight?: boolean;
}

export default function PhotoCard({ file, onClick, highlight }: Props) {
  const thumb = api.thumbnailUrl(file.thumbnail_path);
  const isVideo = file.file_type === "video";
  const date = file.exif_date
    ? new Date(file.exif_date).toLocaleDateString()
    : null;

  // Determine if portrait (taller than wide) to use appropriate aspect ratio
  const isPortrait = file.height && file.width ? file.height > file.width : false;
  const aspectClass = isPortrait ? "aspect-[3/4]" : "aspect-[4/3]";

  return (
    <div
      onClick={onClick}
      className={`group cursor-pointer rounded-lg overflow-hidden bg-gray-900 border transition-all ${
        highlight
          ? "border-blue-500 ring-2 ring-blue-400"
          : "border-gray-800 hover:border-gray-600"
      }`}
    >
      <div className={`${aspectClass} overflow-hidden bg-gray-800 relative`}>
        {thumb ? (
          <img
            src={thumb}
            alt={file.path}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-4xl text-gray-600">
            {isVideo ? "🎥" : "🖼️"}
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
      </div>
      {date && (
        <p className="text-xs text-gray-500 px-2 py-1 truncate">{date}</p>
      )}
    </div>
  );
}
