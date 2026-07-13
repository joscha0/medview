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
  useRef,
  useState,
} from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

const RENDERING_ENGINE_ID = "medview-rendering-engine";
const VIEWPORT_ID = "medview-stack-viewport";
const LOAD_TIMEOUT_MS = 30_000;
const fileNameCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

let initializationPromise: Promise<void> | undefined;

function initializeCornerstone() {
  if (!initializationPromise) {
    initializationPromise = Promise.resolve().then(() => {
      initCornerstoneCore();
      initDicomImageLoader({
        maxWebWorkers: Math.max(
          1,
          Math.min(navigator.hardwareConcurrency || 1, 4),
        ),
        // The local-file path is more stable with the dataset-backed provider.
        useLegacyMetadataProvider: true,
      });
    });
  }

  return initializationPromise;
}

function withTimeout<T>(promise: Promise<T>, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(
      () => reject(new Error(message)),
      LOAD_TIMEOUT_MS,
    );

    promise.then(
      (value) => {
        window.clearTimeout(timeout);
        resolve(value);
      },
      (error: unknown) => {
        window.clearTimeout(timeout);
        reject(error);
      },
    );
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

  const [isReady, setIsReady] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState("Opening series…");
  const [error, setError] = useState<string | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [imageCount, setImageCount] = useState(0);

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
          renderingEngine.resize(false, true);
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
      resizeObserver?.disconnect();
      renderingEngineRef.current?.destroy();
      renderingEngineRef.current = null;
    };
  }, []);

  const goToImage = useCallback((nextIndex: number) => {
    const renderingEngine = renderingEngineRef.current;
    const imageIds = imageIdsRef.current;
    if (!renderingEngine || !imageIds.length) return;

    const safeIndex = Math.max(0, Math.min(nextIndex, imageIds.length - 1));
    if (safeIndex === currentIndexRef.current) return;

    currentIndexRef.current = safeIndex;
    setCurrentIndex(safeIndex);
    setError(null);

    const viewport = renderingEngine.getViewport<StackViewport>(VIEWPORT_ID);
    void withTimeout(
      viewport.setImageIdIndex(safeIndex),
      "This slice took too long to decode.",
    ).catch((navigationError: unknown) => {
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
    setIsLoading(true);
    setLoadingMessage("Preparing files…");
    setError(null);

    try {
      const sortedFiles = [...files].sort((first, second) =>
        fileNameCollator.compare(first.name, second.name),
      );

      // Local image IDs are reused from zero, so clear old cached images first.
      cache.purgeCache();
      wadouri.fileManager.purge();

      const imageIds = sortedFiles.map((file) => wadouri.fileManager.add(file));
      const initialIndex = Math.floor(imageIds.length / 2);

      setLoadingMessage("Decoding first image…");
      await withTimeout(
        imageLoader.loadAndCacheImage(imageIds[initialIndex]),
        "The first image took too long to decode. Check that the files contain DICOM pixel data.",
      );
      if (generation !== loadGenerationRef.current) return;

      setLoadingMessage("Displaying series…");
      const viewport = renderingEngine.getViewport<StackViewport>(VIEWPORT_ID);
      await withTimeout(
        viewport.setStack(imageIds, initialIndex),
        "The image was decoded, but the viewer could not display it.",
      );
      if (generation !== loadGenerationRef.current) return;

      viewport.render();
      imageIdsRef.current = imageIds;
      currentIndexRef.current = initialIndex;
      setCurrentIndex(initialIndex);
      setImageCount(imageIds.length);
    } catch (loadError) {
      if (generation !== loadGenerationRef.current) return;
      imageIdsRef.current = [];
      setImageCount(0);
      setCurrentIndex(0);
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
        <section className="flex min-w-0 flex-1 flex-col">
          <div
            className="relative min-h-0 flex-1 overflow-hidden bg-black outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
              <div className="pointer-events-none absolute left-3 top-3 rounded bg-black/60 px-2 py-1 font-mono text-xs text-white/70">
                {currentIndex + 1} / {imageCount}
              </div>
            )}
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
