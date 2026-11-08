import React, {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "./ui";

type Side = "top" | "bottom" | "left" | "right";

export default function Tooltip({
  content,
  children,
  side = "top",
  delay = 140,
  disabled = false,
  className,
}: {
  content: React.ReactNode;
  children: React.ReactNode;
  side?: Side;
  delay?: number;
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLSpanElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const id = useId();

  const show = () => {
    if (disabled || !content) return;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setOpen(true), delay);
  };
  const hide = () => {
    window.clearTimeout(timer.current);
    setOpen(false);
    setCoords(null);
  };

  useLayoutEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    const tip = tooltipRef.current;
    if (!trigger || !tip) return;
    const rect = trigger.getBoundingClientRect();
    const tipRect = tip.getBoundingClientRect();
    const gap = 9;
    let top = 0;
    let left = 0;
    if (side === "bottom") {
      top = rect.bottom + gap;
      left = rect.left + rect.width / 2 - tipRect.width / 2;
    } else if (side === "left") {
      top = rect.top + rect.height / 2 - tipRect.height / 2;
      left = rect.left - tipRect.width - gap;
    } else if (side === "right") {
      top = rect.top + rect.height / 2 - tipRect.height / 2;
      left = rect.right + gap;
    } else {
      top = rect.top - tipRect.height - gap;
      left = rect.left + rect.width / 2 - tipRect.width / 2;
    }
    top = Math.max(8, Math.min(top, window.innerHeight - tipRect.height - 8));
    left = Math.max(8, Math.min(left, window.innerWidth - tipRect.width - 8));
    setCoords({ top, left });
  }, [open, side, content]);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  return (
    <>
      <span
        ref={triggerRef}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        aria-describedby={open ? id : undefined}
        className="inline-flex"
      >
        {children}
      </span>
      {open
        ? createPortal(
            <div
              id={id}
              ref={tooltipRef}
              role="tooltip"
              style={{
                position: "fixed",
                top: coords?.top ?? -9999,
                left: coords?.left ?? -9999,
              }}
              className={cn(
                "tooltip-panel pointer-events-none z-[100] max-w-xs rounded-lg border border-white/10 bg-ink-950/95 px-2.5 py-1.5 text-[11px] font-medium leading-relaxed text-slate-200 shadow-xl shadow-black/30 backdrop-blur-md",
                !coords && "opacity-0",
                className,
              )}
            >
              {content}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
