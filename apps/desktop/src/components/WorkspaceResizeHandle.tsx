import { useRef } from "react";

export function WorkspaceResizeHandle({ side, width, otherWidth, onChange }: { side: "left" | "right"; width: number; otherWidth: number; onChange: (width: number) => void }) {
  const drag = useRef<{ x: number; width: number } | null>(null);
  const minimum = 220, maximum = Math.max(minimum, Math.min(560, innerWidth < 1000 ? innerWidth - 64 : Math.min(innerWidth * .34, innerWidth - otherWidth - 360)));
  const actualWidth = Math.min(width, maximum);
  const change = (value: number) => onChange(Math.round(Math.max(minimum, Math.min(maximum, value))));
  const reset = () => change(side === "left" ? 312 : 388);
  return <div className={`workspace-resize-handle resize-${side}`} role="separator" aria-orientation="vertical" aria-label={side === "left" ? "Resize asset tray" : "Resize side panel"} aria-valuemin={minimum} aria-valuemax={maximum} aria-valuenow={actualWidth} tabIndex={0} title="Drag to resize. Double-click to reset. Arrow keys adjust width."
    onPointerDown={event => { if (event.button !== 0) return; event.preventDefault(); drag.current = { x: event.clientX, width: actualWidth }; event.currentTarget.setPointerCapture(event.pointerId); }}
    onPointerMove={event => { if (drag.current) change(drag.current.width + (event.clientX - drag.current.x) * (side === "left" ? 1 : -1)); }}
    onPointerUp={event => { drag.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
    onLostPointerCapture={() => { drag.current = null; }} onDoubleClick={reset}
    onKeyDown={event => { if (event.key === "Home" || event.key === "Enter") { event.preventDefault(); reset(); } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); change(actualWidth + (event.key === "ArrowRight" ? 16 : -16) * (side === "left" ? 1 : -1)); } }}><span /></div>;
}
