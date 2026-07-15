import {
  Enums,
  imageLoader,
  LegacyVolumeViewport3D,
  RenderingEngine,
  setVolumesForViewports,
  StackViewport,
  volumeLoader,
} from "@cornerstonejs/core";
import { wadouri } from "@cornerstonejs/dicom-image-loader";
import {
  type ChangeEvent,
  type DragEvent,
  type KeyboardEvent,
  type WheelEvent,
  useCallback,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";

import {
  getDicomSlicePlane,
  hydrateExampleSeries,
  readDicomHeaders,
  sortDicomFiles,
} from "@/dicom/series";
import type {
  DicomFileInfo,
  DicomSeries,
  ViewMode,
} from "@/dicom/types";
import { useCornerstoneViewer } from "@/hooks/use-cornerstone-viewer";
import { useSeriesLibrary } from "@/hooks/use-series-library";
import {
  createSeriesThumbnail,
  getErrorMessage,
  releaseImageIds,
  removeCachedImage,
  withTimeout,
} from "@/viewer/cornerstone-runtime";
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
  setVolumeToolsActive,
  startCropEditing,
  VIEWPORT_ID,
} from "@/viewer/volume-controller";
import {
  initialViewerFeedbackState,
  viewerFeedbackReducer,
} from "@/viewer/viewer-feedback";

const DEFAULT_ANATOMY_PANEL_SIZE = 35;
const INTERACTIVE_SAMPLE_DISTANCE_MULTIPLIER = 6;
const FINAL_SAMPLE_DISTANCE_MULTIPLIER = 1;
const RENDER_QUALITY_RESTORE_DELAY_MS = 140;

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

export function useMedViewController() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const exampleHydrationAbortRef = useRef<AbortController | null>(null);
  const currentIndexRef = useRef(0);
  const imageIdsRef = useRef<string[]>([]);
  const viewModeRef = useRef<ViewMode>("stack");
  const dragDepthRef = useRef(0);
  const loadGenerationRef = useRef(0);
  const navigationGenerationRef = useRef(0);
  const viewerPanelsRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [{ error, isLoading, loadingMessage }, dispatchViewerFeedback] =
    useReducer(viewerFeedbackReducer, initialViewerFeedbackState);
  const setError = useCallback(
    (nextError: string | null) =>
      dispatchViewerFeedback({ type: "error", error: nextError }),
    [],
  );
  const setLoadingMessage = useCallback(
    (message: string) =>
      dispatchViewerFeedback({ type: "message", message }),
    [],
  );
  const startLoading = useCallback(
    (message: string) => dispatchViewerFeedback({ type: "start", message }),
    [],
  );
  const stopLoading = useCallback(
    () => dispatchViewerFeedback({ type: "stop" }),
    [],
  );
  const {
    activeSeriesId,
    activeSeriesIdRef,
    isLoadingExamples,
    nextSeriesIdRef,
    seriesList,
    seriesListRef,
    setActiveSeriesId,
    setSeriesList,
  } = useSeriesLibrary(setError);
  const {
    activeVolumeIdRef,
    isReady,
    pendingImageIdsRef,
    renderingEngineRef,
    renderQualityRestoreTimerRef,
    viewportElementRef,
  } = useCornerstoneViewer({
    exampleHydrationAbortRef,
    imageIdsRef,
    loadGenerationRef,
    navigationGenerationRef,
    onError: setError,
    seriesListRef,
    viewModeRef,
  });
  const [currentIndex, setCurrentIndex] = useState(0);
  const [imageCount, setImageCount] = useState(0);
  const [seriesFiles, setSeriesFiles] = useState<DicomFileInfo[]>([]);
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
    [activeVolumeIdRef, renderingEngineRef, viewportElementRef],
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
  }, [activeSeriesIdRef, renderingEngineRef, seriesListRef, setError]);

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
      startLoading("Displaying series…");

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
        if (generation === loadGenerationRef.current) stopLoading();
      }
    },
    [
      activeSeriesIdRef,
      displaySeries,
      pendingImageIdsRef,
      renderingEngineRef,
      seriesListRef,
      setActiveSeriesId,
      setError,
      setLoadingMessage,
      setSeriesList,
      startLoading,
      stopLoading,
    ],
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
      startLoading("Reading DICOM headers…");

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
        if (generation === loadGenerationRef.current) stopLoading();
      }
    },
    [
      activeSeriesIdRef,
      displaySeries,
      nextSeriesIdRef,
      pendingImageIdsRef,
      renderingEngineRef,
      seriesListRef,
      setActiveSeriesId,
      setError,
      setLoadingMessage,
      setSeriesList,
      startLoading,
      stopLoading,
    ],
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
    startLoading(
      nextMode === "volume" ? "Building 3D volume…" : "Returning to slices…",
    );

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
      if (generation === loadGenerationRef.current) stopLoading();
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


  return {
    activeSeriesId,
    anatomyPanelSize,
    beginVolumeInteraction,
    changeOpacityThreshold,
    changeVolumePreset,
    clearVolumeCrop,
    currentIndex,
    error,
    fileInputRef,
    goToImage,
    handleDragEnter,
    handleDragLeave,
    handleDrop,
    handleFileSelection,
    handleKeyDown,
    handleWheel,
    hasCrop,
    imageCount,
    isCropping,
    isDragging,
    isLoading,
    isLoadingExamples,
    isReady,
    isVolumeOptionsOpen,
    loadingMessage,
    opacityThreshold,
    resetVolumeCamera,
    scheduleFinalVolumeRender,
    selectSeries,
    seriesFiles,
    seriesList,
    setAnatomyPanelSize,
    setIsVolumeOptionsOpen,
    slicePlane,
    switchViewMode,
    toggleCroppingMode,
    viewMode,
    viewerPanelsRef,
    viewportElementRef,
    volumePreset,
    volumePresetOptions,
  };
}
