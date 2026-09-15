import { useEffect, useState, type ReactNode } from "react";
import { useCampaignStore } from "../state/campaignStore";
import { getCampaignPersistenceError } from "../persistence/campaignStorage";

export function CampaignHydrationGate({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(useCampaignStore.persist.hasHydrated());
  const [error, setError] = useState(getCampaignPersistenceError());
  useEffect(() => {
    const stop = useCampaignStore.persist.onFinishHydration(() => setReady(true));
    const failure = () => setError(getCampaignPersistenceError());
    window.addEventListener("dndrom:campaign-storage-error", failure);
    setReady(useCampaignStore.persist.hasHydrated()); setError(getCampaignPersistenceError());
    return () => { stop(); window.removeEventListener("dndrom:campaign-storage-error", failure); };
  }, []);
  if (error && !ready) throw new Error(`Your saved world could not be loaded: ${error}`);
  if (!ready) return <main className="boot-failure"><h1>Opening your saved world…</h1></main>;
  return <>{error && <div role="alert" className="local-storage-error">Autosave failed: {error}. Keep this window open and export your campaign.</div>}{children}</>;
}
