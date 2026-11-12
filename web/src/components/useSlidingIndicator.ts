import { useLayoutEffect, useRef, useState } from "react";

export interface IndicatorRect {
  x: number;
  y: number;
  width: number;
  height: number;
  /** False for the first placement so the pill appears in place instead of flying in. */
  animate: boolean;
}

/**
 * Track the active child of a container so a single glass pill can glide to it.
 * The container must be positioned (relative) so offsets are measured against it.
 */
export function useSlidingIndicator<T extends HTMLElement>(selector: string, key: unknown) {
  const ref = useRef<T>(null);
  const [rect, setRect] = useState<IndicatorRect | null>(null);
  const placed = useRef(false);

  useLayoutEffect(() => {
    const container = ref.current;
    if (!container) return;

    const measure = () => {
      const target = container.querySelector<HTMLElement>(selector);
      if (!target) {
        setRect(null);
        placed.current = false;
        return;
      }
      const next = {
        x: target.offsetLeft,
        y: target.offsetTop,
        width: target.offsetWidth,
        height: target.offsetHeight,
        animate: placed.current,
      };
      placed.current = true;
      setRect((prev) =>
        prev &&
        prev.x === next.x &&
        prev.y === next.y &&
        prev.width === next.width &&
        prev.height === next.height
          ? prev
          : next,
      );
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    container.querySelectorAll<HTMLElement>(":scope > *").forEach((child) => observer.observe(child));
    document.fonts?.ready.then(measure).catch(() => {});
    return () => observer.disconnect();
  }, [selector, key]);

  const style: React.CSSProperties | undefined = rect
    ? {
        width: rect.width,
        height: rect.height,
        transform: `translate3d(${rect.x}px, ${rect.y}px, 0)`,
        transition: rect.animate
          ? "transform 480ms cubic-bezier(0.32, 0.72, 0, 1), width 480ms cubic-bezier(0.32, 0.72, 0, 1), height 480ms cubic-bezier(0.32, 0.72, 0, 1)"
          : "none",
      }
    : undefined;

  return { ref, style, visible: rect !== null };
}
