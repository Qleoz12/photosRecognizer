/**
 * Overlay on an image to select a face region (rectangle).
 * Emits normalized bbox [x1,y1,x2,y2] 0-1 on complete.
 */
import { useRef, useState, useCallback, useEffect } from "react";

interface Props {
  imageUrl: string;
  onComplete: (bbox: [number, number, number, number]) => void;
  onCancel: () => void;
  searching?: boolean;
}

const MIN_SEL = 15; // px mínimo para habilitar Buscar

export default function FaceCropSelector({ imageUrl, onComplete, onCancel, searching }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [start, setStart] = useState<{ x: number; y: number } | null>(null);
  const [current, setCurrent] = useState<{ x: number; y: number } | null>(null);
  const [imgLoaded, setImgLoaded] = useState(false);
  const isDraggingRef = useRef(false);

  // Capturar mouseup global para que el release fuera del área no cierre nada
  useEffect(() => {
    const handleGlobalMouseUp = () => {
      if (isDraggingRef.current && start && current) {
        const w = Math.abs(current.x - start.x);
        const h = Math.abs(current.y - start.y);
        if (w < MIN_SEL && h < MIN_SEL) {
          setStart(null);
          setCurrent(null);
        }
        isDraggingRef.current = false;
      }
    };
    document.addEventListener("mouseup", handleGlobalMouseUp);
    return () => document.removeEventListener("mouseup", handleGlobalMouseUp);
  }, [start, current]);

  const getNormBbox = useCallback(() => {
    const img = imgRef.current;
    const container = containerRef.current;
    if (!img || !container || !start || !current) return null;
    const natW = img.naturalWidth;
    const natH = img.naturalHeight;
    if (natW < 10 || natH < 10) return null;

    const rect = container.getBoundingClientRect();
    const aspect = natW / natH;
    const boxAspect = rect.width / rect.height;

    let drawW: number, drawH: number, offX: number, offY: number;
    if (aspect > boxAspect) {
      drawW = rect.width;
      drawH = rect.width / aspect;
      offX = 0;
      offY = (rect.height - drawH) / 2;
    } else {
      drawH = rect.height;
      drawW = rect.height * aspect;
      offX = (rect.width - drawW) / 2;
      offY = 0;
    }

    const x1 = Math.max(0, Math.min(start.x, current.x) - offX) / drawW;
    const x2 = Math.min(drawW, Math.max(start.x, current.x) - offX) / drawW;
    const y1 = Math.max(0, Math.min(start.y, current.y) - offY) / drawH;
    const y2 = Math.min(drawH, Math.max(start.y, current.y) - offY) / drawH;

    return [
      Math.max(0, Math.min(x1, x2)),
      Math.max(0, Math.min(y1, y2)),
      Math.min(1, Math.max(x1, x2)),
      Math.min(1, Math.max(y1, y2)),
    ] as [number, number, number, number];
  }, [start, current]);

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    isDraggingRef.current = true;
    setStart({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    setCurrent({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!start) return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setCurrent({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  };

  const handleMouseUp = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (start && current) {
      const w = Math.abs(current.x - start.x);
      const h = Math.abs(current.y - start.y);
      if (w < MIN_SEL && h < MIN_SEL) {
        setStart(null);
        setCurrent(null);
      }
      isDraggingRef.current = false;
    }
  };

  const handleConfirm = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const bbox = getNormBbox();
    if (bbox) onComplete(bbox);
  };

  let selRect: { left: number; top: number; width: number; height: number } | null = null;
  if (start && current) {
    const left = Math.min(start.x, current.x);
    const top = Math.min(start.y, current.y);
    selRect = {
      left,
      top,
      width: Math.abs(current.x - start.x),
      height: Math.abs(current.y - start.y),
    };
  }

  const canSearch = imgLoaded && selRect && selRect.width >= MIN_SEL && selRect.height >= MIN_SEL && !searching;

  return (
    <div className="flex flex-col gap-3">
      <div
        ref={containerRef}
        className="relative cursor-crosshair select-none max-w-full max-h-[70vh] flex items-center justify-center bg-black/50 rounded-lg"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={() => {}}
      >
        <img
          ref={imgRef}
          src={imageUrl}
          alt=""
          className="max-w-full max-h-[70vh] object-contain pointer-events-none"
          draggable={false}
          onLoad={() => setImgLoaded(true)}
        />
        {!imgLoaded && (
          <div className="absolute text-gray-500">Cargando imagen...</div>
        )}
        {selRect && selRect.width > 5 && selRect.height > 5 && (
          <div
            className="absolute border-2 border-amber-400 bg-amber-400/20 pointer-events-none"
            style={{
              left: selRect.left,
              top: selRect.top,
              width: selRect.width,
              height: selRect.height,
            }}
          />
        )}
      </div>
      <p className="text-sm text-gray-400 text-center">
        Arrastra para seleccionar el área (puede incluir varios rostros). Luego Buscar o Cancelar.
      </p>
      <div className="flex gap-2 justify-center">
        <button
          type="button"
          onClick={handleConfirm}
          disabled={!canSearch}
          className="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {searching ? "Buscando..." : "Buscar persona"}
        </button>
        <button type="button" onClick={onCancel} className="px-4 py-2 rounded-lg bg-gray-700 hover:bg-gray-600">
          Cancelar
        </button>
      </div>
    </div>
  );
}
