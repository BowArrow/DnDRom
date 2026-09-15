/// <reference lib="webworker" />
import { compileWorldBlueprint } from "./worldForge";
import type { WorldBlueprintV1 } from "./types";
import {openNativeErosionCache,flushNativeErosionCache} from "../migration/nativeErosionCache";

interface CompileRequest { id: string; blueprint: WorldBlueprintV1 }

self.onmessage = async (event: MessageEvent<CompileRequest>) => {
  try {
    await Promise.race([openNativeErosionCache(event.data.blueprint.seed),new Promise<void>(resolve=>setTimeout(resolve,2000))]);
    const result=compileWorldBlueprint(event.data.blueprint);
    await flushNativeErosionCache();
    self.postMessage({ id: event.data.id, result });
  } catch (error) {
    self.postMessage({ id: event.data.id, error: error instanceof Error ? error.message : String(error) });
  }
};

export {};
