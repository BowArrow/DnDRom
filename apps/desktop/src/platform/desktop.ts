import { invoke as tauriInvoke, isTauri as tauriAvailable } from "@tauri-apps/api/core";
import { listen as tauriListen } from "@tauri-apps/api/event";
import { isUnreal, nativeCall, nativeUpload } from "../migration/nativeBridge";

export const isTauri = () => isUnreal() || tauriAvailable();
const methods: Record<string, string> = {
  local_runtime_status: "runtime.status", ensure_local_runtime: "runtime.ensure", restart_local_runtime: "runtime.restart",
  provision_local_creation_suite: "runtime.provision", find_latest_local_world_dataset: "runtime.dataset",
  find_latest_local_trained_world: "runtime.trained", train_local_world: "runtime.train", read_local_runtime_file: "runtime.read",
  roll_check: "rules.roll",
};
export async function invoke<T>(command: string, params: Record<string, unknown> = {}): Promise<T> {
  if (!isUnreal()) return tauriInvoke<T>(command, params);
  if (command === "save_campaign") return nativeUpload(String(params.contents), "download", `${params.name}.dndrom`) as Promise<T>;
  const method = methods[command];
  if (!method) throw new Error(`The native client does not yet support ${command}.`);
  return nativeCall<T>(method, command === "roll_check" ? params.request as Record<string, unknown> : params);
}
export async function listen<T>(name: string, handler: (event: { payload: T }) => void): Promise<() => void> {
  if (!isUnreal()) return tauriListen<T>(name, handler);
  const listener = (event: Event) => { const message = (event as CustomEvent).detail; if (name === "local-runtime-progress" && message?.event === "runtime.progress") handler({ payload: message.data }); };
  window.addEventListener("dndrom:native", listener);
  return () => window.removeEventListener("dndrom:native", listener);
}
