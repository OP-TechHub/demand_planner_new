'use client';

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';

/**
 * A table column the user can drag wider or narrower from its header's right
 * edge. Double-clicking the edge puts it back to the default. The chosen width
 * is remembered per browser under `storageKey`, so a column widened once stays
 * widened across visits; it is a viewing convenience only, never shared.
 *
 * The header cell the handle goes in must be positioned (`sticky` or
 * `relative`) so the handle can sit on its edge.
 */
export function useResizableColumn(storageKey: string, defaultPx: number, { min = 120, max = 720 } = {}) {
  const key = `col-width:${storageKey}`;
  const [width, setWidth] = useState(defaultPx);

  // Read after mount, not during render: the server has no stored width, and
  // reading it up front would make the first client render disagree.
  useEffect(() => {
    try {
      const saved = Number(window.localStorage.getItem(key));
      if (saved >= min && saved <= max) setWidth(saved);
    } catch { /* storage blocked: keep the default */ }
  }, [key, min, max]);

  const save = useCallback((w: number) => {
    try {
      if (w === defaultPx) window.localStorage.removeItem(key);
      else window.localStorage.setItem(key, String(w));
    } catch { /* storage blocked: the width still applies until reload */ }
  }, [key, defaultPx]);

  const drag = useRef<{ x: number; w: number } | null>(null);
  const latest = useRef(width);
  latest.current = width;

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    drag.current = { x: e.clientX, w: latest.current };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    setWidth(Math.min(max, Math.max(min, Math.round(drag.current.w + e.clientX - drag.current.x))));
  };
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    drag.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
    save(latest.current);
  };
  const reset = () => { setWidth(defaultPx); save(defaultPx); };

  /** Width, min and max together: a table cell honours max-width only alongside the others. */
  const style: CSSProperties = { width, minWidth: width, maxWidth: width };

  const handle = (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Drag to resize column, double-click to reset"
      title="Drag to resize · double-click to reset"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={reset}
      onClick={(e) => e.stopPropagation()}
      className="absolute inset-y-0 -right-1 z-10 w-2 cursor-col-resize touch-none select-none after:absolute after:inset-y-1 after:left-1/2 after:w-px after:-translate-x-1/2 after:bg-border hover:after:w-0.5 hover:after:bg-primary"
    />
  );

  return { width, style, handle };
}
