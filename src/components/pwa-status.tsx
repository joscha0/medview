import { CheckCircle2, RefreshCw, WifiOff } from "lucide-react";

import { Button } from "@/components/ui/button";
import { usePwaStatus } from "@/hooks/use-pwa-status";

export function PwaStatus() {
  const {
    applyUpdate,
    dismissOfflineReady,
    dismissUpdate,
    isOfflineReady,
    isOnline,
    isUpdateAvailable,
  } = usePwaStatus();

  return (
    <>
      {!isOnline && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-3 left-3 z-100 flex items-center gap-2 rounded-full border border-amber-400/30 bg-black/90 px-3 py-1.5 text-xs font-medium text-amber-200 shadow-lg backdrop-blur"
        >
          <WifiOff aria-hidden="true" className="size-3.5" />
          Offline
        </div>
      )}

      {isUpdateAvailable ? (
        <div
          role="dialog"
          aria-labelledby="update-available-title"
          aria-describedby="update-available-description"
          className="fixed right-4 bottom-4 z-100 w-[min(22rem,calc(100vw-2rem))] rounded-xl border border-white/15 bg-zinc-950/95 p-4 text-zinc-100 shadow-2xl backdrop-blur"
        >
          <div className="flex items-start gap-3">
            <RefreshCw
              aria-hidden="true"
              className="mt-0.5 size-5 shrink-0 text-blue-400"
            />
            <div className="min-w-0 flex-1">
              <h2 id="update-available-title" className="text-sm font-semibold">
                Update available
              </h2>
              <p
                id="update-available-description"
                className="mt-1 text-xs leading-5 text-zinc-400"
              >
                Reload when you are ready. Your currently open study will be
                closed.
              </p>
            </div>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={dismissUpdate}>
              Later
            </Button>
            <Button size="sm" onClick={applyUpdate}>
              Reload
            </Button>
          </div>
        </div>
      ) : isOfflineReady ? (
        <div
          role="dialog"
          aria-labelledby="offline-ready-title"
          aria-describedby="offline-ready-description"
          className="fixed right-4 bottom-4 z-100 w-[min(22rem,calc(100vw-2rem))] rounded-xl border border-white/15 bg-zinc-950/95 p-4 text-zinc-100 shadow-2xl backdrop-blur"
        >
          <div className="flex items-start gap-3">
            <CheckCircle2
              aria-hidden="true"
              className="mt-0.5 size-5 shrink-0 text-emerald-400"
            />
            <div className="min-w-0 flex-1">
              <h2 id="offline-ready-title" className="text-sm font-semibold">
                Ready to work offline
              </h2>
              <p
                id="offline-ready-description"
                className="mt-1 text-xs leading-5 text-zinc-400"
              >
                MedView's application files are cached on this device.
              </p>
            </div>
          </div>
          <div className="mt-4 flex justify-end">
            <Button size="sm" onClick={dismissOfflineReady}>
              OK
            </Button>
          </div>
        </div>
      ) : null}
    </>
  );
}
