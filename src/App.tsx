import {
  cache,
  Enums,
  imageLoader,
  RenderingEngine,
  StackViewport,
  init as initCornerstoneCore,
} from "@cornerstonejs/core";
import {
  init as initDicomImageLoader,
  wadouri,
} from "@cornerstonejs/dicom-image-loader";
import {
  Enums as MetadataEnums,
  utilities as metadataUtilities,
} from "@cornerstonejs/metadata";
import { parseDicom, type DataSet } from "dicom-parser";
import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  FileImage,
  Loader2,
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
  type DicomSlicePlane,
} from "@/components/anatomy-viewer";
import {
  DicomMetadataOverlay,
  type DicomMetadata,
} from "@/components/dicom-metadata-overlay";
import { PanelResizeHandle } from "@/components/panel-resize-handle";

const RENDERING_ENGINE_ID = "medview-rendering-engine";
const VIEWPORT_ID = "medview-stack-viewport";
const LOAD_TIMEOUT_MS = 30_000;
const HEADER_READ_SIZE = 1024 * 1024;
const HEADER_READER_COUNT = 4;
const DEFAULT_ANATOMY_PANEL_SIZE = 35;
const MIN_VIEWER_PANEL_HEIGHT = 140;
const fileNameCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

let initializationPromise: Promise<void> | undefined;

type Vector3 = [number, number, number];

type DicomFileInfo = DicomMetadata & {
  file: File;
  imageOrientation?: [number, number, number, number, number, number];
  imagePosition?: Vector3;
  patientHeightMm?: number;
  instanceNumber?: number;
  seriesInstanceUid: string;
};

function initializeCornerstone() {
  if (!initializationPromise) {
    initializationPromise = Promise.resolve().then(() => {
      initCornerstoneCore();
      initDicomImageLoader({
        maxWebWorkers: Math.max(
          1,
          Math.min(navigator.hardwareConcurrency || 1, 4),
        ),
      });
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

function parseNumberList(value: string | undefined, length: number) {
  if (!value) return undefined;

  const values = value.split("\\").map(Number);
  if (
    values.length !== length ||
    values.some((item) => !Number.isFinite(item))
  ) {
    return undefined;
  }

  return values;
}

function parseFirstNumber(value: string | undefined) {
  const firstValue = value?.split("\\")[0].trim();
  if (!firstValue) return undefined;
  const number = Number(firstValue);
  return Number.isFinite(number) ? number : undefined;
}

async function parseDicomHeader(file: File): Promise<DicomFileInfo> {
  function parse(blob: Blob): Promise<DataSet> {
    return blob.arrayBuffer().then((buffer) =>
      parseDicom(new Uint8Array(buffer), {
        untilTag: "x7fe00010",
      }),
    );
  }

  let dataSet: DataSet;
  const headerBlob = file.slice(0, Math.min(file.size, HEADER_READ_SIZE));

  try {
    dataSet = await parse(headerBlob);
  } catch {
    try {
      dataSet = await parse(file);
    } catch {
      throw new Error(`${file.name} is not a readable DICOM Part 10 file.`);
    }
  }

  const seriesInstanceUid = dataSet.string("x0020000e")?.trim();
  if (!seriesInstanceUid) {
    throw new Error(`${file.name} does not contain a Series Instance UID.`);
  }

  const imagePosition = parseNumberList(
    dataSet.string("x00200032"),
    3,
  ) as Vector3 | undefined;
  const imageOrientation = parseNumberList(
    dataSet.string("x00200037"),
    6,
  ) as DicomFileInfo["imageOrientation"];
  const pixelSpacing = parseNumberList(
    dataSet.string("x00280030"),
    2,
  ) as DicomFileInfo["pixelSpacing"];
  const rows = dataSet.uint16("x00280010");
  const columns = dataSet.uint16("x00280011");
  const bodyPart = dataSet.string("x00180015")?.trim();
  const modality = dataSet.string("x00080060")?.trim();
  const studyDate = dataSet.string("x00080020")?.trim();
  const seriesDescription = dataSet.string("x0008103e")?.trim();
  const studyDescription = dataSet.string("x00081030")?.trim();
  const patientName = dataSet.string("x00100010")?.trim();
  const patientId = dataSet.string("x00100020")?.trim();
  const patientSex = dataSet.string("x00100040")?.trim();
  const patientAge = dataSet.string("x00101010")?.trim();
  const patientPosition = dataSet.string("x00185100")?.trim();
  const sliceThicknessMm = parseFirstNumber(dataSet.string("x00180050"));
  const windowCenter = parseFirstNumber(dataSet.string("x00281050"));
  const windowWidth = parseFirstNumber(dataSet.string("x00281051"));
  const patientSizeMeters = Number(dataSet.string("x00101020"));
  const patientHeightMm =
    Number.isFinite(patientSizeMeters) && patientSizeMeters > 0
      ? patientSizeMeters * 1000
      : undefined;
  const instanceNumber = dataSet.intString("x00200013");

  return {
    file,
    imageOrientation,
    imagePosition,
    pixelSpacing,
    rows,
    columns,
    bodyPart,
    modality,
    studyDate,
    seriesDescription,
    studyDescription,
    patientName,
    patientId,
    patientSex,
    patientAge,
    patientPosition,
    sliceThicknessMm,
    windowCenter,
    windowWidth,
    patientHeightMm,
    instanceNumber,
    seriesInstanceUid,
  };
}

async function readDicomHeaders(files: File[]) {
  const results = new Array<DicomFileInfo>(files.length);
  let nextIndex = 0;

  async function readNext() {
    while (nextIndex < files.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await parseDicomHeader(files[index]);
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(HEADER_READER_COUNT, files.length) },
      readNext,
    ),
  );

  return results;
}

function getSliceNormal(
  orientation: DicomFileInfo["imageOrientation"],
): Vector3 | undefined {
  if (!orientation) return undefined;

  const normal: Vector3 = [
    orientation[1] * orientation[5] - orientation[2] * orientation[4],
    orientation[2] * orientation[3] - orientation[0] * orientation[5],
    orientation[0] * orientation[4] - orientation[1] * orientation[3],
  ];
  const magnitude = Math.hypot(...normal);

  if (!magnitude) return undefined;
  return normal.map((value) => value / magnitude) as Vector3;
}

function sortDicomFiles(files: DicomFileInfo[]) {
  const normal = getSliceNormal(
    files.find((item) => item.imageOrientation)?.imageOrientation,
  );
  const hasSpatialOrder = Boolean(
    normal && files.every((item) => item.imagePosition),
  );

  return [...files].sort((first, second) => {
    if (hasSpatialOrder && normal) {
      const firstPosition = first.imagePosition as Vector3;
      const secondPosition = second.imagePosition as Vector3;
      const firstDistance = firstPosition.reduce(
        (distance, value, index) => distance + value * normal[index],
        0,
      );
      const secondDistance = secondPosition.reduce(
        (distance, value, index) => distance + value * normal[index],
        0,
      );

      if (Math.abs(firstDistance - secondDistance) > 0.0001) {
        return firstDistance - secondDistance;
      }
    }

    if (
      first.instanceNumber !== undefined &&
      second.instanceNumber !== undefined &&
      first.instanceNumber !== second.instanceNumber
    ) {
      return first.instanceNumber - second.instanceNumber;
    }

    return fileNameCollator.compare(first.file.name, second.file.name);
  });
}

function getDicomSlicePlane(
  files: DicomFileInfo[],
  index: number,
): DicomSlicePlane | null {
  const current = files[index];
  if (
    !current?.imageOrientation ||
    !current.imagePosition ||
    !current.pixelSpacing ||
    current.pixelSpacing.some((spacing) => spacing <= 0) ||
    !current.rows ||
    !current.columns
  ) {
    return null;
  }

  const normal = getSliceNormal(current.imageOrientation);
  if (!normal) return null;

  const sliceDistances = files.flatMap((file) => {
    if (!file.imagePosition) return [];
    return [
      file.imagePosition.reduce(
        (distance, value, coordinate) =>
          distance + value * normal[coordinate],
        0,
      ),
    ];
  });
  if (!sliceDistances.length) return null;

  const currentDistance = current.imagePosition.reduce(
    (distance, value, coordinate) =>
      distance + value * normal[coordinate],
    0,
  );
  const seriesCenter =
    (Math.min(...sliceDistances) + Math.max(...sliceDistances)) / 2;

  return {
    anatomicalCenterHeightFraction:
      getAnatomicalCenterHeightFraction(current),
    imageOrientation: current.imageOrientation,
    offsetFromSeriesCenterMm: currentDistance - seriesCenter,
    patientHeightMm: current.patientHeightMm,
    widthMm: current.columns * current.pixelSpacing[1],
    heightMm: current.rows * current.pixelSpacing[0],
  };
}

function getAnatomicalCenterHeightFraction(file: DicomFileInfo) {
  const region = [file.bodyPart, file.seriesDescription, file.studyDescription]
    .filter(Boolean)
    .join(" ")
    .toUpperCase();

  if (/WHOLE.?BODY|FULL.?BODY/.test(region)) return 0;
  if (/CHEST.*ABD.*PELV|THORAX.*ABD.*PELV/.test(region)) return 0.19;
  if (/CHEST.*ABD|THORAX.*ABD/.test(region)) return 0.16;
  if (/ABD.*PELV/.test(region)) return -0.01;
  if (/HEAD|BRAIN|SKULL/.test(region)) return 0.45;
  if (/NECK|CERVICAL/.test(region)) return 0.35;
  if (/CHEST|THORAX|LUNG|COVID/.test(region)) return 0.21;
  if (/ABDOMEN|ABDOMINAL/.test(region)) return 0.03;
  if (/PELVIS|PELVIC|HIP/.test(region)) return -0.12;
  if (/LEG|LOWER.?EXTREM/.test(region)) return -0.32;
  return 0;
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
  const currentIndexRef = useRef(0);
  const imageIdsRef = useRef<string[]>([]);
  const dragDepthRef = useRef(0);
  const loadGenerationRef = useRef(0);
  const navigationGenerationRef = useRef(0);
  const pendingImageIdsRef = useRef<string[]>([]);
  const viewerPanelsRef = useRef<HTMLDivElement>(null);

  const [isReady, setIsReady] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState("Opening series…");
  const [error, setError] = useState<string | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [imageCount, setImageCount] = useState(0);
  const [seriesFiles, setSeriesFiles] = useState<DicomFileInfo[]>([]);
  const [anatomyPanelSize, setAnatomyPanelSize] = useState(
    DEFAULT_ANATOMY_PANEL_SIZE,
  );
  const slicePlane = useMemo(
    () => getDicomSlicePlane(seriesFiles, currentIndex),
    [currentIndex, seriesFiles],
  );

  useEffect(() => {
    let cancelled = false;
    let resizeObserver: ResizeObserver | undefined;

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

        resizeObserver = new ResizeObserver(() => {
          renderingEngine.resize(true, true);
        });
        resizeObserver.observe(viewportElementRef.current);
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
      resizeObserver?.disconnect();
      renderingEngineRef.current?.destroy();
      renderingEngineRef.current = null;
      releaseImageIds(pendingImageIdsRef.current);
      releaseImageIds(imageIdsRef.current);
      pendingImageIdsRef.current = [];
      imageIdsRef.current = [];
    };
  }, []);

  const goToImage = useCallback((nextIndex: number) => {
    const renderingEngine = renderingEngineRef.current;
    const imageIds = imageIdsRef.current;
    if (!renderingEngine || !imageIds.length) return;

    const safeIndex = Math.max(0, Math.min(nextIndex, imageIds.length - 1));
    if (safeIndex === currentIndexRef.current) return;

    const previousIndex = currentIndexRef.current;
    const navigationGeneration = ++navigationGenerationRef.current;
    currentIndexRef.current = safeIndex;
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
      setCurrentIndex(previousIndex);
      setError(getErrorMessage(navigationError));
    });
  }, []);

  const openFiles = useCallback(async (files: File[]) => {
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
      await withTimeout(
        imageLoader.loadAndCacheImage(candidateImageIds[initialIndex]),
        "The first image took too long to decode. Check that the files contain DICOM pixel data.",
        () => releaseImageIds(candidateImageIds),
      );
      if (generation !== loadGenerationRef.current) {
        releaseImageIds(candidateImageIds);
        return;
      }

      setLoadingMessage("Displaying series…");
      const viewport = renderingEngine.getViewport<StackViewport>(VIEWPORT_ID);
      await withTimeout(
        viewport.setStack(candidateImageIds, initialIndex),
        "The image was decoded, but the viewer could not display it.",
        () => releaseImageIds(candidateImageIds),
      );
      if (generation !== loadGenerationRef.current) {
        releaseImageIds(candidateImageIds);
        return;
      }

      viewport.render();
      const previousImageIds = imageIdsRef.current;
      imageIdsRef.current = candidateImageIds;
      pendingImageIdsRef.current = [];
      currentIndexRef.current = initialIndex;
      setCurrentIndex(initialIndex);
      setImageCount(candidateImageIds.length);
      setSeriesFiles(sortedDicomFiles);
      releaseImageIds(previousImageIds);
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
  }, []);

  function handleFileSelection(event: ChangeEvent<HTMLInputElement>) {
    void openFiles(Array.from(event.target.files || []));
    event.target.value = "";
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
    event.preventDefault();
    goToImage(currentIndexRef.current + (event.deltaY > 0 ? 1 : -1));
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!imageCount) return;

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
      className="dark flex h-svh min-h-[520px] flex-col overflow-hidden bg-background text-foreground"
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
        <section className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div
            ref={viewerPanelsRef}
            className="grid min-h-0 flex-1"
            style={{
              gridTemplateRows: `minmax(${MIN_VIEWER_PANEL_HEIGHT}px, ${anatomyPanelSize}fr) auto minmax(${MIN_VIEWER_PANEL_HEIGHT}px, ${100 - anatomyPanelSize}fr)`,
            }}
          >
            <AnatomyViewer slicePlane={slicePlane} />

            <PanelResizeHandle
              containerRef={viewerPanelsRef}
              label="Resize anatomy and DICOM viewer panels"
              minFirstSize={MIN_VIEWER_PANEL_HEIGHT}
              minSecondSize={MIN_VIEWER_PANEL_HEIGHT}
              orientation="horizontal"
              value={anatomyPanelSize}
              onChange={setAnatomyPanelSize}
              onReset={() => setAnatomyPanelSize(DEFAULT_ANATOMY_PANEL_SIZE)}
            />

            <div
              className="relative min-h-0 overflow-hidden bg-black outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onWheel={handleWheel}
              onKeyDown={handleKeyDown}
              tabIndex={0}
              aria-label="DICOM image viewport. Use the mouse wheel or arrow keys to move through the series."
            >
              <div ref={viewportElementRef} className="absolute inset-0" />

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

              {imageCount > 0 && (
              <DicomMetadataOverlay
                metadata={seriesFiles[currentIndex]}
                currentIndex={currentIndex}
                imageCount={imageCount}
              />
              )}
            </div>
          </div>

          <div className="flex h-16 shrink-0 items-center gap-3 border-t px-3 sm:px-4">
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
