/// <reference lib="webworker" />
import { compileWorldBlueprint } from "./worldForge";
import type { WorldBlueprintV1 } from "./types";

interface CompileRequest { id: string; blueprint: WorldBlueprintV1 }

self.onmessage = (event: MessageEvent<CompileRequest>) => {
  try {
    self.postMessage({ id: event.data.id, result: compileWorldBlueprint(event.data.blueprint) });
  } catch (error) {
    self.postMessage({ id: event.data.id, error: error instanceof Error ? error.message : String(error) });
  }
};

export {};
