import { useEffect } from "react";

type MenuKind = "memory" | "person" | "album";

interface Item {
  id: number;
  label: string;
}

interface Props {
  kind: MenuKind;
  open: boolean;
  onClose: () => void;
  /** Contenedor que incluye el botón + panel (clic fuera cierra) */
  containerRef: React.RefObject<HTMLElement | null>;
  disabled: boolean;
  /** Sin selección en la galería */
  noSelection: boolean;
  items: Item[];
  pickId: string;
  onPickIdChange: (v: string) => void;
  newLabel: string;
  onNewLabelChange: (v: string) => void;
  onAssignExisting: () => void;
  onCreateAndAssign: () => void;
  loading: boolean;
}

const labels: Record<MenuKind, { title: string; assign: string; create: string; placeholder: string; accent: string }> = {
  memory: {
    title: "Recuerdo",
    assign: "Asignar a recuerdo",
    create: "Crear recuerdo y asignar",
    placeholder: "Nombre del nuevo recuerdo",
    accent: "bg-green-600 hover:bg-green-500",
  },
  person: {
    title: "Persona",
    assign: "Asignar a persona",
    create: "Crear persona y asignar",
    placeholder: "Nombre de la nueva persona",
    accent: "bg-blue-600 hover:bg-blue-500",
  },
  album: {
    title: "Álbum",
    assign: "Asignar a álbum",
    create: "Crear álbum y asignar",
    placeholder: "Nombre del nuevo álbum",
    accent: "bg-purple-600 hover:bg-purple-500",
  },
};

export default function AssignDropdown({
  kind,
  open,
  onClose,
  containerRef,
  disabled,
  noSelection,
  items,
  pickId,
  onPickIdChange,
  newLabel,
  onNewLabelChange,
  onAssignExisting,
  onCreateAndAssign,
  loading,
}: Props) {
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const el = containerRef.current;
      if (el && !el.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open, onClose, containerRef]);

  if (!open) return null;

  const L = labels[kind];
  const canAssign = !noSelection && pickId !== "" && !loading;
  const canCreate = !noSelection && newLabel.trim().length > 0 && !loading;

  return (
    <div
      className="absolute right-0 top-full mt-1 z-50 w-72 rounded-xl border border-gray-700 bg-gray-900 shadow-xl p-3 space-y-3"
    >
      <div className="text-sm font-semibold text-white border-b border-gray-700 pb-2">{L.title}</div>

      <div className="space-y-1.5">
        <label className="text-xs text-gray-400">Asignar a existente</label>
        <select
          value={pickId}
          onChange={(e) => onPickIdChange(e.target.value)}
          disabled={disabled}
          className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white disabled:opacity-50"
        >
          <option value="">— Elegir —</option>
          {items.map((it) => (
            <option key={it.id} value={String(it.id)}>
              {it.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => {
            onAssignExisting();
            onClose();
          }}
          disabled={!canAssign}
          className={`w-full py-2 rounded-lg text-sm font-medium text-white ${L.accent} disabled:opacity-40 disabled:cursor-not-allowed`}
        >
          {loading ? "…" : L.assign}
        </button>
      </div>

      <div className="border-t border-gray-700 pt-3 space-y-1.5">
        <label className="text-xs text-gray-400">Crear nuevo</label>
        <input
          type="text"
          value={newLabel}
          onChange={(e) => onNewLabelChange(e.target.value)}
          placeholder={L.placeholder}
          disabled={disabled}
          className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white placeholder:text-gray-500 disabled:opacity-50"
        />
        <button
          type="button"
          onClick={() => {
            onCreateAndAssign();
            onClose();
          }}
          disabled={!canCreate}
          className={`w-full py-2 rounded-lg text-sm font-medium text-white ${L.accent} disabled:opacity-40 disabled:cursor-not-allowed`}
        >
          {loading ? "…" : L.create}
        </button>
      </div>
    </div>
  );
}
