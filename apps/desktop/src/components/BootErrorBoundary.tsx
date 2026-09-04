import { Component, useEffect, type ErrorInfo, type ReactNode } from "react";

type BootWindow = Window & typeof globalThis & {
  __DNDROM_MARK_READY__?: () => void;
  __DNDROM_REPORT_BOOT_FAILURE__?: (message: string) => void;
};

function BootReadyMarker() {
  useEffect(() => {
    (window as BootWindow).__DNDROM_MARK_READY__?.();
  }, []);
  return null;
}

export class BootErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("DnDRom startup failed", error, info.componentStack);
    (window as BootWindow).__DNDROM_REPORT_BOOT_FAILURE__?.(error.message);
  }

  render() {
    if (this.state.error) {
      return (
        <main className="boot-failure">
          <div className="boot-failure-mark">D</div>
          <h1>DnDRom could not start</h1>
          <p>{this.state.error.message}</p>
          <small>Your campaign and catalogue remain saved. Return to the tabletop view and restart the interface.</small>
          <button onClick={() => { localStorage.removeItem("dndrom.creatorPage.v1"); location.reload(); }}>Return to tabletop and restart</button>
        </main>
      );
    }
    return <>{this.props.children}<BootReadyMarker /></>;
  }
}
