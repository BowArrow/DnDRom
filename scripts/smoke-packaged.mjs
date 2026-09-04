import { spawn } from "node:child_process";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const workspace = path.resolve(import.meta.dirname, "..");
const executable = path.resolve(process.argv[2] ?? path.join(workspace, "target", "release", "dndrom-desktop.exe"));
const timeoutMs = Number(process.env.DNDROM_SMOKE_TIMEOUT_MS ?? 20_000);

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const minimalSelfContainedGlb = () => {
  const positions = Buffer.from(new Float32Array([-.45, 0, 0, .45, 0, 0, 0, 1.1, 0]).buffer);
  const document = {
    asset: { version: "2.0", generator: "DnDRom packaged smoke" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, mode: 4 }] }],
    buffers: [{ byteLength: positions.length }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: positions.length, target: 34962 }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: "VEC3", min: [-.45, 0, 0], max: [.45, 1.1, 0] }],
  };
  const jsonSource = Buffer.from(JSON.stringify(document));
  const json = Buffer.concat([jsonSource, Buffer.alloc((4 - jsonSource.length % 4) % 4, 0x20)]);
  const header = Buffer.alloc(12), jsonHeader = Buffer.alloc(8), binaryHeader = Buffer.alloc(8);
  const total = 12 + 8 + json.length + 8 + positions.length;
  header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(total, 8);
  jsonHeader.writeUInt32LE(json.length, 0); jsonHeader.writeUInt32LE(0x4e4f534a, 4);
  binaryHeader.writeUInt32LE(positions.length, 0); binaryHeader.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([header, jsonHeader, json, binaryHeader, positions]);
};

const availablePort = async () => await new Promise((resolve, reject) => {
  const server = net.createServer();
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    if (!address || typeof address === "string") return reject(new Error("Could not allocate a diagnostics port"));
    const port = address.port;
    server.close((error) => error ? reject(error) : resolve(port));
  });
});

const waitForTarget = async (port, child) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`DnDRom exited before WebView startup with code ${child.exitCode}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json`);
      if (response.ok) {
        const targets = await response.json();
        const page = targets.find((target) => target.type === "page" && target.webSocketDebuggerUrl);
        if (page) return page;
      }
    } catch {
      // WebView2 opens the diagnostics port after its process is ready.
    }
    await delay(200);
  }
  throw new Error("Timed out waiting for the packaged WebView2 target");
};

const connectCdp = async (url) => await new Promise((resolve, reject) => {
  const socket = new WebSocket(url);
  socket.addEventListener("open", () => resolve(socket), { once: true });
  socket.addEventListener("error", () => reject(new Error("Could not connect to WebView2 diagnostics")), { once: true });
});

const inspectPage = async (socket, smokeModelPath, smokeDrawingPath) => {
  let nextId = 0;
  const pending = new Map();
  const failures = [];
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
      return;
    }
    if (message.method === "Runtime.exceptionThrown") failures.push(message.params.exceptionDetails?.exception?.description ?? message.params.exceptionDetails?.text ?? "Unhandled JavaScript exception");
    if (message.method === "Runtime.consoleAPICalled" && ["error", "warning"].includes(message.params.type)) failures.push(`${message.params.type}: ${(message.params.args ?? []).map((arg) => arg.description ?? arg.value ?? "").join(" ")}`);
    if (message.method === "Log.entryAdded" && ["error", "warning"].includes(message.params.entry?.level)) failures.push(`${message.params.entry.level}: ${message.params.entry.text}`);
  });
  const command = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
  await command("Runtime.enable");
  await command("Log.enable");
  await command("Page.enable");
  await command("DOM.enable");
  await delay(2500);
  const evaluation = await command("Runtime.evaluate", {
    expression: `(() => {
      const root = document.getElementById("root");
      return {
        readyState: document.readyState,
        rootChildren: root?.childElementCount ?? -1,
        rootText: root?.innerText?.slice(0, 240) ?? "",
        bodyColor: getComputedStyle(document.body).backgroundColor,
        bootStatus: globalThis.__DNDROM_BOOT_STATUS__ ?? null,
      };
    })()`,
    returnByValue: true,
  });
  const snapshot = evaluation.result?.value;
  const clickByText = async (selector, text) => {
    const result = await command("Runtime.evaluate", {
      expression: `(() => {
        const target = [...document.querySelectorAll(${JSON.stringify(selector)})].find((node) => node.textContent?.includes(${JSON.stringify(text)}));
        if (!target) return false;
        target.click();
        return true;
      })()`,
      returnByValue: true,
    });
    if (!result.result?.value) {
      const context = await command("Runtime.evaluate", {
        expression: `(() => ({ bootFailure: document.querySelector('.boot-failure')?.textContent?.trim() ?? '', page: document.querySelector('main')?.textContent?.trim().slice(0, 600) ?? document.body.textContent?.trim().slice(0, 600) ?? '', candidates: [...document.querySelectorAll(${JSON.stringify(selector)})].slice(-12).map((node) => node.textContent?.trim()) }))()`,
        returnByValue: true,
      });
      throw new Error(`Could not find packaged UI control: ${text}. State: ${JSON.stringify({ page: context.result?.value, failures: failures.slice(-8) })}`);
    }
    await delay(150);
  };
  const evaluateValue = async (expression) => {
    const evaluation = await command("Runtime.evaluate", { expression, returnByValue: true });
    if (evaluation.exceptionDetails) {
      const detail = evaluation.exceptionDetails.exception?.description ?? evaluation.exceptionDetails.text ?? "Unknown evaluation failure";
      throw new Error(`Packaged WebView evaluation failed: ${detail}`);
    }
    return evaluation.result?.value;
  };
  const waitForValue = async (expression, waitMs = 20_000) => {
    const deadline = Date.now() + waitMs;
    let value;
    while (Date.now() < deadline) {
      value = await evaluateValue(expression);
      if (value) return value;
      await delay(100);
    }
    throw new Error(`Timed out waiting for packaged state: ${expression}. Last value: ${JSON.stringify(value)}${failures.length ? `\nWebView failures:\n- ${[...new Set(failures)].slice(-12).join("\n- ")}` : ""}`);
  };

  await clickByText(".campaign-current-button", "The Ember Below");
  const campaignLibraryOpen = await evaluateValue("Boolean(document.querySelector('[aria-label=\"Campaign library\"]')?.textContent?.includes('Continue an adventure'))");
  await evaluateValue(`(() => { const input = document.querySelector('.campaign-create-row input'); if (!input) return false; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'Packaged smoke campaign'); input.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  await delay(100);
  await clickByText(".campaign-create-row button", "New campaign");
  const newCampaignCreated = await evaluateValue("document.querySelector('.campaign-current-button')?.textContent?.includes('Packaged smoke campaign') ?? false");
  await clickByText(".campaign-current-button", "Packaged smoke campaign");
  await clickByText(".campaign-card-list button", "Resume");
  const campaignResumed = await evaluateValue("document.querySelector('.campaign-current-button')?.textContent?.includes('The Ember Below') ?? false");
  await evaluateValue(`(() => { document.querySelectorAll('.toast button').forEach((button) => button.click()); return true; })()`);

  await command("Emulation.setDeviceMetricsOverride", { width: 1800, height: 900, deviceScaleFactor: 1, mobile: false });
  await delay(180);
  const fullHeader = await evaluateValue(`(() => { const header = document.querySelector('.app-header'), mode = document.querySelector('.header-center'), actions = document.querySelector('.header-actions'), gear = document.querySelector('[aria-label="Open display settings"]'), avatar = document.querySelector('.avatar-mini'); const h = header?.getBoundingClientRect(), m = mode?.getBoundingClientRect(), a = actions?.getBoundingClientRect(), g = gear?.getBoundingClientRect(), v = avatar?.getBoundingClientRect(); return { height: h?.height ?? 0, sameRow: Boolean(h && m && Math.abs((m.top + m.height / 2) - (h.top + 32)) < 8), noOverlap: Boolean(m && a && m.right < a.left), gearFarRight: Boolean(g && v && g.left > v.right && innerWidth - g.right < 20) }; })()`);
  await command("Emulation.setDeviceMetricsOverride", { width: 1100, height: 820, deviceScaleFactor: 1, mobile: false });
  await delay(180);
  const compactHeader = await evaluateValue(`(() => { const header = document.querySelector('.app-header'), mode = document.querySelector('.header-center'), actions = document.querySelector('.header-actions'), gear = document.querySelector('[aria-label="Open display settings"]'); const h = header?.getBoundingClientRect(), m = mode?.getBoundingClientRect(), a = actions?.getBoundingClientRect(), g = gear?.getBoundingClientRect(); return { height: h?.height ?? 0, secondRow: Boolean(h && m && m.top >= h.top + 63), noOverlap: Boolean(m && a && m.top >= a.bottom), gearFarRight: Boolean(g && innerWidth - g.right < 20) }; })()`);
  await command("Emulation.clearDeviceMetricsOverride");
  await delay(180);
  const headerLayout = { full: fullHeader, compact: compactHeader };

  const settingsOpened = await evaluateValue(`(() => { const button = document.querySelector('[aria-label="Open display settings"]'); if (!(button instanceof HTMLElement)) return false; button.click(); return true; })()`);
  await delay(180);
  const displaySettingsDialog = await evaluateValue(`(() => { const dialog = document.querySelector('[aria-labelledby="display-settings-title"]'); const text = dialog?.textContent ?? ''; const rect = dialog?.getBoundingClientRect(); return { open: Boolean(dialog), tiers: ['Performance','Balanced','Cinematic','Diorama'].every((name) => text.includes(name)), controls: ['Resolution scale','Antialiasing','Shadow quality','Motion','Contact shadows','Macro depth','Emissive bloom','Atmosphere'].every((name) => text.includes(name)), width: Math.round(rect?.width ?? 0), centered: Boolean(rect && Math.abs((rect.left + rect.width / 2) - innerWidth / 2) < 3), unclipped: Boolean(rect && rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight) }; })()`);
  await clickByText(".quality-preset-grid button", "Performance");
  await clickByText(".display-settings-footer button", "Apply settings");
  await delay(700);
  const performanceApplied = await evaluateValue(`(() => { const canvas = document.querySelector('.scene-viewport canvas'); return { quality: canvas?.dataset.lightingQuality ?? '', shadowResolution: canvas?.dataset.shadowResolution ?? '', antialiasing: canvas?.dataset.antialiasing ?? '', renderScale: Number(canvas?.dataset.renderScale ?? 0), depthOfField: canvas?.dataset.depthOfField ?? '', volumetricFog: canvas?.dataset.volumetricFog ?? '', postProcessGraph: canvas?.dataset.postProcessGraph ?? '' }; })()`);
  const performanceScreenshot = process.env.DNDROM_SMOKE_PERFORMANCE_SCREENSHOT
    ? await command("Page.captureScreenshot", { format: "png", fromSurface: true })
    : null;
  await evaluateValue(`(() => { const button = document.querySelector('[aria-label="Open display settings"]'); if (!(button instanceof HTMLElement)) return false; button.click(); return true; })()`);
  await delay(100);
  await clickByText(".quality-preset-grid button", "Balanced");
  await clickByText(".display-settings-footer button", "Apply settings");
  await delay(700);
  const balancedApplied = await evaluateValue(`(() => { const canvas = document.querySelector('.scene-viewport canvas'); return { quality: canvas?.dataset.lightingQuality ?? '', shadowResolution: canvas?.dataset.shadowResolution ?? '', antialiasing: canvas?.dataset.antialiasing ?? '', renderScale: Number(canvas?.dataset.renderScale ?? 0), depthOfField: canvas?.dataset.depthOfField ?? '', volumetricFog: canvas?.dataset.volumetricFog ?? '', postProcessGraph: canvas?.dataset.postProcessGraph ?? '' }; })()`);
  const balancedScreenshot = process.env.DNDROM_SMOKE_BALANCED_SCREENSHOT
    ? await command("Page.captureScreenshot", { format: "png", fromSurface: true })
    : null;
  await evaluateValue(`(() => { const button = document.querySelector('[aria-label="Open display settings"]'); if (!(button instanceof HTMLElement)) return false; button.click(); return true; })()`);
  await delay(100);
  await clickByText(".quality-preset-grid button", "Cinematic");
  await clickByText(".display-settings-footer button", "Apply settings");
  await delay(900);
  const cinematicApplied = await evaluateValue(`(() => { const canvas = document.querySelector('.scene-viewport canvas'); return { quality: canvas?.dataset.lightingQuality ?? '', depthOfField: canvas?.dataset.depthOfField ?? '', focusRange: Number(canvas?.dataset.depthOfFieldRange ?? 0), focusMode: canvas?.dataset.depthOfFieldFocusMode ?? '', focusTargets: Number(canvas?.dataset.depthOfFieldTargets ?? 0), blurRadius: Number(canvas?.dataset.depthOfFieldBlurRadius ?? 0), nearBlur: canvas?.dataset.depthOfFieldNearBlur ?? '', volumetricFog: canvas?.dataset.volumetricFog ?? '', postProcessGraph: canvas?.dataset.postProcessGraph ?? '' }; })()`);
  const cinematicScreenshot = process.env.DNDROM_SMOKE_CINEMATIC_SCREENSHOT
    ? await command("Page.captureScreenshot", { format: "png", fromSurface: true })
    : null;
  await evaluateValue(`(() => { const button = document.querySelector('[aria-label="Open display settings"]'); if (!(button instanceof HTMLElement)) return false; button.click(); return true; })()`);
  await delay(100);
  await clickByText(".quality-preset-grid button", "Diorama");
  const displaySettingsScreenshot = process.env.DNDROM_SMOKE_DISPLAY_SETTINGS_SCREENSHOT
    ? await command("Page.captureScreenshot", { format: "png", fromSurface: true })
    : null;
  await clickByText(".display-settings-footer button", "Apply settings");
  await delay(1100);
  const dioramaApplied = await evaluateValue(`(() => { const saved = JSON.parse(localStorage.getItem('dndrom.displaySettings.v1') ?? '{}'); const canvas = document.querySelector('.scene-viewport canvas'); return { saved: saved.quality === 'diorama', quality: canvas?.dataset.lightingQuality ?? '', display: canvas?.dataset.displayQuality ?? '', shadowResolution: canvas?.dataset.shadowResolution ?? '', antialiasing: canvas?.dataset.antialiasing ?? '', renderScale: Number(canvas?.dataset.renderScale ?? 0), depthOfField: canvas?.dataset.depthOfField ?? '', focusRange: Number(canvas?.dataset.depthOfFieldRange ?? 0), focusMode: canvas?.dataset.depthOfFieldFocusMode ?? '', focusTargets: Number(canvas?.dataset.depthOfFieldTargets ?? 0), blurRadius: Number(canvas?.dataset.depthOfFieldBlurRadius ?? 0), nearBlur: canvas?.dataset.depthOfFieldNearBlur ?? '', volumetricFog: canvas?.dataset.volumetricFog ?? '', postProcessGraph: canvas?.dataset.postProcessGraph ?? '' }; })()`);
  const dioramaScreenshot = process.env.DNDROM_SMOKE_DIORAMA_SCREENSHOT
    ? await command("Page.captureScreenshot", { format: "png", fromSurface: true })
    : null;
  await evaluateValue(`(() => { const button = document.querySelector('[aria-label="Open display settings"]'); if (!(button instanceof HTMLElement)) return false; button.click(); return true; })()`);
  await delay(100);
  await clickByText(".quality-preset-grid button", "Balanced");
  await clickByText(".display-settings-footer button", "Apply settings");
  await delay(700);

  await clickByText(".scene-current-button", "Scene");
  const sceneLedgerOpen = await evaluateValue("Boolean(document.querySelector('[aria-label=\"Campaign scenes\"]')?.textContent?.includes('Run parallel scenes'))");
  await evaluateValue(`(() => { const input = document.querySelector('.scene-create-card > input'); if (!input) return false; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'Packaged split scene'); input.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  await delay(100);
  await clickByText(".scene-create-card button", "Create and switch");
  await clickByText(".scene-current-button", "Packaged split scene");
  const splitSceneCreated = await evaluateValue("document.querySelectorAll('.scene-card-list article').length === 2");
  await evaluateValue(`(() => { const button = document.querySelector('.scene-card-list article:not(.active) > button:first-child'); if (!button) return false; button.click(); return true; })()`);
  await delay(180);
  const sceneResumed = await evaluateValue("document.querySelector('.scene-current-button small')?.textContent?.includes('of 2') ?? false");
  await clickByText(".map-toolbar button", "Square");
  await delay(220);
  const gridShader = await evaluateValue(`(() => { const canvas = document.querySelector('.scene-viewport canvas'); return { shape: canvas?.dataset.gridShape ?? '', projection: canvas?.dataset.gridProjection ?? '', visible: canvas?.dataset.gridVisible ?? '' }; })()`);

  await clickByText("button", "AI scenery studio");
  const sceneryInspection = await evaluateValue(`(() => {
    const dialog = document.querySelector('[aria-label="AI Gaussian scenery studio"]');
    if (!dialog) return { ok: false, width: 0, unclipped: false };
    const text = dialog.textContent ?? "";
    const rect = dialog.getBoundingClientRect();
    const edgeNode = document.elementFromPoint(rect.right - 8, rect.top + 18);
    const canvas = dialog.querySelector('.scene-creator-stage canvas');
    const left = dialog.querySelector('.creator-sidebar-left');
    const right = dialog.querySelector('.creator-sidebar-right');
    const context = dialog.querySelector('.world-context-toggle');
    const contextInput = context?.querySelector('input[type="checkbox"]');
    const contextText = context?.querySelector('span');
    const inputRect = contextInput?.getBoundingClientRect();
    const textRect = contextText?.getBoundingClientRect();
    return {
      ok: text.includes("Conjure a world from an idea") && text.includes("Playable region") && text.includes("Create two world plans") && text.includes("Scene catalogue") && text.includes("Online library") && text.includes("Local workflows") && text.includes("3D SplatKit") && text.includes("Lighting engine") && text.includes("HDRI / IBL") && text.includes("Sun / moon key") && Boolean(canvas && left && right),
      width: Math.round(rect.width),
      unclipped: Boolean(edgeNode && dialog.contains(edgeNode)),
      canvasWidth: canvas?.clientWidth ?? 0,
      canvasHeight: canvas?.clientHeight ?? 0,
      contextReadable: Boolean(inputRect && textRect && inputRect.width <= 20 && textRect.width >= 120 && textRect.right <= context.getBoundingClientRect().right),
      sidebarsNoHorizontalOverflow: Boolean(left && right && left.scrollWidth <= left.clientWidth + 1 && right.scrollWidth <= right.clientWidth + 1),
    };
  })()`);
  const sceneryAutomaticSetup = await evaluateValue(`document.querySelector('[aria-label="AI Gaussian scenery studio"]')?.textContent?.includes('No manual setup') ?? false`);
  let proceduralWorld = null;
  let proceduralWorldScreenshot = null;
  if (process.env.DNDROM_SMOKE_PROCEDURAL_WORLD === "1") {
    const promptSet = await evaluateValue(`(() => {
      const studio = document.querySelector('[aria-label="AI Gaussian scenery studio"]');
      const description = [...(studio?.querySelectorAll('textarea') ?? [])].find((entry) => entry.closest('label')?.textContent?.includes('Describe the world'));
      const biome = [...(studio?.querySelectorAll('select') ?? [])].find((entry) => entry.closest('label')?.textContent?.includes('Biome'));
      const size = [...(studio?.querySelectorAll('select') ?? [])].find((entry) => entry.closest('label')?.textContent?.includes('Size'));
      if (!(description instanceof HTMLTextAreaElement) || !(biome instanceof HTMLSelectElement) || !(size instanceof HTMLSelectElement)) return false;
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(description, 'A bright swamp settlement with raised paths, a river, old trees, and a ruined bell tower');
      description.dispatchEvent(new Event('input', { bubbles: true }));
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set?.call(biome, 'swamp');
      biome.dispatchEvent(new Event('change', { bubbles: true }));
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set?.call(size, 'medium');
      size.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);
    if (!promptSet) throw new Error("Could not configure the packaged procedural-world prompt");
    await delay(120);
    await clickByText('[aria-label="AI Gaussian scenery studio"] button', "Create two world plans");
    await waitForValue(`document.querySelectorAll('[aria-label="World concept review"] > button').length === 2`);
    await clickByText('[aria-label="AI Gaussian scenery studio"] button', "Build playable world");
    await waitForValue(`(() => { const studio = document.querySelector('[aria-label="AI Gaussian scenery studio"]'); const canvas = studio?.querySelector('.scene-creator-stage canvas'); const visible = Number(canvas?.dataset.visibleWorldChunks ?? 0), resident = Number(canvas?.dataset.residentWorldChunks ?? 0); return Boolean(studio?.textContent?.includes('ValidationPassed') && canvas?.dataset.worldSun === 'directional-readability-floor' && visible === 64 && resident === visible); })()`, 90_000);
    if (process.env.DNDROM_SMOKE_WORLD_ZOOM === "1") {
      await evaluateValue(`(() => { const canvas = document.querySelector('[aria-label="AI Gaussian scenery studio"] .scene-creator-stage canvas'); if (!canvas) return false; for (let index = 0; index < 3; index++) canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: -320, bubbles: true, cancelable: true })); return true; })()`);
      await delay(650);
    }
    await delay(350);
    proceduralWorld = await evaluateValue(`(() => {
      const studio = document.querySelector('[aria-label="AI Gaussian scenery studio"]');
      const canvas = studio?.querySelector('.scene-creator-stage canvas');
      return {
        concepts: studio?.querySelectorAll('[aria-label="World concept review"] > button').length ?? 0,
        validation: studio?.textContent?.includes('ValidationPassed') ?? false,
        sun: canvas?.dataset.worldSun ?? '',
        sunIntensity: Number(canvas?.dataset.worldSunIntensity ?? 0),
        visibleChunks: Number(canvas?.dataset.visibleWorldChunks ?? 0),
        residentChunks: Number(canvas?.dataset.residentWorldChunks ?? 0),
        terrainPipeline: canvas?.dataset.worldTerrainPipeline ?? '',
        roadRendering: canvas?.dataset.worldRoadRendering ?? '',
        waterRendering: canvas?.dataset.worldWaterRendering ?? '',
        grassRendering: canvas?.dataset.worldGrassRendering ?? '',
        graphicsBackend: canvas?.dataset.graphicsBackend ?? '',
        worldCompute: canvas?.dataset.worldCompute ?? '',
        webgpuExposed: Boolean(navigator.gpu),
        secureContext: window.isSecureContext,
        rendererOrigin: location.origin,
        foliageRendering: canvas?.dataset.worldFoliageRendering ?? '',
        buildingRendering: canvas?.dataset.worldBuildingRendering ?? '',
        cloudRendering: canvas?.dataset.worldCloudRendering ?? '',
        terrainShadows: canvas?.dataset.worldTerrainShadows ?? '',
        vegetationWind: canvas?.dataset.worldVegetationWind ?? '',
        bridgeCount: Number(canvas?.dataset.worldBridgeCount ?? 0),
        shadowDistance: Number(canvas?.dataset.shadowDistance ?? 0),
        animatedShaderTime: Number(canvas?.dataset.animatedShaderTime ?? 0),
        animatedShaderCount: Number(canvas?.dataset.animatedShaderCount ?? 0),
      };
    })()`);
    const animationClip = await evaluateValue(`(() => { const rect = document.querySelector('[aria-label="AI Gaussian scenery studio"] .scene-creator-stage canvas')?.getBoundingClientRect(); return rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height, scale: 1 } : null; })()`);
    if (animationClip) {
      const animationBefore = await command("Page.captureScreenshot", { format: "png", fromSurface: true, clip: animationClip });
      await delay(650);
      const animationAfter = await command("Page.captureScreenshot", { format: "png", fromSurface: true, clip: animationClip });
      proceduralWorld.animationFrameChanged = animationBefore.data !== animationAfter.data;
    } else proceduralWorld.animationFrameChanged = false;
    proceduralWorld.shaderFailures = failures.filter((message) => /shader|sampler3D|uSceneDepthMap|uSceneColorMap|WebGL.*(?:error|invalid)/i.test(message));
    proceduralWorldScreenshot = process.env.DNDROM_SMOKE_WORLD_SCREENSHOT
      ? await command("Page.captureScreenshot", { format: "png", fromSurface: true })
      : null;
    if (process.env.DNDROM_SMOKE_WORLD_SCREENSHOT && proceduralWorldScreenshot?.data) {
      await writeFile(path.resolve(process.env.DNDROM_SMOKE_WORLD_SCREENSHOT), Buffer.from(proceduralWorldScreenshot.data, "base64"));
    }
    if (process.env.DNDROM_SMOKE_WORLD_CLOSE_SCREENSHOT && animationClip) {
      const x = animationClip.x + animationClip.width * .5, y = animationClip.y + animationClip.height * .48;
      await command("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
      for (let index = 0; index < 4; index++) {
        await command("Input.dispatchMouseEvent", { type: "mouseWheel", x, y, deltaX: 0, deltaY: -360 });
        await delay(120);
      }
      await delay(700);
      const closeScreenshot = await command("Page.captureScreenshot", { format: "png", fromSurface: true });
      if (closeScreenshot?.data) await writeFile(path.resolve(process.env.DNDROM_SMOKE_WORLD_CLOSE_SCREENSHOT), Buffer.from(closeScreenshot.data, "base64"));
    }
    proceduralWorld.runtimeMessages = failures.slice(-12);
  }
  const fogEnabled = await evaluateValue(`(() => { const label = [...document.querySelectorAll('[aria-label="AI Gaussian scenery studio"] label')].find((node) => node.textContent?.includes('Fog of war')); const input = label?.querySelector('input[type="checkbox"]'); if (!input) return false; if (!input.checked) input.click(); return true; })()`);
  const sceneryStudio = sceneryInspection.ok && sceneryAutomaticSetup && sceneryInspection.width >= 700 && sceneryInspection.unclipped && sceneryInspection.canvasWidth >= 300 && sceneryInspection.canvasHeight >= 300 && sceneryInspection.contextReadable && sceneryInspection.sidebarsNoHorizontalOverflow;
  const sceneryScreenshot = process.env.DNDROM_SMOKE_SCENERY_SCREENSHOT
    ? await command("Page.captureScreenshot", { format: "png", fromSurface: true })
    : null;
  let onlineLibrary = null;
  if (process.env.DNDROM_SMOKE_ONLINE_LIBRARY === "1") {
    await clickByText("[aria-label=\"AI Gaussian scenery studio\"] button", "Online library");
    await delay(3500);
    onlineLibrary = await evaluateValue("document.querySelectorAll('.hdri-grid > button').length > 0");
  }
  await clickByText(".creator-page-actions button", "Tabletop");
  await delay(250);
  const fogShader = await evaluateValue(`(() => { const canvas = document.querySelector('.scene-viewport canvas'); return { pipeline: canvas?.dataset.fogMaskPipeline ?? '', channels: canvas?.dataset.fogMaskChannels ?? '', revealers: Number(canvas?.dataset.fogRevealerCount ?? 0) }; })()`);
  await clickByText("button", "AI scenery studio");
  await evaluateValue(`(() => { const label = [...document.querySelectorAll('[aria-label="AI Gaussian scenery studio"] label')].find((node) => node.textContent?.includes('Fog of war')); const input = label?.querySelector('input[type="checkbox"]'); if (!input) return false; if (input.checked) input.click(); return true; })()`);
  await clickByText(".creator-page-actions button", "Tabletop");
  await clickByText("button", "Character Forge");
  const hexSelected = await evaluateValue(`(() => { const select = document.querySelector('[aria-label="Character Forge"] .token-base-column select'); if (!select) return false; select.value = 'hex'; select.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  await delay(250);
  const forgeInspection = await evaluateValue(`(() => { const dialog = document.querySelector('[aria-label="Character Forge"]'); const canvas = dialog?.querySelector('.token-model-preview canvas'); const text = dialog?.textContent ?? ''; const required = ['Turn a drawing into a tabletop token','Included Pixal3D / TRELLIS.2 workflow','Generate character now','Draft autosaved locally','Attached character sheet','No manual setup','Paint & shade drawing','Prompt-edit current 3D style','Skeleton & skinning','Auto-rig this style','Attach an existing rig','Forms & animation','Rig style','Author motion','Save states']; const missing = required.filter((entry) => !text.includes(entry)); const motionNames = [...(dialog?.querySelectorAll('input[aria-label="Animation name"]') ?? [])].map((input) => input.value); const art = dialog?.querySelector('[aria-label="Character source artwork"]'); const artRect = art?.getBoundingClientRect(); return { ok: missing.length === 0 && motionNames.includes('Ready idle') && motionNames.includes('Primary attack') && Boolean(canvas), missing, motionNames, sourceArtHeight: Math.round(artRect?.height ?? 0), sourceArtFit: art?.querySelector('img') ? getComputedStyle(art.querySelector('img')).objectFit : '', width: canvas?.width ?? 0, height: canvas?.height ?? 0, clientWidth: canvas?.clientWidth ?? 0, clientHeight: canvas?.clientHeight ?? 0, state: canvas?.dataset.previewState ?? '', forms: dialog?.querySelectorAll('[aria-label="Token forms"] [role="tab"]').length ?? 0, motions: dialog?.querySelectorAll('.animation-slot').length ?? 0 }; })()`);
  const characterForge = forgeInspection.ok;
  await delay(500);
  let forgeScreenshot = null;
  const documentNode = await command("DOM.getDocument", { depth: -1, pierce: true });
  const modelInput = await command("DOM.querySelector", { nodeId: documentNode.root.nodeId, selector: '[aria-label="Character Forge"] input[accept*=".glb"]' });
  if (!modelInput.nodeId) throw new Error("Could not find the packaged Character Forge GLB input");
  await command("DOM.setFileInputFiles", { nodeId: modelInput.nodeId, files: [smokeModelPath] });
  await delay(650);
  const forgeScaleChanged = await evaluateValue(`(() => { const page = document.querySelector('[aria-label="Character Forge"]'); const canvas = page?.querySelector('.token-model-preview canvas'); const label = [...(page?.querySelectorAll('label') ?? [])].find((node) => node.textContent?.includes('Model normalization')); const input = label?.querySelector('input[type="range"]'); if (!(input instanceof HTMLInputElement) || !(canvas instanceof HTMLCanvasElement)) return false; canvas.dataset.smokeLoadBeforeScale = canvas.dataset.modelLoadCount ?? ''; const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set; setter?.call(input, '2'); input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  await delay(180);
  const forgeScaleInspection = await evaluateValue(`(() => { const canvas = document.querySelector('[aria-label="Character Forge"] .token-model-preview canvas'); return { changed: ${forgeScaleChanged}, loadBefore: Number(canvas?.dataset.smokeLoadBeforeScale ?? 0), loadAfter: Number(canvas?.dataset.modelLoadCount ?? 0), grounding: canvas?.dataset.modelGrounding ?? '', gap: Number(canvas?.dataset.modelGroundingGap ?? Number.NaN), transform: canvas?.dataset.modelTransform ?? '' }; })()`);
  const rigInput = await command("DOM.querySelector", { nodeId: documentNode.root.nodeId, selector: '[aria-label="Character Forge"] .rig-import-button input[type="file"]' });
  if (!rigInput.nodeId) throw new Error("Could not find the per-style rig importer");
  await command("DOM.setFileInputFiles", { nodeId: rigInput.nodeId, files: [smokeModelPath] });
  await delay(180);
  const forgeRigAttached = await evaluateValue(`(() => { const page = document.querySelector('[aria-label="Character Forge"]'); const text = page?.querySelector('.style-rig-status')?.textContent ?? ''; return text.includes('Rig ready') && text.includes('packaged-smoke-miniature.glb'); })()`);
  const alternateStateInput = await command("DOM.querySelector", { nodeId: documentNode.root.nodeId, selector: '[aria-label="Character Forge"] .add-state-button input[type="file"]' });
  if (!alternateStateInput.nodeId) throw new Error("Could not find the Character Forge form importer");
  await command("DOM.setFileInputFiles", { nodeId: alternateStateInput.nodeId, files: [smokeModelPath] });
  await delay(300);
  const forgeMotionReused = await evaluateValue(`(() => { const editor = document.querySelector('[aria-label="Token forms and animations"]'); const select = editor?.querySelector('[aria-label="Reusable animation"]'); if (!(select instanceof HTMLSelectElement) || select.options.length < 2) return false; select.value = select.options[1].value; select.dispatchEvent(new Event('change', { bubbles: true })); const apply = [...(editor?.querySelectorAll('button') ?? [])].find((button) => button.textContent?.includes('Apply copy')); queueMicrotask(() => apply?.click()); return true; })()`);
  await delay(120);
  const forgeReusedMotionCount = await evaluateValue(`document.querySelectorAll('[aria-label="Token forms and animations"] .animation-slot').length`);
  await evaluateValue(`(() => { const firstForm = document.querySelector('[aria-label="Token forms"] [role="tab"]'); if (!(firstForm instanceof HTMLElement)) return false; firstForm.click(); return true; })()`);
  await delay(100);
  await clickByText('[aria-label="Token forms and animations"] button', "Style");
  await delay(100);
  const forgeAnimationAuthoring = await evaluateValue(`(() => { const page = document.querySelector('[aria-label="Character Forge"]'); const editor = page?.querySelector('[aria-label="Token forms and animations"]'); const right = page?.querySelector('.creator-sidebar-right'); if (right instanceof HTMLElement && editor instanceof HTMLElement) right.scrollTop = Math.max(0, editor.offsetTop - 24); const text = editor?.textContent ?? ''; return { exists: Boolean(editor), forms: editor?.querySelectorAll('[aria-label="Token forms"] [role="tab"]').length ?? 0, styles: editor?.querySelectorAll('[aria-label="Token styles"] [role="tab"]').length ?? 0, defaultMotions: editor?.querySelectorAll('.animation-slot').length ?? 0, promptFields: editor?.querySelectorAll('textarea').length ?? 0, optionalHyMotion: text.includes('Generate HY-Motion'), attachedClip: text.includes('Attach FBX/animated GLB'), reusableMotion: Boolean(editor?.querySelector('[aria-label="Reusable animation"]')), actualClipOnly: text.includes('tabletop stays static until the character has a real embedded skeletal clip'), versionHistory: text.includes('Local version history'), styleRig: page?.querySelector('.style-rig-status')?.textContent?.includes('Rig ready') ?? false }; })()`);
  const drawingInput = await command("DOM.querySelector", { nodeId: documentNode.root.nodeId, selector: '[aria-label="Character Forge"] input[accept^="image/png"]' });
  if (!drawingInput.nodeId) throw new Error("Could not find the packaged Character Forge drawing input");
  await command("DOM.setFileInputFiles", { nodeId: drawingInput.nodeId, files: [smokeDrawingPath] });
  await delay(180);
  const forgeSourceArtwork = await evaluateValue(`(() => { const art = document.querySelector('[aria-label="Character source artwork"]'); const image = art?.querySelector('img'); const rect = art?.getBoundingClientRect(); return { visible: Boolean(image), height: Math.round(rect?.height ?? 0), fit: image ? getComputedStyle(image).objectFit : '', imageHeight: Math.round(image?.getBoundingClientRect().height ?? 0) }; })()`);
  await clickByText('[aria-label="Character Forge"] button', "Paint & shade drawing");
  await delay(180);
  const forgePaintAssistant = await evaluateValue(`(() => { const studio = document.querySelector('[aria-label="Sketch paint and shade editor"]'); const assistant = studio?.querySelector('[aria-label="AI paint and shading assistant"]'); const tools = [...(studio?.querySelectorAll('[aria-label="Painting tools"] button') ?? [])]; const text = studio?.textContent ?? ''; return { open: Boolean(studio), assistant: Boolean(assistant), color: Boolean(studio?.querySelector('input[type="color"]')), influence: Boolean(assistant?.querySelector('input[type="range"]')), tools: tools.length, iconTooltips: tools.every((button) => Boolean(button.getAttribute('aria-label')) && Boolean(button.getAttribute('data-tooltip'))), compactRail: Boolean(studio?.querySelector('.sketch-tool-rail')), contextualPanel: Boolean(studio?.querySelector('.sketch-properties-panel')), giantFooterAbsent: !studio?.querySelector(':scope > footer'), shadeAction: text.includes('Shade character only'), restoreSupported: text.includes('Original protected') && text.includes('Restore upload'), maskBound: text.includes('Mask-bound local inpainting') }; })()`);
  const forgePaintScreenshot = process.env.DNDROM_SMOKE_PAINT_SCREENSHOT
    ? await command("Page.captureScreenshot", { format: "png", fromSurface: true })
    : null;
  await clickByText('[aria-label="Sketch paint and shade editor"] button', "Close");
  await delay(100);
  forgeScreenshot = process.env.DNDROM_SMOKE_FORGE_SCREENSHOT
    ? await command("Page.captureScreenshot", { format: "png", fromSurface: true })
    : null;
  await clickByText('[aria-label="Character Forge"] button', "Add imported model to library");
  await delay(450);
  await clickByText('[aria-label="Character Forge"] .creator-page-actions button', "Character catalogue");
  await delay(180);
  const miniatureSaved = await evaluateValue("document.querySelector('[aria-label=\"Character catalogue\"]')?.textContent?.includes('New miniature') ?? false");
  const catalogueForgeButton = await evaluateValue(`(() => { const dialog = document.querySelector('[aria-label="Character catalogue"]'); const search = dialog?.querySelector('.catalogue-search input'); const button = [...(dialog?.querySelectorAll('button') ?? [])].find((entry) => entry.textContent?.includes('Open in editor')); if (!(search instanceof HTMLInputElement) || !(button instanceof HTMLElement)) return false; const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set; setter?.call(search, 'New miniature'); search.dispatchEvent(new Event('input', { bubbles:true })); button.click(); return true; })()`);
  await delay(650);
  const forgeCatalogueReload = await evaluateValue(`(() => { const page = document.querySelector('[aria-label="Character Forge"]'); const art = page?.querySelector('[aria-label="Character source artwork"] img'); return { opened: ${catalogueForgeButton}, forms: page?.querySelectorAll('[aria-label="Token forms"] [role="tab"]').length ?? 0, styles: page?.querySelectorAll('[aria-label="Token styles"] [role="tab"]').length ?? 0, sourceRestored: Boolean(art), sourceFit: art ? getComputedStyle(art).objectFit : '', rigRestored: page?.querySelector('.style-rig-status')?.textContent?.includes('Rig ready') ?? false }; })()`);
  await clickByText('[aria-label="Character Forge"] button', "Scenic baseplate creator");
  await delay(450);
  const basePlateDocument = await command("DOM.getDocument", { depth: -1, pierce: true });
  const basePlateImageInput = await command("DOM.querySelector", { nodeId: basePlateDocument.root.nodeId, selector: '[aria-label="Scenic Baseplate Creator"] input[accept="image/png,image/jpeg,image/webp"]' });
  if (!basePlateImageInput.nodeId) throw new Error("Could not find the scenic baseplate concept input");
  await command("DOM.setFileInputFiles", { nodeId: basePlateImageInput.nodeId, files: [smokeDrawingPath] });
  await delay(180);
  await clickByText('[aria-label="Scenic Baseplate Creator"] button', "Approve this image");
  const basePlateLayerControls = await evaluateValue(`(() => { const studio = document.querySelector('[aria-label="Scenic Baseplate Creator"]'); const rows = [...(studio?.querySelectorAll('.functional-layer-list > div') ?? [])]; const disabled = [...(studio?.querySelectorAll('.functional-layer-list button:disabled') ?? [])]; return { randomAddAbsent: !studio?.querySelector('button[title="Add decoration layer"],button[title="Add ambient effect"]'), rulesLayerOnly: rows.length === 1 && rows[0]?.textContent?.includes('plinth'), darkDisabled: disabled.every((button) => { const style=getComputedStyle(button); return style.backgroundColor !== 'rgb(255, 255, 255)' && style.color !== 'rgb(255, 255, 255)'; }) }; })()`);
  const basePlateEdited = await evaluateValue(`(() => { const studio = document.querySelector('[aria-label="Scenic Baseplate Creator"]'); const canvas = studio?.querySelector('.token-model-preview canvas'); const description = studio?.querySelector('textarea'); if (!(description instanceof HTMLTextAreaElement) || !(canvas instanceof HTMLCanvasElement)) return false; canvas.dataset.smokeLoadBeforeBaseEdit = canvas.dataset.modelLoadCount ?? ''; const textSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set; textSetter?.call(description, 'A lily pond with reeds and painted water'); description.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  await delay(250);
  const basePlateStudioInspection = await evaluateValue(`(() => { const studio = document.querySelector('[aria-label="Scenic Baseplate Creator"]'); const canvas = studio?.querySelector('.token-model-preview canvas'); const text = studio?.textContent ?? ''; const buttons = [...(studio?.querySelectorAll('.functional-layer-list button') ?? [])]; const activeConcept = studio?.querySelector('.baseplate-concepts > button.active'); const activeStyle = activeConcept ? getComputedStyle(activeConcept) : null; const conceptBackground = activeStyle?.backgroundColor ?? ''; const save = [...(studio?.querySelectorAll('button') ?? [])].find((button) => button.textContent?.includes('Save revision')); const assign = [...(studio?.querySelectorAll('button') ?? [])].find((button) => button.textContent?.includes('Confirm assignment')); return { exists: Boolean(studio), panels: studio?.querySelectorAll('.baseplate-layout > .fantasy-panel').length ?? 0, concepts: studio?.querySelectorAll('.baseplate-concepts > button').length ?? 0, reviewedImage: Boolean(studio?.querySelector('.baseplate-image-review img')) && text.includes('Approved for Pixal3D') && text.includes('Create scenic base in 3D'), darkConceptSurface: Boolean(conceptBackground && conceptBackground !== 'rgb(255, 255, 255)' && conceptBackground !== 'rgba(255, 255, 255, 1)'), layerControls: ${JSON.stringify(basePlateLayerControls)}, layers: buttons.length, iconTools: buttons.every((button) => Boolean(button.getAttribute('title'))), edited: ${basePlateEdited}, loadBefore: Number(canvas?.dataset.smokeLoadBeforeBaseEdit ?? 0), loadAfter: Number(canvas?.dataset.modelLoadCount ?? 0), requiresMesh: Boolean(save?.disabled && assign?.disabled), explicitAssignment: text.includes('Confirm assignment'), footMask: text.includes('Derive from lowest 12%') && text.includes('Manual painted mask'), safety: text.includes('non-solid overhang is capped at 8%') }; })()`);
  await clickByText('[aria-label="Scenic Baseplate Creator"] button', "Character Forge");
  await delay(180);
  const newCharacterStarted = await evaluateValue(`(() => { const persisted = JSON.parse(localStorage.getItem('dndrom-campaign-v1') ?? '{}')?.state; const button = [...document.querySelectorAll('[aria-label="Character Forge"] .creator-page-actions button')].find((entry) => entry.textContent?.includes('New character')); if (!persisted?.campaign || !(button instanceof HTMLElement)) return false; globalThis.__DNDROM_NEW_CHARACTER_SMOKE__ = { campaignId: persisted.campaign.id, activeSceneId: persisted.campaign.activeSceneId, entityIds: persisted.campaign.map.entities.map((entry) => entry.id), tokenIds: persisted.miniatureLibrary.map((entry) => entry.id) }; button.click(); return true; })()`);
  await delay(1200);
  const newCharacterSafety = await evaluateValue(`(() => { const before = globalThis.__DNDROM_NEW_CHARACTER_SMOKE__; const persisted = JSON.parse(localStorage.getItem('dndrom-campaign-v1') ?? '{}')?.state; const page = document.querySelector('[aria-label="Character Forge"]'); const entityIds = persisted?.campaign?.map?.entities?.map((entry) => entry.id) ?? []; const tokenIds = persisted?.miniatureLibrary?.map((entry) => entry.id) ?? []; return { started: ${newCharacterStarted}, blank: Boolean(page?.textContent?.includes('Generate character now')) && !page?.querySelector('[aria-label="Character source artwork"] img'), campaignKept: persisted?.campaign?.id === before?.campaignId, sceneKept: persisted?.campaign?.activeSceneId === before?.activeSceneId, entitiesKept: JSON.stringify(entityIds) === JSON.stringify(before?.entityIds), catalogueKept: before?.tokenIds?.every((id) => tokenIds.includes(id)) ?? false, errorToast: Boolean(document.querySelector('.toast.error')) }; })()`);
  await clickByText(".creator-page-actions button", "Tabletop");
  await delay(2400);
  const orbitBeforeBuild = await evaluateValue(`(() => { const canvas = document.querySelector('.scene-viewport canvas'); if (!(canvas instanceof HTMLCanvasElement)) return false; const rect = canvas.getBoundingClientRect(); const capture = canvas.setPointerCapture; canvas.setPointerCapture = () => {}; for (let index = 0; index < 6; index++) { const x = rect.left + rect.width * .5, y = rect.top + rect.height * .5; canvas.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 2, pointerId: 70 + index, clientX: x, clientY: y })); canvas.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, button: 2, pointerId: 70 + index, clientX: x + 24, clientY: y + 9 })); canvas.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 2, pointerId: 70 + index, clientX: x + 24, clientY: y + 9 })); } canvas.setPointerCapture = capture; return true; })()`);
  await clickByText(".mode-switcher button", "Play");
  await delay(180);
  await clickByText(".mode-switcher button", "Build");
  await delay(900);
  const buildTransitionSafety = await evaluateValue(`(() => { const previews = [...document.querySelectorAll('.token-asset-preview')]; return { orbit: ${orbitBeforeBuild}, bootFailure: Boolean(document.querySelector('.boot-failure')), tabletop: Boolean(document.querySelector('.scene-viewport canvas')), palette: Boolean(document.querySelector('.asset-palette')), queuedPreviews: previews.every((preview) => preview.getAttribute('data-render-policy') === 'stored-source-image') }; })()`);
  await clickByText(".miniature-library-button", "Character catalogue");
  const miniatureLibraryBefore = await evaluateValue(`(() => { const dialog = document.querySelector('[aria-label="Character catalogue"]'); const text = dialog?.textContent ?? ''; const preview = dialog?.querySelector('.token-asset-preview'); const image = preview?.querySelector('img'); let visiblePixels = 0; if (image instanceof HTMLImageElement && image.naturalWidth) { const sample = document.createElement('canvas'); sample.width = image.naturalWidth; sample.height = image.naturalHeight; const context = sample.getContext('2d'); context?.drawImage(image, 0, 0); const pixels = context?.getImageData(0, 0, sample.width, sample.height).data ?? []; for (let index = 3; index < pixels.length; index += 16) if (pixels[index] > 24) visiblePixels += 1; } return { open: Boolean(dialog), hasToken: text.includes('New miniature'), inCampaign: text.includes('Available in Minis'), preview: Boolean(preview), snapshot: image instanceof HTMLImageElement && image.src.startsWith('data:image/png') && image.naturalWidth >= 128 && image.naturalHeight >= 82, visiblePixels, failed: preview?.classList.contains('failed') ?? false }; })()`);
  const tokenNeededCampaignAdd = await evaluateValue(`(() => { const card = [...document.querySelectorAll('[aria-label="Character catalogue"] article')].find((entry) => entry.querySelector('strong')?.textContent?.includes('New miniature')); const button = [...(card?.querySelectorAll('button') ?? [])].find((entry) => entry.textContent?.includes('Add to campaign')); if (button instanceof HTMLElement) button.click(); return Boolean(button); })()`);
  if (tokenNeededCampaignAdd) await delay(180);
  const removeClicked = await evaluateValue(`(() => { const card = [...document.querySelectorAll('[aria-label="Character catalogue"] article')].find((entry) => entry.querySelector('strong')?.textContent?.includes('New miniature')); const button = [...(card?.querySelectorAll('button') ?? [])].find((entry) => entry.textContent?.includes('Remove from campaign')); if (!(button instanceof HTMLElement)) return false; button.click(); return true; })()`);
  if (!removeClicked) {
    const libraryState = await evaluateValue(`[...document.querySelectorAll('[aria-label="Character catalogue"] article')].map((entry) => ({ name: entry.querySelector('strong')?.textContent ?? '', buttons: [...entry.querySelectorAll('button')].map((button) => button.textContent?.trim() ?? '') }))`);
    throw new Error(`Saved miniature did not become available in the active campaign: ${JSON.stringify(libraryState)}`);
  }
  let miniatureRemovedFromCampaign = false;
  for (let attempt = 0; attempt < 20 && !miniatureRemovedFromCampaign; attempt++) {
    miniatureRemovedFromCampaign = await evaluateValue("Boolean([...document.querySelectorAll('[aria-label=\"Character catalogue\"] button')].find((button) => button.textContent?.includes('Add to campaign'))) ");
    if (!miniatureRemovedFromCampaign) await delay(100);
  }
  if (!miniatureRemovedFromCampaign) throw new Error("Miniature did not leave the active campaign");
  await clickByText('[aria-label="Character catalogue"] button', "Add to campaign");
  let miniatureAddedToCampaign = false;
  for (let attempt = 0; attempt < 20 && !miniatureAddedToCampaign; attempt++) {
    miniatureAddedToCampaign = await evaluateValue("Boolean([...document.querySelectorAll('[aria-label=\"Character catalogue\"] button')].find((button) => button.textContent?.includes('Remove from campaign'))) ");
    if (!miniatureAddedToCampaign) await delay(100);
  }
  await evaluateValue(`(() => { const close = document.querySelector('[aria-label="Character catalogue"] .modal-close'); if (close instanceof HTMLElement) close.click(); return true; })()`);
  await delay(220);
  await evaluateValue(`(() => { const input = document.querySelector('.asset-palette .search-box input'); if (input instanceof HTMLInputElement && input.value) { const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set; setter?.call(input, ''); input.dispatchEvent(new Event('input', { bubbles: true })); } return true; })()`);
  await evaluateValue(`(() => { const tab = [...document.querySelectorAll('.category-tabs button')].find((node) => node.textContent?.includes('Minis')); if (tab instanceof HTMLElement) tab.click(); return true; })()`);
  for (let attempt = 0; attempt < 30; attempt++) {
    const ready = await evaluateValue(`Boolean([...document.querySelectorAll('.asset-card')].find((node) => node.textContent?.includes('New miniature')))`);
    if (ready) break;
    await delay(100);
  }
  const miniatureCard = await evaluateValue(`(() => { const card = [...document.querySelectorAll('.asset-card')].find((node) => node.textContent?.includes('New miniature')); const preview = card?.querySelector('.token-asset-preview'); const canvas = preview?.querySelector('canvas'); const image = preview?.querySelector('img'); let visiblePixels = 0; if (image instanceof HTMLImageElement && image.naturalWidth) { const sample = document.createElement('canvas'); sample.width = image.naturalWidth; sample.height = image.naturalHeight; const context = sample.getContext('2d'); context?.drawImage(image, 0, 0); const pixels = context?.getImageData(0, 0, sample.width, sample.height).data ?? []; for (let index = 3; index < pixels.length; index += 16) if (pixels[index] > 24) visiblePixels += 1; } return { exists: Boolean(card), active: card?.classList.contains('active') ?? false, actualModel: image instanceof HTMLImageElement && image.src.startsWith('data:image/png') && image.naturalWidth >= 128 && image.naturalHeight >= 82, visiblePixels, failed: preview?.classList.contains('failed') ?? false, stage: canvas?.dataset.thumbnailStage ?? 'snapshot', width: preview?.clientWidth ?? 0, height: preview?.clientHeight ?? 0 }; })()`);
  if (!miniatureCard.active) await clickByText(".asset-card", "New miniature");
  const canvasForToken = await evaluateValue(`(() => { const canvas = document.querySelector('.scene-viewport canvas'); if (!canvas) return false; const rect = canvas.getBoundingClientRect(); canvas.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: rect.left + rect.width * .72, clientY: rect.top + rect.height * .72 })); return true; })()`);
  await delay(180);
  const miniatureFloorPlacement = await evaluateValue(`(() => { const status = document.querySelector('.ghost-status'); return { hasGhost: Boolean(status), valid: Boolean(status && !status.classList.contains('invalid')), text: status?.textContent ?? '' }; })()`);
  const miniaturePlaced = await evaluateValue(`(() => { const canvas = document.querySelector('.scene-viewport canvas'); if (!(canvas instanceof HTMLCanvasElement)) return false; const rect = canvas.getBoundingClientRect(); const x = rect.left + rect.width * .72, y = rect.top + rect.height * .72; const capture = canvas.setPointerCapture; canvas.setPointerCapture = () => {}; canvas.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 41, clientX: x, clientY: y })); canvas.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0, pointerId: 41, clientX: x, clientY: y })); canvas.setPointerCapture = capture; return true; })()`);
  await delay(400);
  await clickByText(".asset-card", "Select");
  await evaluateValue(`(() => { const canvas = document.querySelector('.scene-viewport canvas'); if (!(canvas instanceof HTMLCanvasElement)) return false; const rect = canvas.getBoundingClientRect(); const x = rect.left + rect.width * .72, y = rect.top + rect.height * .72; const capture = canvas.setPointerCapture; canvas.setPointerCapture = () => {}; canvas.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 42, clientX: x, clientY: y })); canvas.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0, pointerId: 42, clientX: x, clientY: y })); canvas.setPointerCapture = capture; return true; })()`);
  await delay(300);
  const tokenRuntimeAuthoring = await evaluateValue(`(() => { const controls = document.querySelector('.token-state-controls'); const canvas = document.querySelector('.scene-viewport canvas'); const text = controls?.textContent ?? ''; const selects = controls?.querySelectorAll('select') ?? []; const attack = [...(controls?.querySelectorAll('button') ?? [])].find((button) => button.textContent?.includes('Primary attack')); if (attack instanceof HTMLElement) attack.click(); return { placed: ${miniaturePlaced}, inspector: Boolean(controls), forms: selects[0]?.querySelectorAll('option').length ?? 0, styles: selects[1]?.querySelectorAll('option').length ?? 0, motions: controls?.querySelectorAll('.token-animation-controls button').length ?? 0, independent: text.includes('shapeshift independently'), styleIndependent: text.includes('visual styles share this form'), runtime: canvas?.dataset.tokenAnimationRuntime ?? '', rotationPolicy: canvas?.dataset.tokenRotationPolicy ?? '', proceduralFallback: canvas?.dataset.proceduralMotionFallback ?? '', syntheticRotation: canvas?.dataset.syntheticTokenRotation ?? '', stateful: Number(canvas?.dataset.statefulTokens ?? 0) }; })()`);
  await delay(180);
  let floorPanelSelection = null;
  for (const [xRatio, yRatio] of [[.5, .5], [.4, .54], [.6, .54], [.5, .62], [.34, .62], [.66, .62], [.28, .7], [.72, .7], [.12, .82], [.88, .82]]) {
    await evaluateValue(`(() => { const canvas = document.querySelector('.scene-viewport canvas'); if (!(canvas instanceof HTMLCanvasElement)) return false; const rect = canvas.getBoundingClientRect(); const x = rect.left + rect.width * ${xRatio}, y = rect.top + rect.height * ${yRatio}; const capture = canvas.setPointerCapture; canvas.setPointerCapture = () => {}; canvas.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 51, clientX: x, clientY: y })); canvas.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0, pointerId: 51, clientX: x, clientY: y })); canvas.setPointerCapture = capture; return true; })()`);
    await delay(80);
    floorPanelSelection = await evaluateValue(`(() => { const canvas = document.querySelector('.scene-viewport canvas'); return { assetId: canvas?.dataset.selectedAssetId ?? '', style: canvas?.dataset.selectionStyle ?? '' }; })()`);
    if (/^(floor-|road-|water-)/.test(floorPanelSelection.assetId)) break;
  }
  await clickByText(".mode-switcher button", "Prop");
  await delay(300);
  const propForgeInspection = await evaluateValue(`(() => { const page = document.querySelector('.prop-forge-page'); const text = page?.textContent ?? ''; return { exists: Boolean(page), panels: page?.querySelectorAll('.prop-forge-layout > .fantasy-panel').length ?? 0, references: text.includes('Two reviewed references appear here'), profiles: text.includes('Placement profile'), defaultFaces: text.includes('8,000'), providers: text.includes('Sana 1.5 Lite') && text.includes('Krea 2 Turbo') && text.includes('Krea API') }; })()`);
  const propDocument = await command("DOM.getDocument", { depth: -1, pierce: true });
  const propInput = await command("DOM.querySelector", { nodeId: propDocument.root.nodeId, selector: '.prop-forge-page input[accept*=".glb"]' });
  if (!propInput.nodeId) throw new Error("Could not find the packaged Prop Forge GLB input");
  await command("DOM.setFileInputFiles", { nodeId: propInput.nodeId, files: [smokeModelPath] });
  await delay(550);
  await clickByText(".prop-forge-page button", "Validate and save prop");
  await delay(500);
  const propSaved = await evaluateValue("document.querySelector('.forge-catalogue-button')?.textContent?.includes('1 saved') ?? false");
  await clickByText(".creator-studio-header button", "Board");
  await delay(350);
  await clickByText(".prop-library-button", "Prop catalogue");
  const propCatalogue = await evaluateValue(`(() => { const dialog = document.querySelector('[aria-label="Prop catalogue"]'); const text = dialog?.textContent ?? ''; return { open: Boolean(dialog), saved: text.includes('New tabletop prop'), triangles: text.includes('1 triangles'), editable: [...(dialog?.querySelectorAll('button') ?? [])].some((button) => button.textContent?.includes('Open in Forge')) }; })()`);
  await clickByText('[aria-label="Prop catalogue"] button', "Open in Forge");
  await delay(450);
  const propReopened = await evaluateValue("document.querySelector('.prop-forge-page input')?.value === 'New tabletop prop'");
  await clickByText(".creator-studio-header button", "Board");
  await delay(250);
  await clickByText(".mode-switcher button", "Dice");
  await delay(650);
  const diceForgeInspection = await evaluateValue(`(() => { const page = document.querySelector('[aria-label="Dice Forge"]'); const preview = page?.querySelector('[aria-label="Dice 3D preview"] canvas'); const text = page?.textContent ?? ''; const catalogue = [...(page?.querySelectorAll('button') ?? [])].find((button) => button.textContent?.includes('Dice set catalogue')); return { ok: text.includes('Forge your own physical dice') && text.includes('Download PNG template') && text.includes('Generate texture with local AI') && text.includes('Custom PBR maps') && text.includes('Energy mask') && text.includes('Arcane effects') && text.includes('Generate effects with local AI') && text.includes('Particle system') && text.includes('Preview roll effects') && text.includes('Dice set catalogue') && text.includes('Theme saved automatically') && text.includes('Use for complete set') && Boolean(preview), width: preview?.width ?? 0, height: preview?.height ?? 0, clientWidth: preview?.clientWidth ?? 0, clientHeight: preview?.clientHeight ?? 0, savedThemes: catalogue?.textContent?.includes('1 saved') ? 1 : 0, demoMode: preview?.dataset.effectDemoMode ?? '', cleanShadowPolicy: preview?.dataset.cleanShadowPolicy ?? '', diceSelfShadow: preview?.dataset.diceSelfShadow ?? '', pedestalSelfShadow: preview?.dataset.pedestalSelfShadow ?? '', shadowResolution: preview?.dataset.shadowResolution ?? '', antialiasing: preview?.dataset.antialiasing ?? '', effects: preview?.dataset.diceEffects ?? '', particles: preview?.dataset.diceParticleSystem ?? '' }; })()`);
  const diceForge = diceForgeInspection.ok && diceForgeInspection.clientWidth >= 300 && diceForgeInspection.clientHeight >= 300;
  const diceSceneGenerationBeforeTyping = await evaluateValue("Number(document.querySelector('[aria-label=\"Dice 3D preview\"] canvas')?.dataset.sceneGeneration ?? 0)");
  const diceDescriptionTyped = await evaluateValue(`(() => { const input = document.querySelector('[aria-label="Dice Forge"] textarea'); if (!input) return false; const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set; setter?.call(input, input.value + ' polished'); input.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  await delay(650);
  const diceSceneGenerationAfterTyping = await evaluateValue("Number(document.querySelector('[aria-label=\"Dice 3D preview\"] canvas')?.dataset.sceneGeneration ?? 0)");
  await clickByText('[aria-label="Dice Forge"] button', "Preview roll effects");
  await delay(2300);
  const diceEffectDemoCompleted = await evaluateValue("document.querySelector('[aria-label=\"Dice 3D preview\"] canvas')?.dataset.effectDemoMode === 'complete'");
  await delay(1500);
  const diceEffectDemoStayedComplete = await evaluateValue("document.querySelector('[aria-label=\"Dice 3D preview\"] canvas')?.dataset.effectDemoMode === 'complete'");
  if (process.env.DNDROM_SMOKE_DICE_FORGE_SCREENSHOT) {
    await evaluateValue(`(() => { const sidebar = document.querySelector('[aria-label="Dice material settings"]'); if (!sidebar) return false; sidebar.scrollTop = sidebar.scrollHeight; return true; })()`);
    await delay(180);
  }
  const diceForgeScreenshot = process.env.DNDROM_SMOKE_DICE_FORGE_SCREENSHOT
    ? await command("Page.captureScreenshot", { format: "png", fromSurface: true })
    : null;
  await clickByText('[aria-label="Dice Forge"] button', "Use this theme for d20");
  await delay(250);
  await clickByText(".creator-page-actions button", "Tabletop");
  await clickByText("button", "Generate campaign");
  const campaignCreator = await evaluateValue("Boolean(document.querySelector('[role=dialog][aria-label=\"AI map generator\"]')?.textContent?.includes('What campaign should the DM run?'))");
  await clickByText("[role=dialog] button", "");
  await clickByText(".mode-switcher button", "Play");
  const playMode = await evaluateValue("Boolean(document.querySelector('.app-shell.mode-play') && document.querySelector('.play-party'))");
  const playGridHidden = await evaluateValue(`(() => { const canvas = document.querySelector('.scene-viewport canvas'); const gridControl = [...document.querySelectorAll('.map-toolbar button')].some((button) => button.textContent?.includes('Grid')); return canvas?.dataset.gridVisible === 'false' && !gridControl; })()`);
  const playHudInitiallyHidden = await evaluateValue("!document.querySelector('.play-hud')");
  await clickByText(".play-party > button", "Aria Thorn");
  await delay(180);
  const selectedPlayerHud = await evaluateValue(`(() => { const hud = document.querySelector('.play-hud'), table = document.querySelector('.tabletop-area'), toolbar = document.querySelector('.map-toolbar'); const h = hud?.getBoundingClientRect(), t = table?.getBoundingClientRect(), b = toolbar?.getBoundingClientRect(); return { visible: Boolean(hud && hud.textContent?.includes('Aria Thorn')), atBottom: Boolean(h && t && t.bottom - h.bottom <= 24), clearOfSceneBar: Boolean(h && b && h.top > b.bottom + 8), dismissible: Boolean(hud?.querySelector('[aria-label="Close selected character bar"]')) }; })()`);
  await evaluateValue(`(() => { const button = document.querySelector('[aria-label="Open display settings"]'); if (!(button instanceof HTMLElement)) return false; button.click(); return true; })()`);
  await delay(100);
  await clickByText(".quality-preset-grid button", "Diorama");
  await clickByText(".display-settings-footer button", "Apply settings");
  await delay(900);
  const gameplayFocus = await evaluateValue(`(() => { const canvas = document.querySelector('.scene-viewport canvas'); return { quality: canvas?.dataset.lightingQuality ?? '', mode: canvas?.dataset.depthOfFieldFocusMode ?? '', targets: Number(canvas?.dataset.depthOfFieldTargets ?? 0), range: Number(canvas?.dataset.depthOfFieldRange ?? 0), blurRadius: Number(canvas?.dataset.depthOfFieldBlurRadius ?? 0), nearBlur: canvas?.dataset.depthOfFieldNearBlur ?? '' }; })()`);
  const gameplayFocusScreenshot = process.env.DNDROM_SMOKE_GAMEPLAY_FOCUS_SCREENSHOT
    ? await command("Page.captureScreenshot", { format: "png", fromSurface: true })
    : null;
  await evaluateValue(`(() => { const button = document.querySelector('[aria-label="Open display settings"]'); if (!(button instanceof HTMLElement)) return false; button.click(); return true; })()`);
  await delay(100);
  await clickByText(".quality-preset-grid button", "Balanced");
  await clickByText(".display-settings-footer button", "Apply settings");
  await delay(500);
  await evaluateValue(`(() => { const button = document.querySelector('[aria-label="Close selected character bar"]'); if (!(button instanceof HTMLElement)) return false; button.click(); return true; })()`);
  await delay(100);
  const playHudDismissed = await evaluateValue("!document.querySelector('.play-hud')");
  await clickByText(".panel-tabs button", "Party");
  await delay(250);
  const characterSheet = await evaluateValue(`(() => {
    const sheet = document.querySelector('.character-editor');
    const resource = sheet?.querySelector('.resource-card');
    const pips = [...(resource?.querySelectorAll('.resource-pips button') ?? [])];
    const controls = [...(sheet?.querySelectorAll('input:not([type="file"]), select, textarea, button') ?? [])];
    const rect = sheet?.getBoundingClientRect();
    const textSizes = [...(sheet?.querySelectorAll('.section-label span, .condition-chips button, .sheet-access-row label') ?? [])]
      .map((node) => Number.parseFloat(getComputedStyle(node).fontSize));
    const resourceRect = resource?.getBoundingClientRect();
    const pipStyle = pips[0] ? getComputedStyle(pips[0]) : null;
    const darkControls = controls.filter((node) => {
      const style = getComputedStyle(node);
      const background = style.backgroundColor.match(/[\d.]+/g)?.map(Number) ?? [];
      const color = style.color.match(/[\d.]+/g)?.map(Number) ?? [];
      return background.length >= 3 && color.length >= 3 && background[0] < 45 && background[1] < 45 && background[2] < 45 && color[0] < 90 && color[1] < 90 && color[2] < 90;
    });
    return {
      exists: Boolean(sheet && resource),
      text: sheet?.textContent ?? '',
      noHorizontalOverflow: Boolean(sheet && sheet.scrollWidth <= sheet.clientWidth + 1 && resource && resource.scrollWidth <= resource.clientWidth + 1),
      insidePanel: Boolean(rect && resourceRect && resourceRect.left >= rect.left && resourceRect.right <= rect.right + 1),
      pips: pips.length,
      roundPips: Boolean(pipStyle && Math.abs(Number.parseFloat(pipStyle.width) - Number.parseFloat(pipStyle.height)) < .5 && Number.parseFloat(pipStyle.borderRadius) >= 7),
      labeledPips: pips.every((pip) => Boolean(pip.getAttribute('aria-label')) && pip.hasAttribute('aria-pressed')),
      minimumTextSize: textSizes.length ? Math.min(...textSizes) : 0,
      unreadableControls: darkControls.length,
    };
  })()`);
  const characterSheetScreenshot = process.env.DNDROM_SMOKE_CHARACTER_SHEET_SCREENSHOT
    ? await command("Page.captureScreenshot", { format: "png", fromSurface: true })
    : null;
  await evaluateValue(`(() => { const button = document.querySelector('.character-toolbar button[title="Build a new character"]'); if (!button) return false; button.click(); return true; })()`);
  await delay(200);
  const characterBuilder = await evaluateValue(`(() => {
    const dialog = document.querySelector('[aria-label="Guided character builder"]');
    const rect = dialog?.getBoundingClientRect();
    const edgeNode = rect ? document.elementFromPoint(rect.left + 8, rect.top + 8) : null;
    return {
      exists: Boolean(dialog),
      classes: dialog?.querySelectorAll('.builder-class-grid > button').length ?? 0,
      steps: dialog?.querySelectorAll('.builder-steps > button').length ?? 0,
      licensed: Boolean(dialog?.querySelector('a[href="https://www.dndbeyond.com/srd"]')),
      width: Math.round(rect?.width ?? 0),
      centered: Boolean(rect && Math.abs((rect.left + rect.width / 2) - window.innerWidth / 2) < 2),
      unclipped: Boolean(dialog && edgeNode && dialog.contains(edgeNode)),
      text: dialog?.textContent ?? '',
    };
  })()`);
  const characterBuilderScreenshot = process.env.DNDROM_SMOKE_CHARACTER_BUILDER_SCREENSHOT
    ? await command("Page.captureScreenshot", { format: "png", fromSurface: true })
    : null;
  await clickByText(".builder-steps button", "Equipment");
  const characterBuilderEquipment = await evaluateValue("document.querySelectorAll('.builder-equipment-grid > label').length");
  await clickByText(".builder-steps button", "Review");
  await clickByText(".builder-footer button", "Create character");
  await delay(180);
  const characterBuilderCreated = await evaluateValue("[...document.querySelectorAll('.character-toolbar option')].some((option) => option.textContent?.includes('New Adventurer · Fighter 1'))");
  await clickByText(".mode-switcher button", "Build");
  await delay(250);
  await clickByText(".panel-tabs button", "DM");
  await clickByText(".quick-rolls button", "d20");
  await clickByText(".quick-rolls button", "d20");
  await clickByText(".quick-rolls button", "d6");
  const stagedDice = await evaluateValue(`(() => { const tray = document.querySelector('.dice-tray'); return { expression: tray?.querySelector('.dice-tray-heading strong')?.textContent ?? '', chips: tray?.querySelectorAll('.dice-pool-chips > span').length ?? 0, count: [...(tray?.querySelectorAll('.quick-rolls button em') ?? [])].reduce((sum, node) => sum + Number(node.textContent ?? 0), 0), rollButton: Boolean(tray?.querySelector('.roll-dice-button:not(:disabled)')) }; })()`);
  const priorThrowGeneration = await evaluateValue("Number(document.querySelector('.scene-viewport canvas')?.dataset.diceThrowGeneration ?? 0)");
  await clickByText(".roll-dice-button", "Roll 3 dice");
  await delay(30);
  const rollToastShown = await evaluateValue("Boolean(document.querySelector('.toast.roll'))");
  for (let attempt = 0; attempt < 50; attempt++) {
    const started = await evaluateValue(`(() => { const canvas = document.querySelector('.scene-viewport canvas'); const generation = Number(canvas?.dataset.diceThrowGeneration ?? 0); const progress = Number(canvas?.dataset.diceRollProgress ?? -1); return generation > ${priorThrowGeneration} && progress > 0 && progress < 1; })()`);
    if (started) break;
    await delay(50);
  }
  const earlyRollPose = await evaluateValue(`(() => { const canvas = document.querySelector('.scene-viewport canvas'); return { progress: Number(canvas?.dataset.diceRollProgress ?? -1), quaternion: canvas?.dataset.diceRollQuaternion ?? '' }; })()`);
  await delay(460);
  const middleRollPose = await evaluateValue(`(() => { const canvas = document.querySelector('.scene-viewport canvas'); return { progress: Number(canvas?.dataset.diceRollProgress ?? -1), quaternion: canvas?.dataset.diceRollQuaternion ?? '' }; })()`);
  let diceEffectsScreenshot = null;
  if (process.env.DNDROM_SMOKE_DICE_EFFECTS_SCREENSHOT) {
    for (let attempt = 0; attempt < 45; attempt++) {
      const settled = await evaluateValue("Number(document.querySelector('.scene-viewport canvas')?.dataset.diceRollProgress ?? 0) >= 1");
      if (settled) break;
      await delay(100);
    }
    await delay(150);
    diceEffectsScreenshot = await command("Page.captureScreenshot", { format: "png", fromSurface: true });
    await delay(650);
  }
  // Randomized rigid-body throws do not have a fixed settle duration. Wait on
  // the result state instead of racing the sum-merge animation on slower PCs.
  for (let attempt = 0; attempt < 90; attempt++) {
    const merged = await evaluateValue("document.querySelector('.scene-viewport canvas')?.dataset.diceSumMerge === 'complete'");
    if (merged) break;
    await delay(100);
  }
  const physicalDice = await evaluateValue(`(() => { const canvas = document.querySelector('.scene-viewport canvas'); const rect = canvas?.getBoundingClientRect(); const sum = document.querySelector('.dice-sum-reveal'); const screenX = Number(canvas?.dataset.diceScreenX ?? -1), screenY = Number(canvas?.dataset.diceScreenY ?? -1), spawnScreenX = Number(canvas?.dataset.diceSpawnScreenX ?? -1); return { count: Number(canvas?.dataset.diceThrows ?? 0), batchSize: Number(canvas?.dataset.diceBatchSize ?? 0), total: Number(canvas?.dataset.lastDiceTotal ?? 0), toast: Boolean(document.querySelector('.toast.roll')), diceButtons: document.querySelectorAll('.quick-rolls .dice-face').length, numbered: canvas?.dataset.diceNumbered === 'true', observedMotion: canvas?.dataset.diceObservedMotion === 'true', materialPolicy: canvas?.dataset.tabletopMaterialPolicy ?? '', miniaturePipeline: canvas?.dataset.miniatureMaterialPipeline ?? '', propPipeline: canvas?.dataset.propMaterialPipeline ?? '', resinTransmission: canvas?.dataset.resinTransmission ?? '', winningNumber: Number(canvas?.dataset.diceWinningNumber ?? 0), winningFaceGlow: canvas?.dataset.diceWinningFaceGlow ?? '', resultPresentation: canvas?.dataset.diceResultPresentation ?? '', sumMerge: canvas?.dataset.diceSumMerge ?? '', mergedTotal: Number(canvas?.dataset.diceMergedTotal ?? 0), sumOverlay: sum?.textContent ?? '', randomPhysics: canvas?.dataset.diceMotion === 'rapier-rigid-body-random-toss' && canvas?.dataset.dicePhysics === 'convex-hull-friction-restitution-collisions', rightEntry: spawnScreenX >= .78, innerBoard: canvas?.dataset.diceThrowZone === 'right-to-inner-board' && screenX >= .12 && screenX <= .78 && screenY >= .18 && screenY <= .82, scannedPbr: canvas?.dataset.scannedPbr ?? '', diceThemes: canvas?.dataset.diceThemes ?? '', surfaceEffects: canvas?.dataset.diceSurfaceEffects ?? '', trailEffects: canvas?.dataset.diceTrailEffects ?? '', particleSystem: canvas?.dataset.diceParticleSystem ?? '', impactEffect: canvas?.dataset.diceImpactEffect ?? '', cleanShadowPolicy: canvas?.dataset.cleanShadowPolicy ?? '', ambientModel: canvas?.dataset.ambientModel ?? '', skyAmbient: canvas?.dataset.skyAmbient ?? '', groundAmbient: canvas?.dataset.groundAmbient ?? '', practicalFalloff: canvas?.dataset.practicalLightFalloff ?? '', practicalShadowCasters: Number(canvas?.dataset.practicalShadowCasters ?? -1), lightProbeGrid: canvas?.dataset.lightProbeGrid ?? '', lightProbeCoefficients: canvas?.dataset.lightProbeCoefficients ?? '', ssaoPipeline: canvas?.dataset.ssaoPipeline ?? '', contactShadows: Number(canvas?.dataset.miniatureContactShadows ?? 0), contactShadowPolicy: canvas?.dataset.miniatureContactShadowPolicy ?? '', miniatureRim: canvas?.dataset.miniatureRimLighting ?? '', shadowFiltering: canvas?.dataset.shadowFiltering ?? '', shadowResolution: canvas?.dataset.shadowResolution ?? '', shadowBias: Number(canvas?.dataset.shadowBias ?? 0), shadowNormalOffset: Number(canvas?.dataset.shadowNormalOffset ?? 0), shadowCascades: Number(canvas?.dataset.shadowCascades ?? 0), spawnScreenX, screenX, screenY, rectLeft: rect?.left, rectWidth: rect?.width, offsetWidth: canvas?.offsetWidth, bufferWidth: canvas?.width, dpr: window.devicePixelRatio, innerWidth: window.innerWidth }; })()`);
  const screenshot = await command("Page.captureScreenshot", { format: "png", fromSurface: true });
  const assetPresentation = await evaluateValue(`(() => {
    const cards = [...document.querySelectorAll('.asset-card')];
    const canvases = [...document.querySelectorAll('.asset-card .asset-preview canvas')];
    const firstCard = cards[1], firstPreview = firstCard?.querySelector('.asset-preview');
    if (!firstCard || !firstPreview) return { count: canvases.length, centered: false };
    const cardRect = firstCard.getBoundingClientRect(), previewRect = firstPreview.getBoundingClientRect();
    return { count: canvases.length, centered: Math.abs((cardRect.left + cardRect.width / 2) - (previewRect.left + previewRect.width / 2)) < 2 };
  })()`);
  await clickByText(".asset-card", "Stone Wall");
  const ghostPreview = await evaluateValue(`(() => {
    const canvas = document.querySelector('.scene-viewport canvas');
    if (!canvas) return false;
    const rect = canvas.getBoundingClientRect();
    canvas.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: rect.left + rect.width * .52, clientY: rect.top + rect.height * .58 }));
    return true;
  })()`);
  await delay(180);
  const ghostStatus = await evaluateValue("Boolean(document.querySelector('.ghost-status'))");
  let noGridScreenshot = null;
  if (process.env.DNDROM_SMOKE_NO_GRID_SCREENSHOT) {
    await clickByText("button", "Grid");
    await delay(350);
    noGridScreenshot = await command("Page.captureScreenshot", { format: "png", fromSurface: true });
  }

  return {
    snapshot,
    interactions: { campaignLibraryOpen, newCampaignCreated, campaignResumed, headerLayout, settingsOpened, displaySettingsDialog, performanceApplied, balancedApplied, cinematicApplied, dioramaApplied, gameplayFocus, sceneLedgerOpen, splitSceneCreated, sceneResumed, gridShader, sceneryStudio, sceneryAutomaticSetup, proceduralWorld, fogEnabled, fogShader, sceneryDialogWidth: sceneryInspection.width, sceneryDialogUnclipped: sceneryInspection.unclipped, onlineLibrary, characterForge, hexSelected, forgeInspection, forgeScaleInspection, forgeRigAttached, forgeMotionReused, forgeReusedMotionCount, forgeAnimationAuthoring, forgeSourceArtwork, forgeCatalogueReload, basePlateStudioInspection, forgePaintAssistant, miniatureSaved, newCharacterSafety, buildTransitionSafety, miniatureLibraryBefore, miniatureRemovedFromCampaign, miniatureAddedToCampaign, miniatureCard, canvasForToken, miniatureFloorPlacement, tokenRuntimeAuthoring, floorPanelSelection, propForgeInspection, propSaved, propCatalogue, propReopened, diceForge, diceForgeInspection, diceDescriptionTyped, diceSceneGenerationBeforeTyping, diceSceneGenerationAfterTyping, diceEffectDemoCompleted, diceEffectDemoStayedComplete, campaignCreator, playMode, playGridHidden, playHudInitiallyHidden, selectedPlayerHud, playHudDismissed, characterSheet, characterBuilder, characterBuilderEquipment, characterBuilderCreated, stagedDice, rollToastShown, earlyRollPose, middleRollPose, physicalDice, assetPresentation, ghostPreview, ghostStatus },
    screenshotData: screenshot.data,
    noGridScreenshotData: noGridScreenshot?.data,
    displaySettingsScreenshotData: displaySettingsScreenshot?.data,
    performanceScreenshotData: performanceScreenshot?.data,
    balancedScreenshotData: balancedScreenshot?.data,
    cinematicScreenshotData: cinematicScreenshot?.data,
    dioramaScreenshotData: dioramaScreenshot?.data,
    gameplayFocusScreenshotData: gameplayFocusScreenshot?.data,
    sceneryScreenshotData: sceneryScreenshot?.data,
    proceduralWorldScreenshotData: proceduralWorldScreenshot?.data,
    forgeScreenshotData: forgeScreenshot?.data,
    forgePaintScreenshotData: forgePaintScreenshot?.data,
    diceForgeScreenshotData: diceForgeScreenshot?.data,
    diceEffectsScreenshotData: diceEffectsScreenshot?.data,
    characterSheetScreenshotData: characterSheetScreenshot?.data,
    characterBuilderScreenshotData: characterBuilderScreenshot?.data,
    failures,
  };
};

await access(executable);
const port = await availablePort();
const smokeProfile = await mkdtemp(path.join(os.tmpdir(), "dndrom-smoke-"));
const smokeLocalAppData = path.join(smokeProfile, "local-app-data");
const smokeRoamingAppData = path.join(smokeProfile, "roaming-app-data");
const smokeXdgData = path.join(smokeProfile, "xdg-data");
await Promise.all([
  mkdir(smokeLocalAppData, { recursive: true }),
  mkdir(smokeRoamingAppData, { recursive: true }),
  mkdir(smokeXdgData, { recursive: true }),
]);
const smokeModelPath = path.join(smokeProfile, "packaged-smoke-miniature.glb");
const smokeDrawingPath = path.join(smokeProfile, "packaged-smoke-drawing.png");
await writeFile(smokeModelPath, minimalSelfContainedGlb());
await writeFile(smokeDrawingPath, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=", "base64"));
const child = spawn(executable, [], {
  cwd: path.dirname(executable),
  env: {
    ...process.env,
    DNDROM_SKIP_RUNTIME_BOOTSTRAP: "1",
    // Tauri's native campaign snapshot uses the platform app-data directory,
    // separately from the explicitly isolated WebView2 profile. Keep both
    // stores inside the disposable smoke folder so tests cannot overwrite a
    // player's readable .dndrom autosave.
    LOCALAPPDATA: smokeLocalAppData,
    APPDATA: smokeRoamingAppData,
    XDG_DATA_HOME: smokeXdgData,
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}${process.env.DNDROM_SMOKE_ENABLE_UNSAFE_WEBGPU === "1" ? " --enable-unsafe-webgpu" : ""}`,
    WEBVIEW2_USER_DATA_FOLDER: smokeProfile,
  },
  windowsHide: true,
  stdio: "ignore",
});

let socket;
try {
  const target = await waitForTarget(port, child);
  socket = await connectCdp(target.webSocketDebuggerUrl);
  const { snapshot, interactions, screenshotData, noGridScreenshotData, displaySettingsScreenshotData, performanceScreenshotData, balancedScreenshotData, cinematicScreenshotData, dioramaScreenshotData, gameplayFocusScreenshotData, sceneryScreenshotData, proceduralWorldScreenshotData, forgeScreenshotData, forgePaintScreenshotData, diceForgeScreenshotData, diceEffectsScreenshotData, characterSheetScreenshotData, characterBuilderScreenshotData, failures } = await inspectPage(socket, smokeModelPath, smokeDrawingPath);
  const uniqueFailures = [...new Set(failures)];
  if (!snapshot || snapshot.readyState !== "complete" || snapshot.rootChildren < 1 || !snapshot.rootText.includes("DnDRom")) {
    throw new Error(`Packaged UI did not boot. Snapshot: ${JSON.stringify(snapshot)}${uniqueFailures.length ? `\nWebView failures:\n- ${uniqueFailures.join("\n- ")}` : ""}`);
  }
  if (snapshot.bootStatus?.state !== "ready") throw new Error(`DnDRom did not report a ready boot: ${JSON.stringify(snapshot.bootStatus)}`);
  if (!interactions.campaignLibraryOpen || !interactions.newCampaignCreated || !interactions.campaignResumed || !interactions.sceneLedgerOpen || !interactions.splitSceneCreated || !interactions.sceneResumed || !interactions.sceneryStudio || !interactions.characterForge || !interactions.hexSelected || !interactions.diceForge || !interactions.campaignCreator || !interactions.playMode || !interactions.playGridHidden) {
    throw new Error(`Packaged interaction smoke failed: ${JSON.stringify(interactions)}`);
  }
  if (process.env.DNDROM_SMOKE_PROCEDURAL_WORLD === "1" && (interactions.proceduralWorld?.concepts !== 2 || !interactions.proceduralWorld?.validation || interactions.proceduralWorld?.sun !== "directional-readability-floor" || interactions.proceduralWorld?.sunIntensity < 1.45 || interactions.proceduralWorld?.visibleChunks < 1 || interactions.proceduralWorld?.residentChunks < interactions.proceduralWorld?.visibleChunks || interactions.proceduralWorld?.terrainPipeline !== "warped-fbm+thermal-erosion+one-meter-terraces+catmull-road-deformation" || interactions.proceduralWorld?.roadRendering !== "terrain-weightmap+feathered-spline-decal" || interactions.proceduralWorld?.waterRendering !== "gerstner+dual-normal+depth-beer+screen-refraction+probe-reflection+shore-foam" || interactions.proceduralWorld?.grassRendering !== "dense-landscape-mask+crossed-card-instancing+player-reactive-vertex-wind" || !["webgpu-compute", "webgl2-cpu-culling"].includes(interactions.proceduralWorld?.worldCompute) || interactions.proceduralWorld?.foliageRendering !== "space-colonization+noise-poisson+lod" || interactions.proceduralWorld?.buildingRendering !== "cga-footprint+floors+facade-modules" || interactions.proceduralWorld?.cloudRendering !== "fullscreen-perlin-worley-raymarch+beer-lighting" || interactions.proceduralWorld?.terrainShadows !== "cast-and-receive" || interactions.proceduralWorld?.vegetationWind !== "pbr-vertex-wind+player-bend+animated-shadow" || interactions.proceduralWorld?.bridgeCount < 1 || interactions.proceduralWorld?.shadowDistance < 200 || interactions.proceduralWorld?.animatedShaderTime <= 0 || interactions.proceduralWorld?.animatedShaderCount < 3 || interactions.proceduralWorld?.shaderFailures?.length || !interactions.proceduralWorld?.animationFrameChanged)) {
    throw new Error(`Packaged procedural-world prompt smoke failed: ${JSON.stringify(interactions.proceduralWorld)}`);
  }
  if (!interactions.headerLayout?.full?.sameRow || !interactions.headerLayout?.full?.noOverlap || !interactions.headerLayout?.full?.gearFarRight || interactions.headerLayout?.full?.height > 70 || !interactions.headerLayout?.compact?.secondRow || !interactions.headerLayout?.compact?.noOverlap || !interactions.headerLayout?.compact?.gearFarRight || interactions.headerLayout?.compact?.height < 100) {
    throw new Error(`Packaged responsive-header smoke failed: ${JSON.stringify(interactions.headerLayout)}`);
  }
  if (!interactions.settingsOpened || !interactions.displaySettingsDialog?.open || !interactions.displaySettingsDialog?.tiers || !interactions.displaySettingsDialog?.controls || interactions.displaySettingsDialog?.width < 700 || !interactions.displaySettingsDialog?.centered || !interactions.displaySettingsDialog?.unclipped || !interactions.dioramaApplied?.saved || interactions.dioramaApplied?.quality !== "diorama" || interactions.dioramaApplied?.display !== "diorama" || interactions.dioramaApplied?.shadowResolution !== "4096" || interactions.dioramaApplied?.antialiasing !== "taa" || interactions.dioramaApplied?.renderScale < .99 || interactions.dioramaApplied?.depthOfField !== "macro-near-and-far" || interactions.dioramaApplied?.focusRange < 14 || interactions.dioramaApplied?.focusMode !== "build-wide" || interactions.dioramaApplied?.focusTargets < 4 || interactions.dioramaApplied?.blurRadius > 1 || interactions.dioramaApplied?.nearBlur !== "false" || interactions.dioramaApplied?.volumetricFog !== "24-step" || interactions.dioramaApplied?.postProcessGraph !== "ssao+bloom+dof+fog") {
    throw new Error(`Packaged display-settings smoke failed: ${JSON.stringify({ dialog: interactions.displaySettingsDialog, diorama: interactions.dioramaApplied })}`);
  }
  if (interactions.cinematicApplied?.quality !== "cinematic" || interactions.cinematicApplied?.depthOfField !== "far-field" || interactions.cinematicApplied?.focusMode !== "build-wide" || interactions.cinematicApplied?.focusTargets < 4 || interactions.cinematicApplied?.blurRadius >= interactions.dioramaApplied?.blurRadius || interactions.cinematicApplied?.nearBlur !== "false" || interactions.cinematicApplied?.volumetricFog !== "16-step" || interactions.cinematicApplied?.postProcessGraph !== "ssao+bloom+dof+fog") {
    throw new Error(`Packaged Cinematic/Diorama differentiation smoke failed: ${JSON.stringify({ cinematic: interactions.cinematicApplied, diorama: interactions.dioramaApplied })}`);
  }
  if (interactions.performanceApplied?.quality !== "performance" || interactions.performanceApplied?.shadowResolution !== "1024" || interactions.performanceApplied?.antialiasing !== "msaa" || interactions.performanceApplied?.depthOfField !== "off" || interactions.performanceApplied?.volumetricFog !== "off" || interactions.performanceApplied?.postProcessGraph !== "compose" || interactions.performanceApplied?.renderScale >= interactions.balancedApplied?.renderScale) {
    throw new Error(`Packaged Performance tier smoke failed: ${JSON.stringify(interactions.performanceApplied)}`);
  }
  if (interactions.balancedApplied?.quality !== "balanced" || interactions.balancedApplied?.shadowResolution !== "2048" || interactions.balancedApplied?.antialiasing !== "taa" || interactions.balancedApplied?.depthOfField !== "off" || interactions.balancedApplied?.volumetricFog !== "off" || interactions.balancedApplied?.postProcessGraph !== "ssao+bloom") {
    throw new Error(`Packaged Balanced tier smoke failed: ${JSON.stringify(interactions.balancedApplied)}`);
  }
  if (!interactions.playHudInitiallyHidden || !interactions.selectedPlayerHud?.visible || !interactions.selectedPlayerHud?.atBottom || !interactions.selectedPlayerHud?.clearOfSceneBar || !interactions.selectedPlayerHud?.dismissible || !interactions.playHudDismissed) {
    throw new Error(`Packaged selected-player HUD smoke failed: ${JSON.stringify({ hidden: interactions.playHudInitiallyHidden, selected: interactions.selectedPlayerHud, dismissed: interactions.playHudDismissed })}`);
  }
  if (interactions.gameplayFocus?.quality !== "diorama" || !["active-miniature", "combat-group"].includes(interactions.gameplayFocus?.mode) || interactions.gameplayFocus?.targets < 1 || interactions.gameplayFocus?.range < 6 || interactions.gameplayFocus?.blurRadius < 1.5) {
    throw new Error(`Packaged gameplay autofocus smoke failed: ${JSON.stringify(interactions.gameplayFocus)}`);
  }
  // The optional generated-world pass keeps an isolated Forge draft resident;
  // the ordinary packaged smoke above remains the authoritative fog runtime check.
  if (process.env.DNDROM_SMOKE_PROCEDURAL_WORLD !== "1" && (interactions.gridShader?.shape !== "hex" || interactions.gridShader?.projection !== "world-space-derivative-aa" || interactions.gridShader?.visible !== "true" || !interactions.fogEnabled || interactions.fogShader?.pipeline !== "webgl2-render-texture-10hz" || interactions.fogShader?.channels !== "red-current-green-explored" || interactions.fogShader?.revealers < 1)) {
    throw new Error(`Packaged tabletop shader smoke failed: ${JSON.stringify({ grid: interactions.gridShader, fogEnabled: interactions.fogEnabled, fog: interactions.fogShader })}`);
  }
  if (!interactions.characterSheet?.exists || !interactions.characterSheet?.text?.includes("Damage and healing") || !interactions.characterSheet?.text?.includes("Rest and recovery") || !interactions.characterSheet?.noHorizontalOverflow || !interactions.characterSheet?.insidePanel || !interactions.characterSheet?.roundPips || !interactions.characterSheet?.labeledPips || interactions.characterSheet?.minimumTextSize < 10 || interactions.characterSheet?.unreadableControls > 0) {
    throw new Error(`Packaged character-sheet layout smoke failed: ${JSON.stringify(interactions.characterSheet)}`);
  }
  if (!interactions.characterBuilder?.exists || interactions.characterBuilder?.classes !== 12 || interactions.characterBuilder?.steps !== 6 || !interactions.characterBuilder?.licensed || interactions.characterBuilder?.width < 900 || !interactions.characterBuilder?.centered || !interactions.characterBuilder?.unclipped || !interactions.characterBuilder?.text?.includes("Build an adventurer") || interactions.characterBuilderEquipment < 50 || !interactions.characterBuilderCreated) {
    throw new Error(`Packaged guided-character-builder smoke failed: ${JSON.stringify({ builder: interactions.characterBuilder, equipment: interactions.characterBuilderEquipment, created: interactions.characterBuilderCreated })}`);
  }
  if (interactions.diceForgeInspection?.cleanShadowPolicy !== "caster-only-die-pcf5" || interactions.diceForgeInspection?.diceSelfShadow !== "false" || interactions.diceForgeInspection?.pedestalSelfShadow !== "false" || interactions.diceForgeInspection?.shadowResolution !== "2048" || interactions.diceForgeInspection?.antialiasing !== "taa" || interactions.diceForgeInspection?.savedThemes < 1 || interactions.diceForgeInspection?.demoMode !== "idle" || !interactions.diceEffectDemoCompleted || !interactions.diceEffectDemoStayedComplete || !interactions.diceForgeInspection?.effects?.includes("surface") || !interactions.diceForgeInspection?.effects?.includes("trail") || !interactions.diceForgeInspection?.effects?.includes("impact") || !interactions.diceForgeInspection?.particles?.startsWith("gpu-bounded:")) {
    throw new Error(`Packaged Dice Forge clean-shadow smoke failed: ${JSON.stringify(interactions.diceForgeInspection)}`);
  }
  if (!interactions.diceDescriptionTyped || interactions.diceSceneGenerationBeforeTyping < 1 || interactions.diceSceneGenerationAfterTyping !== interactions.diceSceneGenerationBeforeTyping) {
    throw new Error(`Packaged Dice Forge typing reset regression: ${JSON.stringify({ typed: interactions.diceDescriptionTyped, before: interactions.diceSceneGenerationBeforeTyping, after: interactions.diceSceneGenerationAfterTyping })}`);
  }
  if (interactions.assetPresentation?.count < 6 || !interactions.assetPresentation?.centered || !interactions.ghostPreview || !interactions.ghostStatus) {
    throw new Error(`Packaged build-system smoke failed: ${JSON.stringify(interactions)}`);
  }
  if (!interactions.miniatureSaved || !interactions.miniatureCard?.exists || !interactions.miniatureCard?.actualModel || interactions.miniatureCard?.visiblePixels < 100 || !interactions.canvasForToken || !interactions.miniatureFloorPlacement?.hasGhost || !interactions.miniatureFloorPlacement?.valid || /blocked by .*floor/i.test(interactions.miniatureFloorPlacement?.text ?? "")) {
    throw new Error(`Packaged miniature library/placement smoke failed: ${JSON.stringify(interactions)}`);
  }
  if (!interactions.newCharacterSafety?.started || !interactions.newCharacterSafety?.blank || !interactions.newCharacterSafety?.campaignKept || !interactions.newCharacterSafety?.sceneKept || !interactions.newCharacterSafety?.entitiesKept || !interactions.newCharacterSafety?.catalogueKept || interactions.newCharacterSafety?.errorToast) {
    throw new Error(`Packaged new-character preservation smoke failed: ${JSON.stringify(interactions.newCharacterSafety)}`);
  }
  if (!interactions.buildTransitionSafety?.orbit || interactions.buildTransitionSafety?.bootFailure || !interactions.buildTransitionSafety?.tabletop || !interactions.buildTransitionSafety?.palette || !interactions.buildTransitionSafety?.queuedPreviews) {
    throw new Error(`Packaged rotate-to-build lifecycle smoke failed: ${JSON.stringify(interactions.buildTransitionSafety)}`);
  }
  const lifecycleFailures = uniqueFailures.filter((message) => /Cannot read properties of null \(reading ['"]update['"]\)|DnDRom startup failed|too many active WebGL contexts/i.test(message));
  if (lifecycleFailures.length) throw new Error(`Packaged rendering lifecycle emitted failures:\n- ${lifecycleFailures.join("\n- ")}`);
  if (!interactions.miniatureLibraryBefore?.open || !interactions.miniatureLibraryBefore?.hasToken || !interactions.miniatureLibraryBefore?.inCampaign || !interactions.miniatureLibraryBefore?.preview || !interactions.miniatureLibraryBefore?.snapshot || interactions.miniatureLibraryBefore?.visiblePixels < 100 || interactions.miniatureLibraryBefore?.failed || !interactions.miniatureRemovedFromCampaign || !interactions.miniatureAddedToCampaign) {
    throw new Error(`Packaged campaign miniature-library smoke failed: ${JSON.stringify({ before: interactions.miniatureLibraryBefore, removed: interactions.miniatureRemovedFromCampaign, added: interactions.miniatureAddedToCampaign })}`);
  }
  if (!interactions.forgeScaleInspection?.changed || interactions.forgeScaleInspection?.loadBefore < 1 || interactions.forgeScaleInspection?.loadAfter !== interactions.forgeScaleInspection?.loadBefore || interactions.forgeScaleInspection?.grounding !== "render-bounds" || Math.abs(interactions.forgeScaleInspection?.gap) > 0.0005 || !interactions.forgeScaleInspection?.transform?.startsWith("2.00:")) {
    throw new Error(`Packaged miniature scale/grounding smoke failed: ${JSON.stringify(interactions.forgeScaleInspection)}`);
  }
  if (interactions.forgeInspection?.forms !== 1 || interactions.forgeInspection?.motions !== 2 || interactions.forgeInspection?.sourceArtHeight < 170 || !interactions.forgeRigAttached || !interactions.forgeMotionReused || interactions.forgeReusedMotionCount !== 1 || !interactions.forgeAnimationAuthoring?.exists || interactions.forgeAnimationAuthoring?.forms !== 2 || interactions.forgeAnimationAuthoring?.styles !== 2 || interactions.forgeAnimationAuthoring?.defaultMotions !== 2 || !interactions.forgeAnimationAuthoring?.optionalHyMotion || !interactions.forgeAnimationAuthoring?.attachedClip || !interactions.forgeAnimationAuthoring?.reusableMotion || !interactions.forgeAnimationAuthoring?.actualClipOnly || !interactions.forgeAnimationAuthoring?.versionHistory || !interactions.forgeAnimationAuthoring?.styleRig) {
    throw new Error(`Packaged token form/motion authoring smoke failed: ${JSON.stringify({ initial: interactions.forgeInspection, rigAttached: interactions.forgeRigAttached, motionReused: interactions.forgeMotionReused, reusedMotionCount: interactions.forgeReusedMotionCount, authored: interactions.forgeAnimationAuthoring })}`);
  }
  if (!interactions.forgeSourceArtwork?.visible || interactions.forgeSourceArtwork?.height < 170 || interactions.forgeSourceArtwork?.fit !== "contain" || interactions.forgeSourceArtwork?.imageHeight < 150 || !interactions.forgeCatalogueReload?.opened || interactions.forgeCatalogueReload?.forms !== 2 || interactions.forgeCatalogueReload?.styles !== 2 || !interactions.forgeCatalogueReload?.sourceRestored || interactions.forgeCatalogueReload?.sourceFit !== "contain" || !interactions.forgeCatalogueReload?.rigRestored) {
    throw new Error(`Packaged character catalogue persistence smoke failed: ${JSON.stringify({ source: interactions.forgeSourceArtwork, reloaded: interactions.forgeCatalogueReload })}`);
  }
  if (!interactions.basePlateStudioInspection?.exists || interactions.basePlateStudioInspection?.panels !== 3 || interactions.basePlateStudioInspection?.concepts < 1 || !interactions.basePlateStudioInspection?.reviewedImage || !interactions.basePlateStudioInspection?.darkConceptSurface || !interactions.basePlateStudioInspection?.layerControls?.randomAddAbsent || !interactions.basePlateStudioInspection?.layerControls?.rulesLayerOnly || !interactions.basePlateStudioInspection?.layerControls?.darkDisabled || interactions.basePlateStudioInspection?.layers < 3 || !interactions.basePlateStudioInspection?.iconTools || !interactions.basePlateStudioInspection?.edited || interactions.basePlateStudioInspection?.loadBefore < 1 || interactions.basePlateStudioInspection?.loadAfter !== interactions.basePlateStudioInspection?.loadBefore || !interactions.basePlateStudioInspection?.requiresMesh || !interactions.basePlateStudioInspection?.explicitAssignment || !interactions.basePlateStudioInspection?.footMask || !interactions.basePlateStudioInspection?.safety) {
    throw new Error(`Packaged scenic-baseplate smoke failed: ${JSON.stringify(interactions.basePlateStudioInspection)}`);
  }
  if (!interactions.tokenRuntimeAuthoring?.placed || !interactions.tokenRuntimeAuthoring?.inspector || interactions.tokenRuntimeAuthoring?.forms !== 2 || interactions.tokenRuntimeAuthoring?.styles !== 2 || interactions.tokenRuntimeAuthoring?.motions !== 2 || !interactions.tokenRuntimeAuthoring?.independent || !interactions.tokenRuntimeAuthoring?.styleIndependent || interactions.tokenRuntimeAuthoring?.runtime !== "embedded-glb-skeletal-only-static-without-clip" || interactions.tokenRuntimeAuthoring?.rotationPolicy !== "placed-facing-or-embedded-skeleton" || interactions.tokenRuntimeAuthoring?.proceduralFallback !== "disabled" || interactions.tokenRuntimeAuthoring?.syntheticRotation !== "0" || interactions.tokenRuntimeAuthoring?.stateful < 1) {
    throw new Error(`Packaged token state/runtime smoke failed: ${JSON.stringify(interactions.tokenRuntimeAuthoring)}`);
  }
  if (!/^(floor-|road-|water-)/.test(interactions.floorPanelSelection?.assetId ?? "") || interactions.floorPanelSelection?.style !== "subtle-green-object-overlay") {
    throw new Error(`Packaged floor-panel selection smoke failed: ${JSON.stringify(interactions.floorPanelSelection)}`);
  }
  if (!interactions.propForgeInspection?.exists || interactions.propForgeInspection?.panels !== 3 || !interactions.propForgeInspection?.references || !interactions.propForgeInspection?.profiles || !interactions.propForgeInspection?.defaultFaces || !interactions.propForgeInspection?.providers || !interactions.propSaved || !interactions.propCatalogue?.open || !interactions.propCatalogue?.saved || !interactions.propCatalogue?.triangles || !interactions.propCatalogue?.editable || !interactions.propReopened) {
    throw new Error(`Packaged Prop Forge/catalogue smoke failed: ${JSON.stringify({ forge: interactions.propForgeInspection, saved: interactions.propSaved, catalogue: interactions.propCatalogue, reopened: interactions.propReopened })}`);
  }
  if (!interactions.forgePaintAssistant?.open || !interactions.forgePaintAssistant?.assistant || !interactions.forgePaintAssistant?.color || !interactions.forgePaintAssistant?.influence || interactions.forgePaintAssistant?.tools !== 5 || !interactions.forgePaintAssistant?.iconTooltips || !interactions.forgePaintAssistant?.compactRail || !interactions.forgePaintAssistant?.contextualPanel || !interactions.forgePaintAssistant?.giantFooterAbsent || !interactions.forgePaintAssistant?.shadeAction || !interactions.forgePaintAssistant?.restoreSupported || !interactions.forgePaintAssistant?.maskBound) {
    throw new Error(`Packaged AI paint-assistant smoke failed: ${JSON.stringify(interactions.forgePaintAssistant)}`);
  }
  if (interactions.stagedDice?.count !== 3 || interactions.stagedDice?.chips !== 2 || interactions.stagedDice?.expression !== "2d20 + 1d6" || !interactions.stagedDice?.rollButton || !interactions.rollToastShown || !interactions.physicalDice?.observedMotion || interactions.physicalDice?.count !== 3 || interactions.physicalDice?.batchSize !== 3 || interactions.physicalDice?.total < 3 || interactions.physicalDice?.diceButtons !== 7 || !interactions.physicalDice?.numbered || interactions.physicalDice?.materialPolicy !== "authored-pbr-plus-profiled-finish" || interactions.physicalDice?.miniaturePipeline !== "orm-specialty-wash-drybrush-varnish" || interactions.physicalDice?.propPipeline !== "paper-transmission,wood-anisotropy,foliage-flocking" || interactions.physicalDice?.resinTransmission !== "thickness-map-clearcoat-attenuation" || interactions.physicalDice?.winningNumber < 1 || interactions.physicalDice?.winningFaceGlow !== "emissive-inlay" || interactions.physicalDice?.resultPresentation !== "camera-lift-scale" || interactions.physicalDice?.sumMerge !== "complete" || interactions.physicalDice?.mergedTotal !== interactions.physicalDice?.total || !interactions.physicalDice?.sumOverlay?.includes(String(interactions.physicalDice?.total)) || !interactions.physicalDice?.randomPhysics || !interactions.physicalDice?.rightEntry || !interactions.physicalDice?.innerBoard || !interactions.physicalDice?.diceThemes?.includes("New dice theme") || interactions.physicalDice?.surfaceEffects !== "animated" || interactions.physicalDice?.trailEffects !== "active" || interactions.physicalDice?.particleSystem !== "gpu-bounded-billboards" || interactions.physicalDice?.impactEffect !== "rune-burst" || !interactions.physicalDice?.scannedPbr?.includes("wood-floor") || !interactions.physicalDice?.scannedPbr?.includes("wood-table") || !interactions.physicalDice?.scannedPbr?.includes("wood-chair") || !interactions.physicalDice?.scannedPbr?.includes("wood-barrel") || !interactions.physicalDice?.scannedPbr?.includes("plaster") || interactions.physicalDice?.cleanShadowPolicy !== "one-directional-caster-high-resolution-biased-cascades" || interactions.physicalDice?.ambientModel !== "sky-ground-spherical-harmonics" || !interactions.physicalDice?.skyAmbient || !interactions.physicalDice?.groundAmbient || interactions.physicalDice?.practicalFalloff !== "inverse-square-smooth-window" || interactions.physicalDice?.practicalShadowCasters !== 0 || !/^\d+x\d+$/.test(interactions.physicalDice?.lightProbeGrid ?? "") || interactions.physicalDice?.lightProbeCoefficients !== "9-rgb-bilinear" || interactions.physicalDice?.ssaoPipeline !== "half-resolution-lighting-space-blurred" || interactions.physicalDice?.contactShadows < 1 || interactions.physicalDice?.contactShadowPolicy !== "soft-radial-floor-decal" || interactions.physicalDice?.miniatureRim !== "fresnel-painted-miniatures" || interactions.physicalDice?.shadowFiltering !== "pcf5" || interactions.physicalDice?.shadowResolution !== "2048" || interactions.physicalDice?.shadowBias < .24 || interactions.physicalDice?.shadowNormalOffset < .15 || interactions.physicalDice?.shadowCascades !== 3) {
    throw new Error(`Packaged physical-dice smoke failed: ${JSON.stringify(interactions)}`);
  }
  if (process.env.DNDROM_SMOKE_ONLINE_LIBRARY === "1" && !interactions.onlineLibrary) {
    throw new Error(`Packaged Poly Haven browser smoke failed: ${JSON.stringify(interactions)}`);
  }
  if (!screenshotData || screenshotData.length < 10_000) throw new Error("Packaged WebView screenshot was unexpectedly empty");
  if (process.env.DNDROM_SMOKE_SCREENSHOT) {
    const screenshotPath = path.resolve(process.env.DNDROM_SMOKE_SCREENSHOT);
    await writeFile(screenshotPath, Buffer.from(screenshotData, "base64"));
  console.log(`Packaged screenshot: ${screenshotPath}`);
  console.log(`Packaged dice inspection: ${JSON.stringify(interactions.physicalDice)}`);
  }
  if (process.env.DNDROM_SMOKE_NO_GRID_SCREENSHOT && noGridScreenshotData) {
    const noGridScreenshotPath = path.resolve(process.env.DNDROM_SMOKE_NO_GRID_SCREENSHOT);
    await writeFile(noGridScreenshotPath, Buffer.from(noGridScreenshotData, "base64"));
    console.log(`Packaged no-grid screenshot: ${noGridScreenshotPath}`);
  }
  if (process.env.DNDROM_SMOKE_DISPLAY_SETTINGS_SCREENSHOT && displaySettingsScreenshotData) {
    const displaySettingsScreenshotPath = path.resolve(process.env.DNDROM_SMOKE_DISPLAY_SETTINGS_SCREENSHOT);
    await writeFile(displaySettingsScreenshotPath, Buffer.from(displaySettingsScreenshotData, "base64"));
    console.log(`Packaged display settings screenshot: ${displaySettingsScreenshotPath}`);
    console.log(`Packaged display settings inspection: ${JSON.stringify({ dialog: interactions.displaySettingsDialog, diorama: interactions.dioramaApplied })}`);
  }
  if (process.env.DNDROM_SMOKE_PERFORMANCE_SCREENSHOT && performanceScreenshotData) {
    const performanceScreenshotPath = path.resolve(process.env.DNDROM_SMOKE_PERFORMANCE_SCREENSHOT);
    await writeFile(performanceScreenshotPath, Buffer.from(performanceScreenshotData, "base64"));
    console.log(`Packaged Performance screenshot: ${performanceScreenshotPath}`);
  }
  if (process.env.DNDROM_SMOKE_BALANCED_SCREENSHOT && balancedScreenshotData) {
    const balancedScreenshotPath = path.resolve(process.env.DNDROM_SMOKE_BALANCED_SCREENSHOT);
    await writeFile(balancedScreenshotPath, Buffer.from(balancedScreenshotData, "base64"));
    console.log(`Packaged Balanced screenshot: ${balancedScreenshotPath}`);
  }
  if (process.env.DNDROM_SMOKE_DIORAMA_SCREENSHOT && dioramaScreenshotData) {
    const dioramaScreenshotPath = path.resolve(process.env.DNDROM_SMOKE_DIORAMA_SCREENSHOT);
    await writeFile(dioramaScreenshotPath, Buffer.from(dioramaScreenshotData, "base64"));
    console.log(`Packaged Diorama screenshot: ${dioramaScreenshotPath}`);
  }
  if (process.env.DNDROM_SMOKE_CINEMATIC_SCREENSHOT && cinematicScreenshotData) {
    const cinematicScreenshotPath = path.resolve(process.env.DNDROM_SMOKE_CINEMATIC_SCREENSHOT);
    await writeFile(cinematicScreenshotPath, Buffer.from(cinematicScreenshotData, "base64"));
    console.log(`Packaged Cinematic screenshot: ${cinematicScreenshotPath}`);
  }
  if (process.env.DNDROM_SMOKE_GAMEPLAY_FOCUS_SCREENSHOT && gameplayFocusScreenshotData) {
    const gameplayFocusScreenshotPath = path.resolve(process.env.DNDROM_SMOKE_GAMEPLAY_FOCUS_SCREENSHOT);
    await writeFile(gameplayFocusScreenshotPath, Buffer.from(gameplayFocusScreenshotData, "base64"));
    console.log(`Packaged gameplay focus screenshot: ${gameplayFocusScreenshotPath}`);
    console.log(`Packaged gameplay focus inspection: ${JSON.stringify(interactions.gameplayFocus)}`);
  }
  if (process.env.DNDROM_SMOKE_SCENERY_SCREENSHOT && sceneryScreenshotData) {
    const sceneryScreenshotPath = path.resolve(process.env.DNDROM_SMOKE_SCENERY_SCREENSHOT);
    await writeFile(sceneryScreenshotPath, Buffer.from(sceneryScreenshotData, "base64"));
    console.log(`Packaged scenery screenshot: ${sceneryScreenshotPath}`);
  }
  if (process.env.DNDROM_SMOKE_WORLD_SCREENSHOT && proceduralWorldScreenshotData) {
    const proceduralWorldScreenshotPath = path.resolve(process.env.DNDROM_SMOKE_WORLD_SCREENSHOT);
    await writeFile(proceduralWorldScreenshotPath, Buffer.from(proceduralWorldScreenshotData, "base64"));
    console.log(`Packaged procedural-world screenshot: ${proceduralWorldScreenshotPath}`);
    console.log(`Packaged procedural-world inspection: ${JSON.stringify(interactions.proceduralWorld)}`);
  }
  if (process.env.DNDROM_SMOKE_FORGE_SCREENSHOT && forgeScreenshotData) {
    const forgeScreenshotPath = path.resolve(process.env.DNDROM_SMOKE_FORGE_SCREENSHOT);
    await writeFile(forgeScreenshotPath, Buffer.from(forgeScreenshotData, "base64"));
    console.log(`Packaged Forge screenshot: ${forgeScreenshotPath}`);
    console.log(`Packaged Forge inspection: ${JSON.stringify(interactions.forgeInspection)}`);
  }
  if (process.env.DNDROM_SMOKE_PAINT_SCREENSHOT && forgePaintScreenshotData) {
    const paintScreenshotPath = path.resolve(process.env.DNDROM_SMOKE_PAINT_SCREENSHOT);
    await writeFile(paintScreenshotPath, Buffer.from(forgePaintScreenshotData, "base64"));
    console.log(`Packaged AI paint screenshot: ${paintScreenshotPath}`);
    console.log(`Packaged AI paint inspection: ${JSON.stringify(interactions.forgePaintAssistant)}`);
  }
  if (process.env.DNDROM_SMOKE_DICE_FORGE_SCREENSHOT && diceForgeScreenshotData) {
    const diceForgeScreenshotPath = path.resolve(process.env.DNDROM_SMOKE_DICE_FORGE_SCREENSHOT);
    await writeFile(diceForgeScreenshotPath, Buffer.from(diceForgeScreenshotData, "base64"));
    console.log(`Packaged Dice Forge screenshot: ${diceForgeScreenshotPath}`);
    console.log(`Packaged Dice Forge inspection: ${JSON.stringify(interactions.diceForgeInspection)}`);
  }
  if (process.env.DNDROM_SMOKE_DICE_EFFECTS_SCREENSHOT && diceEffectsScreenshotData) {
    const diceEffectsScreenshotPath = path.resolve(process.env.DNDROM_SMOKE_DICE_EFFECTS_SCREENSHOT);
    await writeFile(diceEffectsScreenshotPath, Buffer.from(diceEffectsScreenshotData, "base64"));
    console.log(`Packaged dice effects screenshot: ${diceEffectsScreenshotPath}`);
  }
  if (process.env.DNDROM_SMOKE_CHARACTER_SHEET_SCREENSHOT && characterSheetScreenshotData) {
    const characterSheetScreenshotPath = path.resolve(process.env.DNDROM_SMOKE_CHARACTER_SHEET_SCREENSHOT);
    await writeFile(characterSheetScreenshotPath, Buffer.from(characterSheetScreenshotData, "base64"));
    console.log(`Packaged character sheet screenshot: ${characterSheetScreenshotPath}`);
    console.log(`Packaged character sheet inspection: ${JSON.stringify(interactions.characterSheet)}`);
  }
  if (process.env.DNDROM_SMOKE_CHARACTER_BUILDER_SCREENSHOT && characterBuilderScreenshotData) {
    const characterBuilderScreenshotPath = path.resolve(process.env.DNDROM_SMOKE_CHARACTER_BUILDER_SCREENSHOT);
    await writeFile(characterBuilderScreenshotPath, Buffer.from(characterBuilderScreenshotData, "base64"));
    console.log(`Packaged character builder screenshot: ${characterBuilderScreenshotPath}`);
  }
  console.log(`Packaged smoke passed: ${snapshot.rootText.replace(/\s+/g, " ").slice(0, 100)}`);
  if (uniqueFailures.length) console.log(`Non-fatal WebView messages:\n- ${uniqueFailures.join("\n- ")}`);
} finally {
  socket?.close();
  child.kill();
  await delay(300);
  const resolvedProfile = path.resolve(smokeProfile);
  const expectedPrefix = path.join(path.resolve(os.tmpdir()), "dndrom-smoke-");
  if (resolvedProfile.startsWith(expectedPrefix)) await rm(resolvedProfile, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}
