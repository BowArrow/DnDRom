(function installDnDRomBootWatchdog() {
  var timer;
  var status = { state: "starting", message: "Starting DnDRom" };
  globalThis.__DNDROM_BOOT_STATUS__ = status;

  function setStatus(state, message) {
    status = { state: state, message: String(message || "") };
    globalThis.__DNDROM_BOOT_STATUS__ = status;
  }

  function renderFailure(message) {
    setStatus("failed", message);
    function render() {
      var root = document.getElementById("root");
      if (!root) return;
      var shell = document.createElement("main");
      shell.className = "boot-failure";
      var mark = document.createElement("div");
      mark.className = "boot-failure-mark";
      mark.textContent = "D";
      var heading = document.createElement("h1");
      heading.textContent = "DnDRom could not start";
      var copy = document.createElement("p");
      copy.textContent = message || "The desktop interface stopped during startup.";
      var hint = document.createElement("small");
      hint.textContent = "Your campaign and catalogue remain saved. Return to the tabletop view and restart the interface.";
      var reset = document.createElement("button");
      reset.textContent = "Return to tabletop and restart";
      reset.addEventListener("click", function () {
        localStorage.removeItem("dndrom.creatorPage.v1");
        location.reload();
      });
      shell.append(mark, heading, copy, hint, reset);
      root.replaceChildren(shell);
    }
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", render, { once: true });
    else render();
  }

  globalThis.__DNDROM_MARK_READY__ = function () {
    clearTimeout(timer);
    setStatus("ready", "DnDRom interface mounted");
  };
  globalThis.__DNDROM_REPORT_BOOT_FAILURE__ = renderFailure;
  addEventListener("error", function (event) {
    renderFailure(event.error && event.error.message ? event.error.message : event.message || "Unhandled startup error");
  });
  addEventListener("unhandledrejection", function (event) {
    var reason = event.reason;
    renderFailure(reason && reason.message ? reason.message : String(reason || "Unhandled startup rejection"));
  });
  timer = setTimeout(function () {
    if (status.state !== "ready") renderFailure("Startup timed out before the interface became ready.");
  }, 15000);
})();
