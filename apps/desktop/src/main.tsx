import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { BootErrorBoundary } from "./components/BootErrorBoundary";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BootErrorBoundary><App /></BootErrorBoundary>
  </StrictMode>,
);
