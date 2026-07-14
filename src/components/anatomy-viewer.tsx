import { useCallback, useRef, useState } from "react";
import { PanelResizeHandle } from "./panel-resize-handle";
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

const DEFAULT_MODEL_PANEL_SIZE = 67;
const MIN_ANATOMY_PANEL_WIDTH = 140;

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
  const [modelPanelSize, setModelPanelSize] = useState(
    DEFAULT_MODEL_PANEL_SIZE,
  );
  const panelsRef = useRef<HTMLDivElement>(null);

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
      ref={panelsRef}
      className="relative grid min-h-0 overflow-hidden bg-black [&_canvas]:touch-none"
      style={{
        gridTemplateColumns: `minmax(${MIN_ANATOMY_PANEL_WIDTH}px, ${modelPanelSize}fr) auto minmax(${MIN_ANATOMY_PANEL_WIDTH}px, ${100 - modelPanelSize}fr)`,
      }}
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

      <PanelResizeHandle
        containerRef={panelsRef}
        label="Resize 3D model and 3D slice panels"
        minFirstSize={MIN_ANATOMY_PANEL_WIDTH}
        minSecondSize={MIN_ANATOMY_PANEL_WIDTH}
        orientation="vertical"
        value={modelPanelSize}
        onChange={setModelPanelSize}
        onReset={() => setModelPanelSize(DEFAULT_MODEL_PANEL_SIZE)}
      />

      <div
        className="relative min-w-0 bg-black"
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
