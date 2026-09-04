import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Check, Eraser, Highlighter, PaintBucket, Paintbrush, Redo2, RotateCcw, Sparkles, SunMedium, Undo2, WandSparkles, X } from "lucide-react";
import type { CharacterEditProgress, CharacterPaintRequest } from "../ai/characterEditClient";

export type SketchTool = "color" | "shade" | "highlight" | "erase" | "magic";

interface SketchPaintStudioProps {
  source: File;
  originalSource?: File | null;
  onApply: (file: File) => void;
  onCancel: () => void;
  onAiAssist?: (source: File, request: CharacterPaintRequest, onProgress: (progress: CharacterEditProgress) => void) => Promise<File>;
}

interface LayerSnapshot {
  color: ImageData;
  shade: ImageData;
  highlight: ImageData;
  aiColor: ImageData;
  aiShade: ImageData;
}

const MAX_CANVAS_EDGE = 1536;
const MAX_UNDO = 20;

export function paintedSketchFilename(filename: string): string {
  const stem = filename.replace(/\.[^.]+$/, "") || "character";
  return `${stem}-painted.png`;
}

export function sketchLayerComposite(tool: SketchTool, preserveInk: boolean): GlobalCompositeOperation {
  if (tool === "erase") return "destination-out";
  if (tool === "shade") return "multiply";
  if (tool === "highlight") return "screen";
  return preserveInk ? "multiply" : "source-over";
}

const snapshotLayer = (canvas: HTMLCanvasElement): ImageData => {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("The sketch canvas is unavailable");
  return context.getImageData(0, 0, canvas.width, canvas.height);
};

const loadImage = (file: File): Promise<HTMLImageElement> => new Promise((resolve, reject) => {
  const url = URL.createObjectURL(file);
  const image = new Image();
  image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
  image.onerror = () => { URL.revokeObjectURL(url); reject(new Error("The artwork could not be loaded")); };
  image.src = url;
});

const similarPixel = (data: Uint8ClampedArray, index: number, target: [number, number, number, number], tolerance: number): boolean => {
  if (Math.abs(data[index + 3] - target[3]) > tolerance * 2) return false;
  const red = data[index] - target[0];
  const green = data[index + 1] - target[1];
  const blue = data[index + 2] - target[2];
  return red * red + green * green + blue * blue <= tolerance * tolerance * 3;
};

/** Fast boundary-aware point selection. Its mask also matches the point-prompt
 * contract used by SAM-style segmenters when that optional local pack is present. */
export function connectedRegionAlpha(image: ImageData, startX: number, startY: number, tolerance = 46): Uint8ClampedArray {
  const { width, height, data } = image;
  const x = Math.max(0, Math.min(width - 1, Math.round(startX)));
  const y = Math.max(0, Math.min(height - 1, Math.round(startY)));
  const start = y * width + x;
  const pixel = start * 4;
  const target: [number, number, number, number] = [data[pixel], data[pixel + 1], data[pixel + 2], data[pixel + 3]];
  const selected = new Uint8ClampedArray(width * height);
  const queue = new Int32Array(width * height);
  let head = 0;
  let tail = 0;
  queue[tail++] = start;
  selected[start] = 255;
  while (head < tail) {
    const point = queue[head++];
    const px = point % width;
    const py = Math.floor(point / width);
    const neighbors = [px > 0 ? point - 1 : -1, px + 1 < width ? point + 1 : -1, py > 0 ? point - width : -1, py + 1 < height ? point + width : -1];
    for (const neighbor of neighbors) {
      if (neighbor < 0 || selected[neighbor]) continue;
      if (!similarPixel(data, neighbor * 4, target, tolerance)) continue;
      selected[neighbor] = 255;
      queue[tail++] = neighbor;
    }
  }
  return selected;
}

const subjectAlpha = (image: ImageData): Uint8ClampedArray => {
  const { width, height, data } = image;
  const background = new Uint8ClampedArray(width * height);
  const queue = new Int32Array(width * height);
  let head = 0;
  let tail = 0;
  const add = (point: number) => { if (!background[point]) { background[point] = 255; queue[tail++] = point; } };
  [0, width - 1, (height - 1) * width, width * height - 1].forEach(add);
  while (head < tail) {
    const point = queue[head++];
    const px = point % width;
    const py = Math.floor(point / width);
    const offset = point * 4;
    const target: [number, number, number, number] = [data[offset], data[offset + 1], data[offset + 2], data[offset + 3]];
    const neighbors = [px > 0 ? point - 1 : -1, px + 1 < width ? point + 1 : -1, py > 0 ? point - width : -1, py + 1 < height ? point + width : -1];
    for (const neighbor of neighbors) {
      if (neighbor < 0 || background[neighbor]) continue;
      if (data[neighbor * 4 + 3] < 24 || similarPixel(data, neighbor * 4, target, 30)) add(neighbor);
    }
  }
  return background.map((value) => 255 - value);
};

const putAlphaMask = (canvas: HTMLCanvasElement, alpha: Uint8ClampedArray) => {
  const context = canvas.getContext("2d");
  if (!context) return;
  const image = context.createImageData(canvas.width, canvas.height);
  for (let index = 0; index < alpha.length; index++) {
    const offset = index * 4;
    image.data[offset] = image.data[offset + 1] = image.data[offset + 2] = 255;
    image.data[offset + 3] = alpha[index];
  }
  context.putImageData(image, 0, 0);
};

const canvasFile = async (canvas: HTMLCanvasElement, filename: string): Promise<File> => {
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("The canvas could not be prepared")), "image/png"));
  return new File([blob], filename, { type: "image/png", lastModified: Date.now() });
};

const inpaintMaskFile = async (mask: HTMLCanvasElement): Promise<File> => {
  // LoadImage converts inverted alpha to ComfyUI MASK values.
  const encoded = document.createElement("canvas");
  encoded.width = mask.width;
  encoded.height = mask.height;
  const source = mask.getContext("2d")?.getImageData(0, 0, mask.width, mask.height);
  const context = encoded.getContext("2d");
  if (!source || !context) throw new Error("The selected region is unavailable");
  const image = context.createImageData(mask.width, mask.height);
  for (let index = 0; index < mask.width * mask.height; index++) {
    const offset = index * 4;
    image.data[offset] = image.data[offset + 1] = image.data[offset + 2] = 255;
    image.data[offset + 3] = 255 - source.data[offset + 3];
  }
  context.putImageData(image, 0, 0);
  return canvasFile(encoded, "dndrom-character-inpaint-mask.png");
};

export function SketchPaintStudio({ source, originalSource, onApply, onCancel, onAiAssist }: SketchPaintStudioProps) {
  const displayRef = useRef<HTMLCanvasElement>(null);
  const sourceRef = useRef<HTMLCanvasElement>(document.createElement("canvas"));
  const colorRef = useRef<HTMLCanvasElement>(document.createElement("canvas"));
  const shadeRef = useRef<HTMLCanvasElement>(document.createElement("canvas"));
  const highlightRef = useRef<HTMLCanvasElement>(document.createElement("canvas"));
  const aiColorRef = useRef<HTMLCanvasElement>(document.createElement("canvas"));
  const aiShadeRef = useRef<HTMLCanvasElement>(document.createElement("canvas"));
  const selectionRef = useRef<HTMLCanvasElement>(document.createElement("canvas"));
  const undoRef = useRef<LayerSnapshot[]>([]);
  const redoRef = useRef<LayerSnapshot[]>([]);
  const drawingRef = useRef(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  const [tool, setTool] = useState<SketchTool>("color");
  const [magicMode, setMagicMode] = useState<"color" | "shade">("color");
  const [color, setColor] = useState("#b44d73");
  const [size, setSize] = useState(44);
  const [opacity, setOpacity] = useState(.55);
  const [tolerance, setTolerance] = useState(46);
  const [preserveInk, setPreserveInk] = useState(true);
  const [ready, setReady] = useState(false);
  const [historyVersion, setHistoryVersion] = useState(0);
  const [selectionVersion, setSelectionVersion] = useState(0);
  const [selectionLabel, setSelectionLabel] = useState("Click a section of the character");
  const [aiInstruction, setAiInstruction] = useState("Paint this section with the selected color while preserving its material and ink lines");
  const [aiBusy, setAiBusy] = useState<"color" | "shade" | null>(null);
  const [aiProgress, setAiProgress] = useState<CharacterEditProgress | null>(null);
  const [aiError, setAiError] = useState("");
  const [aiStrength, setAiStrength] = useState(.3);
  const layerCanvases = useCallback(() => [colorRef.current, shadeRef.current, highlightRef.current, aiColorRef.current, aiShadeRef.current, selectionRef.current], []);

  const compose = useCallback((target: HTMLCanvasElement) => {
    if (!ready) return;
    const context = target.getContext("2d");
    if (!context) return;
    context.clearRect(0, 0, target.width, target.height);
    context.globalAlpha = 1;
    context.globalCompositeOperation = "source-over";
    context.drawImage(sourceRef.current, 0, 0);
    context.globalCompositeOperation = preserveInk ? "multiply" : "source-over";
    context.drawImage(colorRef.current, 0, 0);
    context.globalCompositeOperation = "source-over";
    context.drawImage(aiColorRef.current, 0, 0);
    context.globalCompositeOperation = "multiply";
    context.drawImage(shadeRef.current, 0, 0);
    context.globalCompositeOperation = "luminosity";
    context.drawImage(aiShadeRef.current, 0, 0);
    context.globalCompositeOperation = "screen";
    context.drawImage(highlightRef.current, 0, 0);
    context.globalAlpha = 1;
    context.globalCompositeOperation = "source-over";
  }, [preserveInk, ready]);

  const render = useCallback(() => {
    const target = displayRef.current;
    if (!target) return;
    compose(target);
    if (tool === "magic" && selectionVersion) {
      const overlay = document.createElement("canvas");
      overlay.width = target.width; overlay.height = target.height;
      const context = overlay.getContext("2d")!;
      context.fillStyle = "rgba(152,119,255,.32)";
      context.fillRect(0, 0, overlay.width, overlay.height);
      context.globalCompositeOperation = "destination-in";
      context.drawImage(selectionRef.current, 0, 0);
      target.getContext("2d")?.drawImage(overlay, 0, 0);
    }
  }, [compose, selectionVersion, tool]);

  const initializeFrom = useCallback(async (file: File, resetHistory = true) => {
    const image = await loadImage(file);
    const scale = Math.min(1, MAX_CANVAS_EDGE / Math.max(image.naturalWidth, image.naturalHeight));
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));
    for (const canvas of [sourceRef.current, ...layerCanvases(), displayRef.current]) {
      if (!canvas) continue;
      canvas.width = width; canvas.height = height;
    }
    sourceRef.current.getContext("2d")?.drawImage(image, 0, 0, width, height);
    layerCanvases().forEach((canvas) => canvas.getContext("2d")?.clearRect(0, 0, width, height));
    if (resetHistory) { undoRef.current = []; redoRef.current = []; }
    setSelectionVersion(0); setReady(true); setHistoryVersion((value) => value + 1);
  }, [layerCanvases]);

  useEffect(() => { void initializeFrom(source).catch(() => setReady(false)); }, [initializeFrom, source]);
  useEffect(() => { render(); }, [render, historyVersion]);
  useEffect(() => {
    const shortcuts: Record<string, SketchTool> = { b: "color", s: "shade", h: "highlight", e: "erase", w: "magic" };
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || (target instanceof HTMLElement && target.isContentEditable)) return;
      const nextTool = shortcuts[event.key.toLowerCase()];
      if (nextTool) setTool(nextTool);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const capture = (): LayerSnapshot => ({ color: snapshotLayer(colorRef.current), shade: snapshotLayer(shadeRef.current), highlight: snapshotLayer(highlightRef.current), aiColor: snapshotLayer(aiColorRef.current), aiShade: snapshotLayer(aiShadeRef.current) });
  const restore = (snapshot: LayerSnapshot) => {
    colorRef.current.getContext("2d")?.putImageData(snapshot.color, 0, 0); shadeRef.current.getContext("2d")?.putImageData(snapshot.shade, 0, 0);
    highlightRef.current.getContext("2d")?.putImageData(snapshot.highlight, 0, 0); aiColorRef.current.getContext("2d")?.putImageData(snapshot.aiColor, 0, 0); aiShadeRef.current.getContext("2d")?.putImageData(snapshot.aiShade, 0, 0);
    setHistoryVersion((value) => value + 1);
  };
  const beginChange = () => { undoRef.current = [...undoRef.current.slice(-(MAX_UNDO - 1)), capture()]; redoRef.current = []; setHistoryVersion((value) => value + 1); };
  const canvasPoint = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = displayRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const bounds = canvas.getBoundingClientRect();
    return { x: (event.clientX - bounds.left) * canvas.width / bounds.width, y: (event.clientY - bounds.top) * canvas.height / bounds.height };
  };
  const activeLayers = () => tool === "erase" ? [colorRef.current, shadeRef.current, highlightRef.current, aiColorRef.current, aiShadeRef.current] : [tool === "color" ? colorRef.current : tool === "shade" ? shadeRef.current : highlightRef.current];
  const stroke = (from: { x: number; y: number }, to: { x: number; y: number }) => {
    for (const layer of activeLayers()) {
      const context = layer.getContext("2d"); if (!context) continue;
      context.save(); context.globalCompositeOperation = tool === "erase" ? "destination-out" : "source-over"; context.globalAlpha = tool === "erase" ? 1 : opacity;
      context.strokeStyle = tool === "shade" ? "#21142c" : tool === "highlight" ? "#fff2c7" : color;
      context.lineWidth = size; context.lineCap = "round"; context.lineJoin = "round"; context.beginPath(); context.moveTo(from.x, from.y); context.lineTo(to.x, to.y); context.stroke(); context.restore();
    }
    render();
  };

  const flattenedDrawing = async (): Promise<File> => {
    const canvas = document.createElement("canvas"); canvas.width = sourceRef.current.width; canvas.height = sourceRef.current.height; compose(canvas);
    return canvasFile(canvas, paintedSketchFilename(source.name));
  };
  const applyAiResult = async (result: File, mode: "color" | "shade", mask: HTMLCanvasElement) => {
    const image = await loadImage(result); beginChange();
    const clipped = document.createElement("canvas"); clipped.width = sourceRef.current.width; clipped.height = sourceRef.current.height;
    const context = clipped.getContext("2d")!; context.drawImage(image, 0, 0, clipped.width, clipped.height); context.globalCompositeOperation = "destination-in"; context.drawImage(mask, 0, 0);
    const target = mode === "shade" ? aiShadeRef.current : aiColorRef.current; const targetContext = target.getContext("2d")!;
    targetContext.save(); targetContext.globalCompositeOperation = "destination-out"; targetContext.drawImage(mask, 0, 0); targetContext.restore();
    targetContext.save(); targetContext.globalAlpha = mode === "shade" ? Math.min(.72, .38 + aiStrength) : Math.min(.88, .5 + aiStrength); targetContext.drawImage(clipped, 0, 0); targetContext.restore();
    setHistoryVersion((value) => value + 1);
  };
  const runAiAssist = async (mode: "color" | "shade", mask: HTMLCanvasElement, label: string) => {
    if (!onAiAssist || aiBusy || !ready) return;
    setAiBusy(mode); setAiError(""); setAiProgress({ message: `Protecting the original and preparing ${label}…`, percent: 1 });
    try {
      const [input, maskFile] = await Promise.all([flattenedDrawing(), inpaintMaskFile(mask)]);
      const result = await onAiAssist(input, { mode, color, instruction: aiInstruction, strength: aiStrength, mask: maskFile, region: label }, setAiProgress);
      await applyAiResult(result, mode, mask);
      setAiProgress({ message: `${label} applied on a reversible AI layer · protected pixels are unchanged`, percent: 100 });
    } catch (error) { setAiError(error instanceof Error ? error.message : "Local AI paint assistance failed"); } finally { setAiBusy(null); }
  };
  const selectMagicRegion = (point: { x: number; y: number }) => {
    const canvas = displayRef.current; if (!canvas) return; compose(canvas);
    const image = canvas.getContext("2d", { willReadFrequently: true })?.getImageData(0, 0, canvas.width, canvas.height); if (!image) return;
    const alpha = connectedRegionAlpha(image, point.x, point.y, tolerance); putAlphaMask(selectionRef.current, alpha);
    const selectedPixels = alpha.reduce((count, value) => count + (value ? 1 : 0), 0); const label = `selected section (${Math.max(1, Math.round(selectedPixels / alpha.length * 100))}% of artwork)`;
    setSelectionLabel(label); setSelectionVersion((value) => value + 1); void runAiAssist(magicMode, selectionRef.current, label);
  };
  const pointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!ready) return; const point = canvasPoint(event);
    if (tool === "magic") { selectMagicRegion(point); return; }
    event.currentTarget.setPointerCapture(event.pointerId); beginChange(); drawingRef.current = true; lastPointRef.current = point; stroke(point, point);
  };
  const pointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => { if (!drawingRef.current || !lastPointRef.current) return; const point = canvasPoint(event); stroke(lastPointRef.current, point); lastPointRef.current = point; };
  const endStroke = () => { drawingRef.current = false; lastPointRef.current = null; setHistoryVersion((value) => value + 1); };
  const undo = () => { const previous = undoRef.current.pop(); if (!previous) return; redoRef.current.push(capture()); restore(previous); };
  const redo = () => { const next = redoRef.current.pop(); if (!next) return; undoRef.current.push(capture()); restore(next); };
  const reset = () => { beginChange(); [colorRef.current, shadeRef.current, highlightRef.current, aiColorRef.current, aiShadeRef.current].forEach((layer) => layer.getContext("2d")?.clearRect(0, 0, layer.width, layer.height)); setHistoryVersion((value) => value + 1); };
  const restoreOriginal = async () => { if (!originalSource) return; await initializeFrom(originalSource); setAiProgress({ message: "The locked uploaded original was restored", percent: 100 }); };
  const fullShade = () => {
    const canvas = displayRef.current; if (!canvas) return; compose(canvas);
    const image = canvas.getContext("2d", { willReadFrequently: true })?.getImageData(0, 0, canvas.width, canvas.height); if (!image) return;
    const mask = document.createElement("canvas"); mask.width = canvas.width; mask.height = canvas.height; putAlphaMask(mask, subjectAlpha(image)); void runAiAssist("shade", mask, "character only");
  };
  const apply = async () => onApply(await flattenedDrawing());
  const tools: Array<{ id: SketchTool; label: string; shortcut: string; icon: typeof Paintbrush }> = [
    { id: "color", label: "Brush", shortcut: "B", icon: Paintbrush }, { id: "shade", label: "Shade brush", shortcut: "S", icon: PaintBucket }, { id: "highlight", label: "Highlight brush", shortcut: "H", icon: Highlighter },
    { id: "erase", label: "Erase paint", shortcut: "E", icon: Eraser }, { id: "magic", label: "Magic AI brush", shortcut: "W", icon: WandSparkles },
  ];

  return <section className="sketch-paint-studio" aria-label="Sketch paint and shade editor">
    <header><div><strong>Paint & shade</strong><small>Non-destructive layers · uploaded original locked</small></div><div className="sketch-history-controls">
      <button className="icon-tooltip" data-tooltip="Undo" aria-label="Undo" onClick={undo} disabled={!undoRef.current.length}><Undo2 size={15} /></button><button className="icon-tooltip" data-tooltip="Redo" aria-label="Redo" onClick={redo} disabled={!redoRef.current.length}><Redo2 size={15} /></button><button className="icon-tooltip" data-tooltip="Clear edit layers" aria-label="Clear edit layers" onClick={reset}><RotateCcw size={15} /></button><i /><button onClick={onCancel}><X size={15} /> Close</button><button className="primary-button" onClick={() => void apply()} disabled={!ready}><Check size={15} /> Use artwork</button>
    </div></header>
    <div className="sketch-editor-body">
      <aside className="sketch-tool-rail" role="toolbar" aria-label="Painting tools">{tools.map(({ id, label, shortcut, icon: Icon }) => <button key={id} className={`icon-tooltip ${tool === id ? "active" : ""}`} data-tooltip={`${label} (${shortcut})`} aria-label={`${label} (${shortcut})`} aria-pressed={tool === id} onClick={() => setTool(id)}><Icon size={18} /></button>)}</aside>
      <div className={`sketch-canvas-wrap tool-${tool}`}><canvas ref={displayRef} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={endStroke} onPointerCancel={endStroke} onPointerLeave={endStroke} />{tool === "magic" && <div className="magic-brush-hint"><WandSparkles size={14} /><span>{aiBusy ? "AI is painting the protected selection…" : selectionLabel}</span></div>}</div>
      <aside className="sketch-properties-panel">
        <div className="sketch-properties-title"><span>{tool === "magic" ? <WandSparkles size={15} /> : <Paintbrush size={15} />}</span><div><strong>{tools.find((entry) => entry.id === tool)?.label}</strong><small>{tool === "magic" ? "Click a bounded area to select and paint it" : "Edit settings for the active tool"}</small></div></div>
        {tool === "magic" && <div className="magic-mode-switch" role="group" aria-label="Magic brush operation"><button className={magicMode === "color" ? "active" : ""} onClick={() => setMagicMode("color")}><PaintBucket size={13} /> Paint</button><button className={magicMode === "shade" ? "active" : ""} onClick={() => setMagicMode("shade")}><SunMedium size={13} /> Shade</button></div>}
        <label className="sketch-color-control"><span>Foreground color</span><input type="color" value={color} onChange={(event) => setColor(event.target.value)} /><output>{color}</output></label>
        {tool !== "magic" ? <><label>Brush size <output>{size}px</output><input type="range" min="4" max="160" value={size} onChange={(event) => setSize(Number(event.target.value))} /></label><label>Opacity <output>{Math.round(opacity * 100)}%</output><input type="range" min="0.08" max="1" step="0.01" value={opacity} onChange={(event) => setOpacity(Number(event.target.value))} /></label><label className="sketch-ink-toggle"><input type="checkbox" checked={preserveInk} onChange={(event) => setPreserveInk(event.target.checked)} /><span><strong>Preserve line work</strong><small>Color blends below existing ink</small></span></label></> : <label>Selection tolerance <output>{tolerance}</output><input type="range" min="12" max="90" value={tolerance} onChange={(event) => setTolerance(Number(event.target.value))} /></label>}
        {onAiAssist && <section className="sketch-ai-assist" aria-label="AI paint and shading assistant"><div><Sparkles size={15} /><span><strong>Protected AI edit</strong><small>Mask-bound local inpainting</small></span></div><label>AI influence <output>{Math.round(aiStrength * 100)}%</output><input type="range" min="0.12" max="0.48" step="0.01" value={aiStrength} onChange={(event) => setAiStrength(Number(event.target.value))} /></label><label>Instruction<textarea rows={3} value={aiInstruction} onChange={(event) => setAiInstruction(event.target.value)} placeholder="Rose-pink leather cloak with soft moonlit shading" /></label><button className="sketch-full-shade" onClick={fullShade} disabled={Boolean(aiBusy)}>{aiBusy === "shade" ? <Sparkles className="spin" size={15} /> : <SunMedium size={15} />} Shade character only</button><p>Full shade uses luminosity only, preserving the palette and leaving the background untouched.</p>{aiProgress && <div className={`sketch-ai-progress ${aiError ? "error" : ""}`}><span>{aiError || aiProgress.message}</span><i><b style={{ width: `${aiError ? 100 : aiProgress.percent}%` }} /></i></div>}</section>}
        <section className="original-art-guard"><div><Check size={14} /><span><strong>Original protected</strong><small>AI results are reversible layers, never replacements.</small></span></div><button onClick={() => void restoreOriginal()} disabled={!originalSource || Boolean(aiBusy)}><RotateCcw size={13} /> Restore upload</button></section>
      </aside>
    </div>
  </section>;
}
