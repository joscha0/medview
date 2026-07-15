import {
  cache,
  Enums,
  imageLoader,
  LegacyVolumeViewport3D,
  RenderingEngine,
  setVolumesForViewports,
  StackViewport,
  utilities,
  volumeLoader,
  init as initCornerstoneCore,
} from "@cornerstonejs/core";
import {
  init as initDicomImageLoader,
  wadouri,
} from "@cornerstonejs/dicom-image-loader";
import {
  addTool,
  init as initCornerstoneTools,
  ToolGroupManager,
  ZoomTool,
} from "@cornerstonejs/tools";
import {
  Enums as MetadataEnums,
  utilities as metadataUtilities,
} from "@cornerstonejs/metadata";
import {
  AlertCircle,
  Box,
  ChevronLeft,
  ChevronRight,
  FileImage,
  Loader2,
  RotateCcw,
  Rows3,
  Upload,
} from "lucide-react";
import {
  type ChangeEvent,
  type DragEvent,
  type KeyboardEvent,
  type WheelEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  AnatomyViewer,
} from "@/components/anatomy-viewer";
import { DicomMetadataOverlay } from "@/components/dicom-metadata-overlay";
import { PanelResizeHandle } from "@/components/panel-resize-handle";
import { VolumeRenderingOptions } from "@/components/volume-rendering-options";
import {
  SeriesPicker,
} from "@/components/series-picker";
import {
  getDicomSlicePlane,
  hydrateExampleSeries,
  readDicomHeaders,
  sortDicomFiles,
} from "@/dicom/series";
import type {
  DicomFileInfo,
  DicomSeries,
  ExampleSeriesManifest,
  ViewMode,
} from "@/dicom/types";
import { OrbitRotateTool } from "@/tools/orbit-rotate-tool";
import { TouchVolumeCroppingTool } from "@/tools/touch-volume-cropping-tool";
import {
  alignVolumeCameraForOrbit,
  applyCurrentCrop,
  applyVolumePresentation,
  bindToolsToViewport,
  clearCurrentCrop,
  cloneCamera,
  forgetVolumeCropState,
  getDefaultVolumePreset,
  removeCachedVolume,
  RENDERING_ENGINE_ID,
  setVolumeToolsActive,
  startCropEditing,
  syncCropAfterResize,
  TOOL_GROUP_ID,
  VIEWPORT_ID,
} from "@/viewer/volume-controller";

const LOAD_TIMEOUT_MS = 30_000;
const DEFAULT_ANATOMY_PANEL_SIZE = 35;
const MIN_VIEWER_PANEL_HEIGHT = 140;
const INTERACTIVE_SAMPLE_DISTANCE_MULTIPLIER = 6;
const FINAL_SAMPLE_DISTANCE_MULTIPLIER = 1;
const RENDER_QUALITY_RESTORE_DELAY_MS = 140;
let initializationPromise: Promise<void> | undefined;
type CropMode = "none" | "editing" | "applied";

const CT_VOLUME_PRESETS = [
  { label: "Bone", value: "CT-Bone" },
  { label: "Soft tissue", value: "CT-Soft-Tissue" },
  { label: "Lung", value: "CT-Lung" },
  { label: "Vessels", value: "CT-Chest-Vessels" },
  { label: "MIP", value: "CT-MIP" },
] as const;

const MR_VOLUME_PRESETS = [
  { label: "MR default", value: "MR-Default" },
  { label: "MR angiography", value: "MR-Angio" },
  { label: "MR MIP", value: "MR-MIP" },
  { label: "T2 brain", value: "MR-T2-Brain" },
] as const;


function initializeCornerstone() {
  if (!initializationPromise) {
    initializationPromise = Promise.resolve().then(() => {
      initCornerstoneCore();
      initDicomImageLoader({
        maxWebWorkers: Math.max(
          1,
          Math.min(navigator.hardwareConcurrency || 1, 4),
        ),
        // The naturalized dcmjs provider logs ambiguous implicit-VR `xs`
        // values as errors before resolving their signedness. Local wadouri
        // files already use dicom-parser, whose metadata provider resolves
        // these values from Pixel Representation without noisy fallbacks.
        useLegacyMetadataProvider: true,
      });
      initCornerstoneTools();
      addTool(OrbitRotateTool);
      addTool(TouchVolumeCroppingTool);
      addTool(ZoomTool);
    });
  }

  return initializationPromise;
}

function withTimeout<T>(
  promise: Promise<T>,
  message: string,
  onTimeout?: () => void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timeout = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      onTimeout?.();
      reject(new Error(message));
    }, LOAD_TIMEOUT_MS);

    promise.then(
      (value) => {
        if (settled) {
          onTimeout?.();
          return;
        }
        settled = true;
        window.clearTimeout(timeout);
        resolve(value);
      },
      (error: unknown) => {
        if (settled) {
          onTimeout?.();
          return;
        }
        settled = true;
        window.clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

function getManagedFileIndex(imageId: string) {
  const match = /^dicomfile:(\d+)$/.exec(imageId);
  return match ? Number(match[1]) : undefined;
}

function removeCachedImage(imageId: string) {
  const loadObject = cache.getImageLoadObject(imageId);
  try {
    loadObject?.cancelFn?.();
  } catch {
    // Some loaders expose cancellation only for part of their lifecycle.
  }

  try {
    if (cache.getImageLoadObject(imageId)) {
      cache.removeImageLoadObject(imageId, { force: true });
    }
  } catch {
    // The cache entry may have completed or been removed concurrently.
  }
}

function releaseImageIds(imageIds: string[], removeFiles = true) {
  imageIds.forEach((imageId) => {
    removeCachedImage(imageId);
    metadataUtilities.clearTypedCacheData(
      MetadataEnums.MetadataModules.NATURALIZED,
      imageId,
    );

    if (removeFiles) {
      const fileIndex = getManagedFileIndex(imageId);
      if (fileIndex !== undefined) wadouri.fileManager.remove(fileIndex);
    }
  });
}

async function createSeriesThumbnail(
  image: Awaited<ReturnType<typeof imageLoader.loadAndCacheImage>>,
  modality?: string,
) {
  const canvas = document.createElement("canvas");
  canvas.width = 240;
  canvas.height = 180;
  await utilities.renderToCanvasCPU(canvas, image, modality);
  return canvas.toDataURL("image/jpeg", 0.82);
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "error" in error) {
    return getErrorMessage(error.error);
  }
  if (typeof error === "string") return error;
  return "The selected files could not be opened as a DICOM series.";
}

function App() {
  const viewportElementRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const renderingEngineRef = useRef<RenderingEngine | null>(null);
  const activeVolumeIdRef = useRef<string | null>(null);
  const exampleHydrationAbortRef = useRef<AbortController | null>(null);
  const currentIndexRef = useRef(0);
  const imageIdsRef = useRef<string[]>([]);
  const viewModeRef = useRef<ViewMode>("stack");
  const dragDepthRef = useRef(0);
  const loadGenerationRef = useRef(0);
  const navigationGenerationRef = useRef(0);
  const pendingImageIdsRef = useRef<string[]>([]);
  const viewerPanelsRef = useRef<HTMLDivElement>(null);
  const seriesListRef = useRef<DicomSeries[]>([]);
  const activeSeriesIdRef = useRef<string | null>(null);
  const nextSeriesIdRef = useRef(0);
  const renderQualityRestoreTimerRef = useRef<number | null>(null);

  const [isReady, setIsReady] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState("Opening series…");
  const [error, setError] = useState<string | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [imageCount, setImageCount] = useState(0);
  const [seriesFiles, setSeriesFiles] = useState<DicomFileInfo[]>([]);
  const [seriesList, setSeriesList] = useState<DicomSeries[]>([]);
  const [activeSeriesId, setActiveSeriesId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("stack");
  const [volumePreset, setVolumePreset] = useState("CT-Bone");
  const [opacityThreshold, setOpacityThreshold] = useState(0);
  const [isVolumeOptionsOpen, setIsVolumeOptionsOpen] = useState(
    () =>
      typeof window === "undefined" ||
      window.matchMedia("(min-width: 1024px)").matches,
  );
  const [cropMode, setCropMode] = useState<CropMode>("none");
  const isCropping = cropMode === "editing";
  const hasCrop = cropMode !== "none";
  const [isLoadingExamples, setIsLoadingExamples] = useState(false);
  const [anatomyPanelSize, setAnatomyPanelSize] = useState(
    DEFAULT_ANATOMY_PANEL_SIZE,
  );
  const slicePlane = useMemo(
    () => getDicomSlicePlane(seriesFiles, currentIndex),
    [currentIndex, seriesFiles],
  );
  const volumePresetOptions =
    seriesFiles[0]?.modality?.toUpperCase() === "MR"
      ? MR_VOLUME_PRESETS
      : CT_VOLUME_PRESETS;

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
      } catch (setupError) {
        setError(getErrorMessage(setupError));
      }
    }

    void setUpViewer();

    return () => {
      cancelled = true;
      loadGenerationRef.current += 1;
      navigationGenerationRef.current += 1;
      exampleHydrationAbortRef.current?.abort();
      resizeObserver?.disconnect();
      removeMobileGestureGuards?.();
      if (renderQualityRestoreTimerRef.current !== null) {
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
  }, []);

  useEffect(() => {
    if (!isReady) return;

    const abortController = new AbortController();
    let cancelled = false;

    async function loadExamples() {
      setIsLoadingExamples(true);

      try {
        const manifestUrl = new URL(
          `${import.meta.env.BASE_URL}example-series/manifest.json`,
          document.baseURI,
        );
        const response = await fetch(manifestUrl, {
          signal: abortController.signal,
        });
        if (!response.ok)
          throw new Error("Example manifest could not be loaded.");

        const manifest = (await response.json()) as ExampleSeriesManifest;
        const examples: DicomSeries[] = manifest.series.map((entry) => ({
          id: `example-${entry.directory}`,
          exampleEntry: entry,
          files: [],
          imageIds: [],
          currentIndex: Math.floor(entry.files.length / 2),
          imageCount: entry.files.length,
          isExample: true,
          label: entry.label,
          modality: entry.directory.split("_", 1)[0],
          seriesInstanceUid: entry.directory,
          thumbnailUrl: entry.thumbnail
            ? new URL(
                `${import.meta.env.BASE_URL}example-series/${entry.thumbnail}`,
                document.baseURI,
              ).href
            : undefined,
        }));

        if (cancelled) return;
        if (!examples.length) {
          throw new Error("The bundled example series could not be loaded.");
        }

        const exampleIds = new Set(examples.map((series) => series.id));
        const nextSeriesList = [
          ...examples,
          ...seriesListRef.current.filter(
            (series) => !exampleIds.has(series.id),
          ),
        ];
        seriesListRef.current = nextSeriesList;
        setSeriesList(nextSeriesList);
      } catch (exampleError) {
        if (!cancelled && !(exampleError instanceof DOMException)) {
          setError(getErrorMessage(exampleError));
        }
      } finally {
        if (!cancelled) setIsLoadingExamples(false);
      }
    }

    void loadExamples();

    return () => {
      cancelled = true;
      abortController.abort();
    };
  }, [isReady]);

  const displaySeries = useCallback(
    async (series: DicomSeries, requestedMode: ViewMode) => {
      const renderingEngine = renderingEngineRef.current;
      const element = viewportElementRef.current;
      if (!renderingEngine || !element) {
        throw new Error("The viewer is not ready yet.");
      }

      async function displayStack(
        activeRenderingEngine: RenderingEngine,
        viewportElement: HTMLDivElement,
      ) {
        setVolumeToolsActive(false);
        activeRenderingEngine.disableElement(VIEWPORT_ID);
        forgetVolumeCropState();
        setCropMode("none");
        removeCachedVolume(activeVolumeIdRef.current);
        activeVolumeIdRef.current = null;
        activeRenderingEngine.enableElement({
          viewportId: VIEWPORT_ID,
          type: Enums.ViewportType.STACK,
          element: viewportElement,
          defaultOptions: { background: [0, 0, 0] },
        });
        bindToolsToViewport();

        const viewport =
          activeRenderingEngine.getViewport<StackViewport>(VIEWPORT_ID);
        await withTimeout(
          viewport.setStack(series.imageIds, series.currentIndex),
          "The selected series could not be displayed in time.",
          () => removeCachedImage(series.imageIds[series.currentIndex]),
        );
        viewport.render();
      }

      if (requestedMode === "stack") {
        await displayStack(renderingEngine, element);
        return { mode: "stack" as const, warning: null };
      }

      const hasVolumeGeometry =
        series.files.length > 1 &&
        series.files.every(
          (file) =>
            file.imageOrientation &&
            file.imagePosition &&
            file.pixelSpacing &&
            file.rows &&
            file.columns,
        );
      if (!hasVolumeGeometry) {
        await displayStack(renderingEngine, element);
        return {
          mode: "stack" as const,
          warning:
            "This series does not contain enough spatial metadata for a 3D reconstruction.",
        };
      }

      const volumeId = `cornerstoneStreamingImageVolume:medview-${series.id}`;

      try {
        renderingEngine.disableElement(VIEWPORT_ID);
        forgetVolumeCropState();
        setCropMode("none");
        removeCachedVolume(activeVolumeIdRef.current);
        activeVolumeIdRef.current = null;
        renderingEngine.enableElement({
          viewportId: VIEWPORT_ID,
          type: Enums.ViewportType.VOLUME_3D,
          element,
          defaultOptions: { background: [0, 0, 0] },
        });
        bindToolsToViewport();

        const volume = await withTimeout(
          volumeLoader.createAndCacheVolume(volumeId, {
            imageIds: series.imageIds,
          }),
          "The 3D volume took too long to prepare.",
          () => removeCachedVolume(volumeId),
        );
        await setVolumesForViewports(
          renderingEngine,
          [{ volumeId }],
          [VIEWPORT_ID],
          true,
        );

        const viewport =
          renderingEngine.getViewport<
            InstanceType<typeof LegacyVolumeViewport3D>
          >(VIEWPORT_ID);
        const preset =
          series.volumePreset ?? getDefaultVolumePreset(series.modality);
        const threshold = series.opacityThreshold ?? 0;
        series.volumePreset = preset;
        series.opacityThreshold = threshold;
        applyVolumePresentation(viewport, preset, threshold);
        viewport.resetCamera();
        alignVolumeCameraForOrbit(viewport);
        series.initialVolumeCamera = cloneCamera(viewport.getCamera());
        viewport.render();
        volume.load(() => viewport.render());
        activeVolumeIdRef.current = volumeId;
        setVolumeToolsActive(true);

        return {
          mode: "volume" as const,
          opacityThreshold: threshold,
          preset,
          warning: null,
        };
      } catch (volumeError) {
        removeCachedVolume(volumeId);
        await displayStack(renderingEngine, element);
        return {
          mode: "stack" as const,
          warning: `3D rendering is unavailable for this series: ${getErrorMessage(volumeError)}`,
        };
      }
    },
    [],
  );

  const goToImage = useCallback((nextIndex: number) => {
    const renderingEngine = renderingEngineRef.current;
    const imageIds = imageIdsRef.current;
    if (
      !renderingEngine ||
      !imageIds.length ||
      viewModeRef.current === "volume"
    ) {
      return;
    }

    const safeIndex = Math.max(0, Math.min(nextIndex, imageIds.length - 1));
    if (safeIndex === currentIndexRef.current) return;

    const previousIndex = currentIndexRef.current;
    const navigationGeneration = ++navigationGenerationRef.current;
    currentIndexRef.current = safeIndex;
    const activeSeries = seriesListRef.current.find(
      (series) => series.id === activeSeriesIdRef.current,
    );
    if (activeSeries) activeSeries.currentIndex = safeIndex;
    setCurrentIndex(safeIndex);
    setError(null);

    const viewport = renderingEngine.getViewport<StackViewport>(VIEWPORT_ID);
    void withTimeout(
      viewport.setImageIdIndex(safeIndex),
      "This slice took too long to decode.",
      () => removeCachedImage(imageIds[safeIndex]),
    ).catch((navigationError: unknown) => {
      if (navigationGeneration !== navigationGenerationRef.current) return;
      currentIndexRef.current = previousIndex;
      if (activeSeries) activeSeries.currentIndex = previousIndex;
      setCurrentIndex(previousIndex);
      setError(getErrorMessage(navigationError));
    });
  }, []);

  const selectSeries = useCallback(
    async (seriesId: string) => {
      if (seriesId === activeSeriesIdRef.current) return;

      const series = seriesListRef.current.find((item) => item.id === seriesId);
      const renderingEngine = renderingEngineRef.current;
      if (!series || !renderingEngine) return;

      exampleHydrationAbortRef.current?.abort();
      exampleHydrationAbortRef.current = null;
      const generation = ++loadGenerationRef.current;
      navigationGenerationRef.current += 1;
      releaseImageIds(pendingImageIdsRef.current);
      pendingImageIdsRef.current = [];
      setIsLoading(true);
      setLoadingMessage("Displaying series…");
      setError(null);

      try {
        if (series.exampleEntry && !series.files.length) {
          const abortController = new AbortController();
          exampleHydrationAbortRef.current = abortController;
          setLoadingMessage("Reading example metadata…");
          await hydrateExampleSeries(series, abortController.signal);
          if (generation !== loadGenerationRef.current) return;
          setSeriesList([...seriesListRef.current]);
        }

        setLoadingMessage(
          viewModeRef.current === "volume"
            ? "Building 3D volume…"
            : "Displaying series…",
        );
        const result = await displaySeries(series, viewModeRef.current);
        if (generation !== loadGenerationRef.current) return;

        viewModeRef.current = result.mode;
        activeSeriesIdRef.current = series.id;
        imageIdsRef.current = series.imageIds;
        currentIndexRef.current = series.currentIndex;
        setViewMode(result.mode);
        if (result.mode === "volume") {
          setVolumePreset(result.preset);
          setOpacityThreshold(result.opacityThreshold);
        }
        setActiveSeriesId(series.id);
        setCurrentIndex(series.currentIndex);
        setImageCount(series.imageIds.length);
        setSeriesFiles(series.files);
        setError(result.warning);

        if (series.isExample && !series.thumbnailUrl) {
          void imageLoader
            .loadAndCacheImage(series.imageIds[series.currentIndex])
            .then((image) =>
              createSeriesThumbnail(
                image,
                series.files[series.currentIndex]?.modality,
              ),
            )
            .then((thumbnailUrl) => {
              series.thumbnailUrl = thumbnailUrl;
              setSeriesList([...seriesListRef.current]);
            })
            .catch(() => {
              // A thumbnail is optional; the selected series is already open.
            });
        }
      } catch (selectionError) {
        if (generation === loadGenerationRef.current) {
          setError(getErrorMessage(selectionError));
        }
      } finally {
        if (generation === loadGenerationRef.current) {
          exampleHydrationAbortRef.current = null;
        }
        if (generation === loadGenerationRef.current) setIsLoading(false);
      }
    },
    [displaySeries],
  );

  const openFiles = useCallback(
    async (files: File[]) => {
      if (!files.length) return;

      const renderingEngine = renderingEngineRef.current;
      if (!renderingEngine) {
        setError("The viewer is still starting. Please try again in a moment.");
        return;
      }

      const generation = ++loadGenerationRef.current;
      navigationGenerationRef.current += 1;
      releaseImageIds(pendingImageIdsRef.current);
      pendingImageIdsRef.current = [];
      setIsLoading(true);
      setLoadingMessage("Reading DICOM headers…");
      setError(null);

      let candidateImageIds: string[] = [];

      try {
        const dicomFiles = await readDicomHeaders(files);
        if (generation !== loadGenerationRef.current) return;

        const seriesInstanceUids = new Set(
          dicomFiles.map((item) => item.seriesInstanceUid),
        );
        if (seriesInstanceUids.size !== 1) {
          throw new Error(
            "The dropped files contain more than one DICOM series. Drop one series at a time.",
          );
        }

        const sortedDicomFiles = sortDicomFiles(dicomFiles);
        const sortedFiles = sortedDicomFiles.map((item) => item.file);

        candidateImageIds = sortedFiles.map((file) =>
          wadouri.fileManager.add(file),
        );
        pendingImageIdsRef.current = candidateImageIds;
        const initialIndex = Math.floor(candidateImageIds.length / 2);

        setLoadingMessage("Decoding first image…");
        const middleImage = await withTimeout(
          imageLoader.loadAndCacheImage(candidateImageIds[initialIndex]),
          "The first image took too long to decode. Check that the files contain DICOM pixel data.",
          () => releaseImageIds(candidateImageIds),
        );
        if (generation !== loadGenerationRef.current) {
          releaseImageIds(candidateImageIds);
          return;
        }

        const thumbnailUrl = await createSeriesThumbnail(
          middleImage,
          sortedDicomFiles[initialIndex]?.modality,
        );
        if (generation !== loadGenerationRef.current) {
          releaseImageIds(candidateImageIds);
          return;
        }

        const firstFile = sortedDicomFiles[0];
        const newSeries: DicomSeries = {
          id: `${firstFile.seriesInstanceUid}-${++nextSeriesIdRef.current}`,
          files: sortedDicomFiles,
          imageIds: candidateImageIds,
          currentIndex: initialIndex,
          imageCount: candidateImageIds.length,
          label:
            firstFile.seriesDescription ||
            firstFile.studyDescription ||
            `Series ${seriesListRef.current.length + 1}`,
          modality: firstFile.modality,
          seriesInstanceUid: firstFile.seriesInstanceUid,
          thumbnailUrl,
        };

        setLoadingMessage(
          viewModeRef.current === "volume"
            ? "Building 3D volume…"
            : "Displaying series…",
        );
        const result = await displaySeries(newSeries, viewModeRef.current);
        if (generation !== loadGenerationRef.current) {
          releaseImageIds(candidateImageIds);
          return;
        }

        const nextSeriesList = [...seriesListRef.current, newSeries];
        seriesListRef.current = nextSeriesList;
        imageIdsRef.current = candidateImageIds;
        pendingImageIdsRef.current = [];
        activeSeriesIdRef.current = newSeries.id;
        currentIndexRef.current = initialIndex;
        viewModeRef.current = result.mode;
        setSeriesList(nextSeriesList);
        setActiveSeriesId(newSeries.id);
        setViewMode(result.mode);
        if (result.mode === "volume") {
          setVolumePreset(result.preset);
          setOpacityThreshold(result.opacityThreshold);
        }
        setCurrentIndex(initialIndex);
        setImageCount(candidateImageIds.length);
        setSeriesFiles(sortedDicomFiles);
        setError(result.warning);
      } catch (loadError) {
        if (generation !== loadGenerationRef.current) {
          releaseImageIds(candidateImageIds);
          return;
        }
        releaseImageIds(candidateImageIds);
        pendingImageIdsRef.current = [];
        setError(getErrorMessage(loadError));
      } finally {
        if (generation === loadGenerationRef.current) setIsLoading(false);
      }
    },
    [displaySeries],
  );

  function handleFileSelection(event: ChangeEvent<HTMLInputElement>) {
    void openFiles(Array.from(event.target.files || []));
    event.target.value = "";
  }

  async function switchViewMode(nextMode: ViewMode) {
    if (nextMode === viewModeRef.current || isLoading) return;

    const series = seriesListRef.current.find(
      (item) => item.id === activeSeriesIdRef.current,
    );
    if (!series) return;

    const generation = ++loadGenerationRef.current;
    navigationGenerationRef.current += 1;
    setIsLoading(true);
    setLoadingMessage(
      nextMode === "volume" ? "Building 3D volume…" : "Returning to slices…",
    );
    setError(null);

    try {
      const result = await displaySeries(series, nextMode);
      if (generation !== loadGenerationRef.current) return;

      viewModeRef.current = result.mode;
      setViewMode(result.mode);
      if (result.mode === "volume") {
        setVolumePreset(result.preset);
        setOpacityThreshold(result.opacityThreshold);
      }
      setError(result.warning);
    } catch (modeError) {
      if (generation === loadGenerationRef.current) {
        setError(getErrorMessage(modeError));
      }
    } finally {
      if (generation === loadGenerationRef.current) setIsLoading(false);
    }
  }

  function resetVolumeCamera() {
    const renderingEngine = renderingEngineRef.current;
    const series = seriesListRef.current.find(
      (item) => item.id === activeSeriesIdRef.current,
    );
    if (!renderingEngine || !series || viewModeRef.current !== "volume") {
      return;
    }

    try {
      const viewport =
        renderingEngine.getViewport<
          InstanceType<typeof LegacyVolumeViewport3D>
        >(VIEWPORT_ID);
      const defaultPreset = getDefaultVolumePreset(series.modality);

      clearVolumeCrop();
      applyVolumePresentation(viewport, defaultPreset, 0);
      if (series.initialVolumeCamera) {
        viewport.setCamera(cloneCamera(series.initialVolumeCamera));
      } else {
        viewport.resetCamera();
      }
      viewport.render();

      series.volumePreset = defaultPreset;
      series.opacityThreshold = 0;
      setVolumePreset(defaultPreset);
      setOpacityThreshold(0);
      setError(null);
    } catch (resetError) {
      setError(`Could not reset the 3D view: ${getErrorMessage(resetError)}`);
    }
  }

  function changeVolumePreset(nextPreset: string) {
    const renderingEngine = renderingEngineRef.current;
    const series = seriesListRef.current.find(
      (item) => item.id === activeSeriesIdRef.current,
    );
    if (!renderingEngine || !series || viewModeRef.current !== "volume") {
      return;
    }

    try {
      const viewport =
        renderingEngine.getViewport<
          InstanceType<typeof LegacyVolumeViewport3D>
        >(VIEWPORT_ID);
      applyVolumePresentation(
        viewport,
        nextPreset,
        series.opacityThreshold ?? 0,
      );
      viewport.render();
      series.volumePreset = nextPreset;
      setVolumePreset(nextPreset);
      setError(null);
    } catch (presetError) {
      setError(`Could not apply this preset: ${getErrorMessage(presetError)}`);
    }
  }

  function changeOpacityThreshold(nextThreshold: number) {
    const renderingEngine = renderingEngineRef.current;
    const series = seriesListRef.current.find(
      (item) => item.id === activeSeriesIdRef.current,
    );
    if (!renderingEngine || !series || viewModeRef.current !== "volume") {
      return;
    }

    try {
      const viewport =
        renderingEngine.getViewport<
          InstanceType<typeof LegacyVolumeViewport3D>
        >(VIEWPORT_ID);
      const preset =
        series.volumePreset ?? getDefaultVolumePreset(series.modality);
      applyVolumePresentation(viewport, preset, nextThreshold);
      viewport.render();
      series.opacityThreshold = nextThreshold;
      setOpacityThreshold(nextThreshold);
      setError(null);
    } catch (thresholdError) {
      setError(
        `Could not apply the opacity threshold: ${getErrorMessage(thresholdError)}`,
      );
    }
  }

  function toggleCroppingMode() {
    const renderingEngine = renderingEngineRef.current;
    if (!renderingEngine || viewModeRef.current !== "volume") return;

    try {
      const viewport =
        renderingEngine.getViewport<
          InstanceType<typeof LegacyVolumeViewport3D>
        >(VIEWPORT_ID);
      if (cropMode === "editing") {
        applyCurrentCrop(viewport);
        setCropMode("applied");
      } else {
        startCropEditing();
        setCropMode("editing");
      }
      setError(null);
    } catch (cropError) {
      setError(`Could not update cropping: ${getErrorMessage(cropError)}`);
    }
  }

  function clearVolumeCrop() {
    const renderingEngine = renderingEngineRef.current;
    const series = seriesListRef.current.find(
      (item) => item.id === activeSeriesIdRef.current,
    );
    if (!renderingEngine || viewModeRef.current !== "volume") return;

    try {
      const viewport =
        renderingEngine.getViewport<
          InstanceType<typeof LegacyVolumeViewport3D>
        >(VIEWPORT_ID);
      clearCurrentCrop(viewport, series?.initialVolumeCamera?.focalPoint);
      setCropMode("none");
      setError(null);
    } catch (cropError) {
      setError(`Could not clear the crop: ${getErrorMessage(cropError)}`);
    }
  }

  function handleDragEnter(event: DragEvent) {
    event.preventDefault();
    dragDepthRef.current += 1;
    setIsDragging(true);
  }

  function handleDragLeave(event: DragEvent) {
    event.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setIsDragging(false);
  }

  function handleDrop(event: DragEvent) {
    event.preventDefault();
    dragDepthRef.current = 0;
    setIsDragging(false);
    void openFiles(Array.from(event.dataTransfer.files));
  }

  function handleWheel(event: WheelEvent<HTMLDivElement>) {
    if (!imageCount || event.deltaY === 0) return;
    if (viewModeRef.current === "volume") {
      beginVolumeInteraction();
      scheduleFinalVolumeRender();
      return;
    }

    event.preventDefault();
    goToImage(currentIndexRef.current + (event.deltaY > 0 ? 1 : -1));
  }

  function setVolumeSampleDistance(multiplier: number) {
    const renderingEngine = renderingEngineRef.current;
    if (!renderingEngine || viewModeRef.current !== "volume") return;

    try {
      const viewport =
        renderingEngine.getViewport<
          InstanceType<typeof LegacyVolumeViewport3D>
        >(VIEWPORT_ID);
      viewport.setSampleDistanceMultiplier(multiplier);
    } catch {
      // The viewport may be changing between stack and volume modes.
    }
  }

  function beginVolumeInteraction() {
    if (renderQualityRestoreTimerRef.current !== null) {
      window.clearTimeout(renderQualityRestoreTimerRef.current);
      renderQualityRestoreTimerRef.current = null;
    }
    setVolumeSampleDistance(INTERACTIVE_SAMPLE_DISTANCE_MULTIPLIER);
  }

  function scheduleFinalVolumeRender() {
    if (renderQualityRestoreTimerRef.current !== null) {
      window.clearTimeout(renderQualityRestoreTimerRef.current);
    }
    renderQualityRestoreTimerRef.current = window.setTimeout(() => {
      renderQualityRestoreTimerRef.current = null;
      setVolumeSampleDistance(FINAL_SAMPLE_DISTANCE_MULTIPLIER);
    }, RENDER_QUALITY_RESTORE_DELAY_MS);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!imageCount || viewModeRef.current === "volume") return;

    const destinations: Record<string, number> = {
      ArrowDown: currentIndexRef.current + 1,
      ArrowRight: currentIndexRef.current + 1,
      ArrowUp: currentIndexRef.current - 1,
      ArrowLeft: currentIndexRef.current - 1,
      Home: 0,
      End: imageCount - 1,
    };

    if (destinations[event.key] !== undefined) {
      event.preventDefault();
      goToImage(destinations[event.key]);
    }
  }

  return (
    <div
      className="medview-app dark flex h-svh min-h-[520px] flex-col overflow-hidden bg-background text-foreground"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={(event) => event.preventDefault()}
      onDrop={handleDrop}
    >
      <input
        ref={fileInputRef}
        className="sr-only"
        type="file"
        multiple
        onChange={handleFileSelection}
      />

      <main className="relative flex min-h-0 flex-1">
        <SeriesPicker
          activeSeriesId={activeSeriesId}
          disabled={!isReady || isLoading}
          isLoadingExamples={isLoadingExamples}
          series={seriesList}
          onAdd={() => fileInputRef.current?.click()}
          onSelect={(seriesId) => void selectSeries(seriesId)}
        />

        <section className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div
            ref={viewerPanelsRef}
            className="grid min-h-0 flex-1"
            style={{
              gridTemplateRows:
                viewMode === "stack"
                  ? `minmax(${MIN_VIEWER_PANEL_HEIGHT}px, ${anatomyPanelSize}fr) auto minmax(${MIN_VIEWER_PANEL_HEIGHT}px, ${100 - anatomyPanelSize}fr)`
                  : "minmax(0, 1fr)",
            }}
          >
            {viewMode === "stack" && (
              <>
                <AnatomyViewer slicePlane={slicePlane} />

                <PanelResizeHandle
                  containerRef={viewerPanelsRef}
                  label="Resize anatomy and DICOM viewer panels"
                  minFirstSize={MIN_VIEWER_PANEL_HEIGHT}
                  minSecondSize={MIN_VIEWER_PANEL_HEIGHT}
                  orientation="horizontal"
                  value={anatomyPanelSize}
                  onChange={setAnatomyPanelSize}
                  onReset={() =>
                    setAnatomyPanelSize(DEFAULT_ANATOMY_PANEL_SIZE)
                  }
                />
              </>
            )}

            <div
              className="@container relative min-h-0 min-w-0 touch-none overflow-hidden bg-black outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onWheel={handleWheel}
              onPointerDown={beginVolumeInteraction}
              onPointerUp={scheduleFinalVolumeRender}
              onPointerCancel={scheduleFinalVolumeRender}
              onLostPointerCapture={scheduleFinalVolumeRender}
              onKeyDown={handleKeyDown}
              tabIndex={0}
              aria-label="DICOM image viewport. Use the mouse wheel or arrow keys to move through the series."
            >
              <div ref={viewportElementRef} className="absolute inset-0" />

              {imageCount > 0 && (
                <div className="absolute right-3 top-3 z-10 flex rounded-md border border-white/10 bg-black/70 p-1 backdrop-blur-sm">
                  <Button
                    className="h-8 gap-1.5 px-2.5"
                    variant={viewMode === "stack" ? "secondary" : "ghost"}
                    size="sm"
                    disabled={isLoading}
                    aria-pressed={viewMode === "stack"}
                    onClick={() => void switchViewMode("stack")}
                  >
                    <Rows3 className="size-3.5" />
                    2D
                  </Button>
                  <Button
                    className="h-8 gap-1.5 px-2.5"
                    variant={viewMode === "volume" ? "secondary" : "ghost"}
                    size="sm"
                    disabled={isLoading}
                    aria-pressed={viewMode === "volume"}
                    onClick={() => void switchViewMode("volume")}
                  >
                    <Box className="size-3.5" />
                    3D
                  </Button>
                </div>
              )}

              {imageCount > 0 && viewMode === "volume" && (
                <VolumeRenderingOptions
                  hasCrop={hasCrop}
                  isCropping={isCropping}
                  isOpen={isVolumeOptionsOpen}
                  opacityThreshold={opacityThreshold}
                  preset={volumePreset}
                  presets={volumePresetOptions}
                  onClearCrop={clearVolumeCrop}
                  onClose={() => setIsVolumeOptionsOpen(false)}
                  onOpen={() => setIsVolumeOptionsOpen(true)}
                  onPresetChange={changeVolumePreset}
                  onThresholdChange={changeOpacityThreshold}
                  onToggleCrop={toggleCroppingMode}
                />
              )}

              {!imageCount && !isLoading && (
                <div className="pointer-events-none absolute inset-0 grid place-items-center p-6">
                  <div className="text-center">
                    <FileImage className="mx-auto size-7 text-muted-foreground" />
                    <p className="mt-3 text-sm text-muted-foreground">
                      {isReady
                        ? "Drop a DICOM series to begin"
                        : "Starting viewer…"}
                    </p>
                    {isReady && (
                      <Button
                        className="pointer-events-auto mt-4"
                        variant="secondary"
                        size="sm"
                        onClick={() => fileInputRef.current?.click()}
                      >
                        Choose files
                      </Button>
                    )}
                  </div>
                </div>
              )}

              {isLoading && (
                <div className="absolute inset-0 grid place-items-center bg-black/80">
                  <div className="text-center">
                    <Loader2 className="mx-auto size-5 animate-spin" />
                    <p className="mt-3 text-sm text-muted-foreground">
                      {loadingMessage}
                    </p>
                  </div>
                </div>
              )}

              {error && !isLoading && (
                <Card className="absolute left-1/2 top-4 w-[min(28rem,calc(100%-2rem))] -translate-x-1/2 border-destructive/50 bg-background shadow-none">
                  <CardContent className="flex gap-2.5 p-3 text-sm">
                    <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
                    <p>{error}</p>
                  </CardContent>
                </Card>
              )}

              {imageCount > 0 && viewMode === "stack" && (
                <DicomMetadataOverlay
                  metadata={seriesFiles[currentIndex]}
                  currentIndex={currentIndex}
                  imageCount={imageCount}
                />
              )}
            </div>
          </div>

          <div className="flex h-16 shrink-0 items-center gap-3 border-t px-3 sm:px-4">
            {viewMode === "stack" ? (
              <>
                <Button
                  variant="outline"
                  size="icon"
                  aria-label="Previous image"
                  disabled={!imageCount || currentIndex === 0}
                  onClick={() => goToImage(currentIndexRef.current - 1)}
                >
                  <ChevronLeft />
                </Button>

                <input
                  aria-label="Current image"
                  className="h-2 min-w-0 flex-1 cursor-pointer accent-primary disabled:cursor-not-allowed disabled:opacity-40"
                  type="range"
                  min={0}
                  max={Math.max(0, imageCount - 1)}
                  value={currentIndex}
                  disabled={!imageCount}
                  onChange={(event) => goToImage(Number(event.target.value))}
                />

                <span className="w-20 text-center font-mono text-xs tabular-nums text-muted-foreground">
                  {imageCount ? currentIndex + 1 : 0} / {imageCount}
                </span>

                <Button
                  variant="outline"
                  size="icon"
                  aria-label="Next image"
                  disabled={!imageCount || currentIndex === imageCount - 1}
                  onClick={() => goToImage(currentIndexRef.current + 1)}
                >
                  <ChevronRight />
                </Button>
              </>
            ) : (
              <>
                <p className="min-w-0 flex-1 text-sm text-muted-foreground">
                  {isCropping
                    ? "Drag crop handles · Pinch or scroll to zoom"
                    : "Drag to rotate · Pinch or scroll to zoom"}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2"
                  onClick={resetVolumeCamera}
                >
                  <RotateCcw className="size-4" />
                  Reset view
                </Button>
              </>
            )}
          </div>
        </section>

        {isDragging && (
          <div className="pointer-events-none absolute inset-3 z-50 grid place-items-center rounded-lg border-2 border-dashed border-primary bg-background/95">
            <div className="text-center">
              <Upload className="mx-auto size-6" />
              <p className="mt-3 text-sm font-medium">Drop files to open</p>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
