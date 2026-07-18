// Migration shim for pages cached by older MedView service workers. New builds
// register in src/main.tsx, but an old index.html may still request this file.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js", { scope: "/" });
  });
}
