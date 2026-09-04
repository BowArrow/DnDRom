import { useSyncExternalStore } from "react";
import { getDisplaySettings, subscribeDisplaySettings } from "../domain/displaySettings";

export function useDisplaySettings() {
  return useSyncExternalStore(subscribeDisplaySettings, getDisplaySettings, getDisplaySettings);
}
