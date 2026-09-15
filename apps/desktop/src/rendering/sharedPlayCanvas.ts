let sharedCanvas: HTMLCanvasElement | null = null;

/**
 * Tabletop and Forge are visually exclusive, but React can mount the incoming
 * surface before unmounting the outgoing one. Never move a live canvas between
 * two PlayCanvas applications: WebGPU canvas contexts cannot be safely
 * reconfigured while the previous device still owns them. A detached canvas is
 * reused; an overlapping transition receives a fresh canvas temporarily.
 */
export function claimSharedPlayCanvas(host: HTMLElement, ariaLabel?: string): HTMLCanvasElement {
  const canvas = sharedCanvas && !sharedCanvas.isConnected ? sharedCanvas : document.createElement("canvas");
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
