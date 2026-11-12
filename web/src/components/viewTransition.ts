import { flushSync } from "react-dom";

type DocumentWithVT = Document & {
  startViewTransition?: (update: () => void) => { finished: Promise<void> };
};

/** True when the browser can animate and the viewer hasn't asked for reduced motion. */
export function canViewTransition(): boolean {
  if (typeof document === "undefined") return false;
  const doc = document as DocumentWithVT;
  if (typeof doc.startViewTransition !== "function") return false;
  return !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Run a state update inside a View Transition so named glass layers (the tab
 * pill, the nav pill, the page content) morph instead of jumping. Falls back
 * to a plain update when unsupported.
 */
export function withViewTransition(update: () => void, kind: "tab" | "theme" = "tab"): void {
  if (!canViewTransition()) {
    update();
    return;
  }
  const root = document.documentElement;
  root.dataset.vt = kind;
  const transition = (document as DocumentWithVT).startViewTransition!(() => {
    flushSync(update);
  });
  transition.finished.finally(() => {
    if (root.dataset.vt === kind) delete root.dataset.vt;
  });
}
