/** Browser input is collected once per frame; navigation never edits the map. */
export function bindNativeNavigation(node: HTMLElement, send: (input: Record<string, unknown>) => Promise<unknown>, onError: (error: unknown) => void) {
  const keys = new Set<string>();
  let gesture: "orbit" | "fly" | null = null, pointerId: number | null = null;
  let previousX = 0, previousY = 0, frame = 0, last = performance.now(), sending = false;
  let yaw = 0, pitch = 0, panX = 0, panY = 0, zoom = 0, flyYaw = 0, flyPitch = 0;
  let forward = 0, right = 0, height = 0;
  const release = () => {
    gesture = null; keys.clear();
    const id = pointerId; pointerId = null;
    if (id !== null && node.hasPointerCapture(id)) node.releasePointerCapture(id);
  };
  const press = (event: PointerEvent) => {
    if (event.button !== 1 && event.button !== 2) return;
    event.preventDefault(); node.focus({ preventScroll: true });
    gesture = event.button === 1 ? "orbit" : "fly";
    previousX = event.clientX; previousY = event.clientY;
    pointerId = event.pointerId; node.setPointerCapture(pointerId);
  };
  const move = (event: PointerEvent) => {
    if (!gesture || event.pointerId !== pointerId || !(event.buttons & (gesture === "orbit" ? 4 : 2))) return;
    const dx = event.clientX - previousX, dy = event.clientY - previousY;
    previousX = event.clientX; previousY = event.clientY;
    if (gesture === "fly") { flyYaw += dx * .2; flyPitch -= dy * .2; }
    else if (event.shiftKey) {
      // Fraction of viewport width: native side accounts for FOV and depth.
      const width = Math.max(1, node.clientWidth);
      panX += dx / width; panY += dy / width;
    } else if (event.ctrlKey) zoom += dy * .01;
    else { yaw -= dx * .3; pitch += dy * .3; }
    event.preventDefault();
  };
  const wheel = (event: WheelEvent) => {
    event.preventDefault();
    const pixels = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? node.clientHeight : 1);
    zoom += Math.max(-1, Math.min(1, pixels * .0015));
  };
  const down = (event: KeyboardEvent) => {
    if (gesture === "fly" && ["KeyW", "KeyA", "KeyS", "KeyD", "KeyQ", "KeyE", "ShiftLeft", "ShiftRight"].includes(event.code)) {
      keys.add(event.code); event.preventDefault();
    } else if (event.target === node && event.code === "Home") {
      event.preventDefault(); void send({ kind: "frame" }).catch(onError);
    }
  };
  const up = (event: KeyboardEvent) => { keys.delete(event.code); };
  const tick = (now: number) => {
    const dt = Math.min(.1, (now - last) / 1000); last = now;
    const speed = (keys.has("ShiftLeft") || keys.has("ShiftRight") ? 12000 : 1800) * dt;
    // Preserve elapsed movement while a bridge acknowledgement is in flight.
    // Bound backlog after a stall so resuming cannot launch the camera away.
    forward = Math.max(-2000, Math.min(2000, forward + (Number(keys.has("KeyW")) - Number(keys.has("KeyS"))) * speed));
    right = Math.max(-2000, Math.min(2000, right + (Number(keys.has("KeyD")) - Number(keys.has("KeyA"))) * speed));
    height = Math.max(-2000, Math.min(2000, height + (Number(keys.has("KeyE")) - Number(keys.has("KeyQ"))) * speed));
    if (!sending) {
      const inputs: Record<string, unknown>[] = [];
      if (yaw || pitch || panX || panY || zoom) inputs.push({ kind: "navigate", yaw, pitch, panX, panY, zoom });
      if (flyYaw || flyPitch || forward || right || height) inputs.push({ kind: "camera", yaw: flyYaw, pitch: flyPitch, forward, right, up: height });
      yaw = pitch = panX = panY = zoom = flyYaw = flyPitch = 0;
      forward = right = height = 0;
      if (inputs.length) {
        sending = true;
        void (async () => { for (const input of inputs) await send(input); })().catch(onError).finally(() => { sending = false; });
      }
    }
    frame = requestAnimationFrame(tick);
  };
  const preventAux = (event: MouseEvent) => { event.preventDefault(); };
  node.addEventListener("pointerdown", press); node.addEventListener("pointermove", move);
  node.addEventListener("wheel", wheel, { passive: false }); node.addEventListener("auxclick", preventAux);
  node.addEventListener("lostpointercapture", release);
  window.addEventListener("pointerup", release); window.addEventListener("pointercancel", release); window.addEventListener("blur", release);
  window.addEventListener("keydown", down); window.addEventListener("keyup", up);
  frame = requestAnimationFrame(tick);
  return () => {
    release(); cancelAnimationFrame(frame);
    node.removeEventListener("pointerdown", press); node.removeEventListener("pointermove", move);
    node.removeEventListener("wheel", wheel); node.removeEventListener("auxclick", preventAux); node.removeEventListener("lostpointercapture", release);
    window.removeEventListener("pointerup", release); window.removeEventListener("pointercancel", release); window.removeEventListener("blur", release);
    window.removeEventListener("keydown", down); window.removeEventListener("keyup", up);
  };
}
