import { useEffect, useRef, useState } from "react";

import type {
  DicomSeries,
  ExampleSeriesManifest,
} from "@/dicom/types";
import { getErrorMessage } from "@/viewer/cornerstone-runtime";

export function useSeriesLibrary(
  onError: (error: string | null) => void,
) {
  const seriesListRef = useRef<DicomSeries[]>([]);
  const activeSeriesIdRef = useRef<string | null>(null);
  const nextSeriesIdRef = useRef(0);
  const [seriesList, setSeriesList] = useState<DicomSeries[]>([]);
  const [activeSeriesId, setActiveSeriesId] = useState<string | null>(null);
  const [isLoadingExamples, setIsLoadingExamples] = useState(false);

  useEffect(() => {
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
        if (!response.ok) {
          throw new Error("Example manifest could not be loaded.");
        }

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
      } catch (error) {
        if (!cancelled && !(error instanceof DOMException)) {
          onError(getErrorMessage(error));
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
  }, [onError]);

  return {
    activeSeriesId,
    activeSeriesIdRef,
    isLoadingExamples,
    nextSeriesIdRef,
    seriesList,
    seriesListRef,
    setActiveSeriesId,
    setSeriesList,
  };
}
