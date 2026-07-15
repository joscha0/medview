import {
  Enums,
  LegacyVolumeViewport3D,
  RenderingEngine,
} from "@cornerstonejs/core";
import { ToolGroupManager, ZoomTool } from "@cornerstonejs/tools";
import { type RefObject, useEffect, useRef, useState } from "react";

import type { DicomSeries, ViewMode } from "@/dicom/types";
import { OrbitRotateTool } from "@/tools/orbit-rotate-tool";
import { TouchVolumeCroppingTool } from "@/tools/touch-volume-cropping-tool";
import {
  getErrorMessage,
  initializeCornerstone,
  releaseImageIds,
} from "@/viewer/cornerstone-runtime";
import {
  removeCachedVolume,
  RENDERING_ENGINE_ID,
  setVolumeToolsActive,
  syncCropAfterResize,
  TOOL_GROUP_ID,
  VIEWPORT_ID,
} from "@/viewer/volume-controller";

interface UseCornerstoneViewerOptions {
  exampleHydrationAbortRef: RefObject<AbortController | null>;
  imageIdsRef: RefObject<string[]>;
  loadGenerationRef: RefObject<number>;
  navigationGenerationRef: RefObject<number>;
  onError: (error: string | null) => void;
  seriesListRef: RefObject<DicomSeries[]>;
  viewModeRef: RefObject<ViewMode>;
}

export function useCornerstoneViewer({
  exampleHydrationAbortRef,
  imageIdsRef,
  loadGenerationRef,
  navigationGenerationRef,
  onError,
  seriesListRef,
  viewModeRef,
}: UseCornerstoneViewerOptions) {
  const viewportElementRef = useRef<HTMLDivElement>(null);
  const renderingEngineRef = useRef<RenderingEngine | null>(null);
  const activeVolumeIdRef = useRef<string | null>(null);
  const pendingImageIdsRef = useRef<string[]>([]);
  const renderQualityRestoreTimerRef = useRef<number | null>(null);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let resizeObserver: ResizeObserver | undefined;
    let removeMobileGestureGuards: (() => void) | undefined;

    async function setUpViewer() {
      try {
        await initializeCornerstone();
        if (cancelled || !viewportElementRef.current) return;

        const renderingEngine = new RenderingEngine(RENDERING_ENGINE_ID);
        renderingEngine.enableElement({
          viewportId: VIEWPORT_ID,
          type: Enums.ViewportType.STACK,
          element: viewportElementRef.current,
          defaultOptions: { background: [0, 0, 0] },
        });
        renderingEngineRef.current = renderingEngine;

        const toolGroup = ToolGroupManager.createToolGroup(TOOL_GROUP_ID);
        toolGroup?.addTool(OrbitRotateTool.toolName);
        toolGroup?.addTool(TouchVolumeCroppingTool.toolName, {
          initialCropFactor: 0.001,
          showClippingPlanes: false,
          showHandles: false,
        });
        toolGroup?.addTool(ZoomTool.toolName);
        toolGroup?.addViewport(VIEWPORT_ID, RENDERING_ENGINE_ID);
        setVolumeToolsActive(false);

        resizeObserver = new ResizeObserver(() => {
          renderingEngine.resize(true, true);
          if (viewModeRef.current !== "volume") return;
          const viewport =
            renderingEngine.getViewport<
              InstanceType<typeof LegacyVolumeViewport3D>
            >(VIEWPORT_ID);
          syncCropAfterResize(viewport);
        });
        resizeObserver.observe(viewportElementRef.current);

        const viewportElement = viewportElementRef.current;
        const preventMultiTouchBrowserGesture = (event: TouchEvent) => {
          if (event.touches.length > 1) event.preventDefault();
        };
        const preventSafariGesture = (event: Event) => event.preventDefault();
        const gestureEvents = [
          "gesturestart",
          "gesturechange",
          "gestureend",
        ] as const;

        viewportElement.addEventListener(
          "touchstart",
          preventMultiTouchBrowserGesture,
          { passive: false },
        );
        viewportElement.addEventListener(
          "touchmove",
          preventMultiTouchBrowserGesture,
          { passive: false },
        );
        gestureEvents.forEach((eventName) =>
          viewportElement.addEventListener(eventName, preventSafariGesture, {
            passive: false,
          }),
        );
        removeMobileGestureGuards = () => {
          viewportElement.removeEventListener(
            "touchstart",
            preventMultiTouchBrowserGesture,
          );
          viewportElement.removeEventListener(
            "touchmove",
            preventMultiTouchBrowserGesture,
          );
          gestureEvents.forEach((eventName) =>
            viewportElement.removeEventListener(
              eventName,
              preventSafariGesture,
            ),
          );
        };
        setIsReady(true);
      } catch (error) {
        onError(getErrorMessage(error));
      }
    }

    void setUpViewer();

    return () => {
      cancelled = true;
      loadGenerationRef.current += 1;
      navigationGenerationRef.current += 1;
      // Cleanup intentionally targets the latest in-flight hydration request.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      exampleHydrationAbortRef.current?.abort();
      resizeObserver?.disconnect();
      removeMobileGestureGuards?.();
      // Cleanup intentionally targets the latest scheduled quality restore.
      if (renderQualityRestoreTimerRef.current !== null) {
        // eslint-disable-next-line react-hooks/exhaustive-deps
        window.clearTimeout(renderQualityRestoreTimerRef.current);
      }
      ToolGroupManager.destroyToolGroup(TOOL_GROUP_ID);
      renderingEngineRef.current?.destroy();
      renderingEngineRef.current = null;
      removeCachedVolume(activeVolumeIdRef.current);
      activeVolumeIdRef.current = null;
      releaseImageIds(pendingImageIdsRef.current);
      seriesListRef.current.forEach((series) =>
        releaseImageIds(series.imageIds),
      );
      pendingImageIdsRef.current = [];
      imageIdsRef.current = [];
      seriesListRef.current = [];
    };
  }, [
    exampleHydrationAbortRef,
    imageIdsRef,
    loadGenerationRef,
    navigationGenerationRef,
    onError,
    renderQualityRestoreTimerRef,
    seriesListRef,
    viewModeRef,
  ]);

  return {
    activeVolumeIdRef,
    isReady,
    pendingImageIdsRef,
    renderingEngineRef,
    renderQualityRestoreTimerRef,
    viewportElementRef,
  };
}
