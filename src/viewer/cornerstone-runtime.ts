import {
  cache,
  imageLoader,
  init as initCornerstoneCore,
  utilities,
} from "@cornerstonejs/core";
import {
  init as initDicomImageLoader,
  wadouri,
} from "@cornerstonejs/dicom-image-loader";
import {
  addTool,
  init as initCornerstoneTools,
  ZoomTool,
} from "@cornerstonejs/tools";
import {
  Enums as MetadataEnums,
  utilities as metadataUtilities,
} from "@cornerstonejs/metadata";

import { OrbitRotateTool } from "@/tools/orbit-rotate-tool";
import { TouchVolumeCroppingTool } from "@/tools/touch-volume-cropping-tool";

const LOAD_TIMEOUT_MS = 30_000;

let initializationPromise: Promise<void> | undefined;

export function initializeCornerstone() {
  if (!initializationPromise) {
    initializationPromise = Promise.resolve().then(() => {
      initCornerstoneCore();
      initDicomImageLoader({
        maxWebWorkers: Math.max(
          1,
          Math.min(navigator.hardwareConcurrency || 1, 4),
        ),
        // Local wadouri files already use dicom-parser, which resolves
        // ambiguous implicit-VR values without the noisy dcmjs fallback.
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

export function withTimeout<T>(
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

export function removeCachedImage(imageId: string) {
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

export function releaseImageIds(imageIds: string[], removeFiles = true) {
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

export async function createSeriesThumbnail(
  image: Awaited<ReturnType<typeof imageLoader.loadAndCacheImage>>,
  modality?: string,
) {
  const canvas = document.createElement("canvas");
  canvas.width = 240;
  canvas.height = 180;
  await utilities.renderToCanvasCPU(canvas, image, modality);
  return canvas.toDataURL("image/jpeg", 0.82);
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "error" in error) {
    return getErrorMessage(error.error);
  }
  if (typeof error === "string") return error;
  return "The selected files could not be opened as a DICOM series.";
}
