const ANATOMY_CACHE_NAME = "medview-anatomy-layers";
const pendingAssets = new Map<string, Promise<void>>();

export function cacheAnatomyAsset(url: string) {
  if (typeof window === "undefined" || !("caches" in window)) {
    return Promise.resolve();
  }

  const absoluteUrl = new URL(url, window.location.href).href;
  const pendingAsset = pendingAssets.get(absoluteUrl);
  if (pendingAsset) return pendingAsset;

  const request = new Request(absoluteUrl, { credentials: "same-origin" });
  const task = (async () => {
    const cache = await window.caches.open(ANATOMY_CACHE_NAME);
    if (await cache.match(request)) return;

    const response = await fetch(request);
    if (response.status === 200) {
      await cache.put(request, response);
    }
  })()
    .catch(() => {
      // The viewer owns load errors; a failed cache write should stay silent.
    })
    .finally(() => pendingAssets.delete(absoluteUrl));

  pendingAssets.set(absoluteUrl, task);
  return task;
}
