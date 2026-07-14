import { useCallback, useState } from "react";
import { AnatomyCanvas } from "./anatomy/anatomy-canvas";
import { AnatomyLayerPicker } from "./anatomy/anatomy-layer-picker";
import {
  DEFAULT_ANATOMY_LAYER,
  type AnatomyLayerId,
} from "./anatomy/constants";
import { formatAnatomyPartName } from "./anatomy/scene-utils";
import type { DicomSlicePlane } from "./anatomy/types";

export type { DicomSlicePlane } from "./anatomy/types";

type ViewerStatus = "loading" | "ready" | "error";

export function AnatomyViewer({
  slicePlane = null,
}: {
  slicePlane?: DicomSlicePlane | null;
}) {
  const [selectedLayers, setSelectedLayers] = useState<Set<AnatomyLayerId>>(
    () => new Set([DEFAULT_ANATOMY_LAYER]),
  );
  const [selectedPart, setSelectedPart] = useState<string | null>(null);
  const [status, setStatus] = useState<ViewerStatus>("loading");

  const handleReady = useCallback(() => setStatus("ready"), []);
  const handleError = useCallback(() => setStatus("error"), []);
  const clearSelection = useCallback(() => setSelectedPart(null), []);
  const toggleLayer = useCallback((id: AnatomyLayerId) => {
    setStatus("loading");
    setSelectedLayers((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  return (
    <div
      className="relative flex h-[32svh] min-h-40 max-h-80 shrink-0 overflow-hidden border-b bg-black [&_canvas]:touch-none"
      aria-label="Interactive 3D anatomy model and synchronized slice view."
    >
      <div className="relative min-w-0 flex-1">
        <AnatomyCanvas
          selectedLayers={selectedLayers}
          selectedPart={selectedPart}
          slicePlane={slicePlane}
          onSelectPart={setSelectedPart}
          onClearSelection={clearSelection}
          onReady={handleReady}
          onError={handleError}
        />

        <AnatomyLayerPicker
          selectedLayers={selectedLayers}
          onToggleLayer={toggleLayer}
        />

        {status === "loading" && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center text-xs text-white/50">
            Loading anatomy…
          </div>
        )}
        {status === "error" && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center text-xs text-white/50">
            Anatomy model unavailable
          </div>
        )}
        {status === "ready" && (
          <div className="pointer-events-none absolute bottom-2 right-3 text-[10px] text-white/35">
            Drag to rotate · Scroll to zoom
          </div>
        )}
      </div>

      <div
        className="relative w-1/3 min-w-0 border-l border-white/10 bg-black"
        aria-label="Sliced anatomy view"
      >
        {slicePlane ? (
          <AnatomyCanvas
            selectedLayers={selectedLayers}
            selectedPart={selectedPart}
            slicePlane={slicePlane}
            viewMode="slice"
            onSelectPart={setSelectedPart}
            onClearSelection={clearSelection}
            onError={handleError}
          />
        ) : (
          <div className="absolute inset-0 grid place-items-center px-4 text-center text-[10px] text-white/35">
            Load a DICOM series to view the anatomy slice
          </div>
        )}
        <div className="pointer-events-none absolute left-2 top-2 rounded bg-black/60 px-1.5 py-1 text-[9px] text-white/50">
          3D slice
        </div>
      </div>

      {selectedPart && (
        <div className="pointer-events-none absolute left-1/2 top-2 z-20 -translate-x-1/2 rounded-md border border-yellow-300/25 bg-black/75 px-2.5 py-1 text-[10px] text-yellow-100 shadow-sm backdrop-blur-sm">
          {formatAnatomyPartName(selectedPart)}
        </div>
      )}
    </div>
  );
}
