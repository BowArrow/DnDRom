import { isUnreal, nativeCall } from "./migration/nativeBridge";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { BootErrorBoundary } from "./components/BootErrorBoundary";
import { CampaignHydrationGate } from "./components/CampaignHydrationGate";
import "./styles.css";

if (isUnreal()) void nativeCall("app.ready").catch(console.error);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BootErrorBoundary><CampaignHydrationGate><App /></CampaignHydrationGate></BootErrorBoundary>
  </StrictMode>,
);
