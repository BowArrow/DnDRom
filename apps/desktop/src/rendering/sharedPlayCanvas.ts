let sharedCanvas: HTMLCanvasElement | null = null;

/**
 * The tabletop and Forge pages are mutually exclusive, so they reuse one DOM
 * canvas and therefore one native WebGL context. PlayCanvas applications may
 * be rebuilt on this canvas without letting WebView2 accumulate abandoned
 * contexts across mode changes.
 */
export function claimSharedPlayCanvas(host: HTMLElement, ariaLabel?: string): HTMLCanvasElement {
  const canvas = sharedCanvas ?? document.createElement("canvas");
  sharedCanvas = canvas;
  for (const key of Object.keys(canvas.dataset)) delete canvas.dataset[key];
  canvas.className = "";
  if (ariaLabel) canvas.setAttribute("aria-label", ariaLabel);
  else canvas.removeAttribute("aria-label");
  host.replaceChildren(canvas);
  return canvas;
}

export function releaseSharedPlayCanvas(host: HTMLElement, canvas: HTMLCanvasElement): void {
  if (canvas.parentElement === host) canvas.remove();
}
