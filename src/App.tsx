import {
  cache,
  Enums,
  imageLoader,
  LegacyVolumeViewport3D,
  RenderingEngine,
  setVolumesForViewports,
  StackViewport,
  type Types,
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
  Enums as ToolEnums,
  init as initCornerstoneTools,
  ToolGroupManager,
  ZoomTool,
} from "@cornerstonejs/tools";
import {
  Enums as MetadataEnums,
  utilities as metadataUtilities,
} from "@cornerstonejs/metadata";
import { parseDicom, type DataSet } from "dicom-parser";
import {
  AlertCircle,
  Box,
  ChevronLeft,
  ChevronRight,
  Crop,
  FileImage,
  Loader2,
  RotateCcw,
  Rows3,
  SlidersHorizontal,
  Upload,
  X,
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
import {
  SeriesPicker,
  type SeriesPickerItem,
} from "@/components/series-picker";
import { OrbitRotateTool } from "@/tools/orbit-rotate-tool";
import { TouchVolumeCroppingTool } from "@/tools/touch-volume-cropping-tool";

const RENDERING_ENGINE_ID = "medview-rendering-engine";
const VIEWPORT_ID = "medview-stack-viewport";
const TOOL_GROUP_ID = "medview-volume-tools";
const LOAD_TIMEOUT_MS = 30_000;
const HEADER_READ_SIZE = 1024 * 1024;
const EXAMPLE_HEADER_READ_SIZE = 64 * 1024;
const HEADER_READER_COUNT = 4;
const DEFAULT_ANATOMY_PANEL_SIZE = 35;
const MIN_VIEWER_PANEL_HEIGHT = 140;
const INTERACTIVE_SAMPLE_DISTANCE_MULTIPLIER = 2.5;
const FINAL_SAMPLE_DISTANCE_MULTIPLIER = 1;
const RENDER_QUALITY_RESTORE_DELAY_MS = 140;
const fileNameCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

let initializationPromise: Promise<void> | undefined;

type Vector3 = [number, number, number];
type ViewMode = "stack" | "volume";

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

type DicomFileInfo = DicomMetadata & {
  file: File;
  imageOrientation?: [number, number, number, number, number, number];
  imagePosition?: Vector3;
  patientHeightMm?: number;
  instanceNumber?: number;
  seriesInstanceUid: string;
};

type DicomSeries = SeriesPickerItem & {
  files: DicomFileInfo[];
  imageIds: string[];
  initialVolumeCamera?: Types.ICamera;
  currentIndex: number;
  opacityThreshold?: number;
  seriesInstanceUid: string;
  volumePreset?: string;
};

type ExampleSeriesManifest = {
  series: Array<{
    directory: string;
    files: string[];
    label: string;
  }>;
};

type ExampleDicomFile = {
  info: DicomFileInfo;
  url: string;
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

function getExampleFileUrl(directory: string, fileName: string) {
  const relativePath = [
    "example-series",
    encodeURIComponent(directory),
    encodeURIComponent(fileName),
  ].join("/");
  return new URL(`${import.meta.env.BASE_URL}${relativePath}`, document.baseURI)
    .href;
}

async function readExampleDicomHeader(
  directory: string,
  fileName: string,
  signal: AbortSignal,
): Promise<ExampleDicomFile> {
  const url = getExampleFileUrl(directory, fileName);

  async function fetchFile(useRange: boolean) {
    const response = await fetch(url, {
      headers: useRange
        ? { Range: `bytes=0-${EXAMPLE_HEADER_READ_SIZE - 1}` }
        : undefined,
      signal,
    });
    if (!response.ok) {
      throw new Error(`Could not load example file ${fileName}.`);
    }

    return {
      file: new File([await response.blob()], fileName),
      isPartial: response.status === 206,
    };
  }

  const header = await fetchFile(true);
  try {
    return { info: await parseDicomHeader(header.file), url };
  } catch (headerError) {
    if (!header.isPartial) throw headerError;
    const fullFile = await fetchFile(false);
    return { info: await parseDicomHeader(fullFile.file), url };
  }
}

async function readExampleDicomHeaders(
  entry: ExampleSeriesManifest["series"][number],
  signal: AbortSignal,
) {
  const results = new Array<ExampleDicomFile>(entry.files.length);
  let nextIndex = 0;

  async function readNext() {
    while (nextIndex < entry.files.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await readExampleDicomHeader(
        entry.directory,
        entry.files[index],
        signal,
      );
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(HEADER_READER_COUNT, entry.files.length) },
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

function getDefaultVolumePreset(modality?: string) {
  return modality?.toUpperCase() === "MR" ? "MR-Default" : "CT-Bone";
}

function cloneCamera(camera: Types.ICamera): Types.ICamera {
  return {
    ...camera,
    aspectRatio: camera.aspectRatio ? [...camera.aspectRatio] : undefined,
    clippingRange: camera.clippingRange ? [...camera.clippingRange] : undefined,
    focalPoint: camera.focalPoint ? [...camera.focalPoint] : undefined,
    position: camera.position ? [...camera.position] : undefined,
    viewPlaneNormal: camera.viewPlaneNormal
      ? [...camera.viewPlaneNormal]
      : undefined,
    viewUp: camera.viewUp ? [...camera.viewUp] : undefined,
  };
}

function alignVolumeCameraForOrbit(
  viewport: InstanceType<typeof LegacyVolumeViewport3D>,
) {
  const camera = viewport.getCamera();
  if (!camera.focalPoint || !camera.position) return;

  const distance = Math.hypot(
    camera.position[0] - camera.focalPoint[0],
    camera.position[1] - camera.focalPoint[1],
    camera.position[2] - camera.focalPoint[2],
  );
  if (distance === 0) return;

  // DICOM patient coordinates are Z-up. Start from the anterior side so the
  // camera is perpendicular to the orbit pole and horizontal drag has a clear
  // direction immediately.
  viewport.setCamera({
    focalPoint: [...camera.focalPoint],
    position: [
      camera.focalPoint[0],
      camera.focalPoint[1] - distance,
      camera.focalPoint[2],
    ],
    viewUp: [0, 0, 1],
  });
}

function recenterCamera(
  viewport: InstanceType<typeof LegacyVolumeViewport3D>,
  nextFocalPoint: Types.Point3,
) {
  const camera = viewport.getCamera();
  if (!camera.focalPoint || !camera.position) return;

  const offset: Types.Point3 = [
    nextFocalPoint[0] - camera.focalPoint[0],
    nextFocalPoint[1] - camera.focalPoint[1],
    nextFocalPoint[2] - camera.focalPoint[2],
  ];
  viewport.setCamera({
    focalPoint: [...nextFocalPoint],
    position: [
      camera.position[0] + offset[0],
      camera.position[1] + offset[1],
      camera.position[2] + offset[2],
    ],
  });
}

function applyVolumePresentation(
  viewport: InstanceType<typeof LegacyVolumeViewport3D>,
  preset: string,
  opacityThreshold: number,
) {
  viewport.setProperties({ preset });
  if (opacityThreshold <= 0) return;

  const volumeActor = viewport.getDefaultActor().actor as Types.VolumeActor;
  const opacityFunction = volumeActor.getProperty().getScalarOpacity(0);
  const nodes = Array.from({ length: opacityFunction.getSize() }, (_, index) => {
    const node = [0, 0, 0.5, 0];
    opacityFunction.getNodeValue(index, node);
    return node;
  });
  if (!nodes.length) return;

  const minimum = nodes[0][0];
  const maximum = nodes[nodes.length - 1][0];
  const threshold =
    minimum + (maximum - minimum) * (opacityThreshold / 100);

  opacityFunction.removeAllPoints();
  opacityFunction.addPoint(minimum, 0);
  opacityFunction.addPoint(threshold, 0);
  nodes
    .filter(([intensity]) => intensity > threshold)
    .forEach(([intensity, opacity, midpoint, sharpness]) => {
      opacityFunction.addPointLong(
        intensity,
        opacity,
        midpoint,
        sharpness,
      );
    });
}

function removeCachedVolume(volumeId: string | null) {
  if (!volumeId) return;
  const volume = cache.getVolume(volumeId);
  if (!volume) return;

  if ("cancelLoading" in volume) volume.cancelLoading();
  try {
    cache.removeVolumeLoadObject(volumeId);
  } catch {
    // A concurrent mode or series change may already have removed it.
  }
}

function setVolumeToolsActive(active: boolean) {
  const toolGroup = ToolGroupManager.getToolGroup(TOOL_GROUP_ID);
  if (!toolGroup) return;

  if (!active) {
    toolGroup.setToolDisabled(OrbitRotateTool.toolName);
    toolGroup.setToolDisabled(TouchVolumeCroppingTool.toolName);
    toolGroup.setToolDisabled(ZoomTool.toolName);
    return;
  }

  toolGroup.setToolDisabled(TouchVolumeCroppingTool.toolName);
  toolGroup.setToolActive(OrbitRotateTool.toolName, {
    bindings: [{ mouseButton: ToolEnums.MouseBindings.Primary }],
  });
  toolGroup.setToolActive(ZoomTool.toolName, {
    bindings: [
      { mouseButton: ToolEnums.MouseBindings.Wheel },
      { numTouchPoints: 2 },
    ],
  });
}

function getVolumeCroppingTool() {
  return ToolGroupManager.getToolGroup(TOOL_GROUP_ID)?.getToolInstance(
    TouchVolumeCroppingTool.toolName,
  ) as TouchVolumeCroppingTool | undefined;
}

function forgetVolumeCropState() {
  const croppingTool = getVolumeCroppingTool();
  if (!croppingTool) return;

  croppingTool.originalClippingPlanes = [];
  croppingTool.sphereStates = [];
  croppingTool.edgeLines = {};
}

function bindToolsToViewport() {
  const toolGroup = ToolGroupManager.getToolGroup(TOOL_GROUP_ID);
  if (!toolGroup) return;

  const isAlreadyBound = toolGroup
    .getViewportsInfo()
    .some(
      (viewport) =>
        viewport.viewportId === VIEWPORT_ID &&
        viewport.renderingEngineId === RENDERING_ENGINE_ID,
    );
  if (!isAlreadyBound) {
    toolGroup.addViewport(VIEWPORT_ID, RENDERING_ENGINE_ID);
  }
}

function App() {
  const viewportElementRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const renderingEngineRef = useRef<RenderingEngine | null>(null);
  const activeVolumeIdRef = useRef<string | null>(null);
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
  const [isCropping, setIsCropping] = useState(false);
  const [hasCrop, setHasCrop] = useState(false);
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
    const pendingExampleImageIds = new Set<string>();
    let cancelled = false;

    async function loadExampleSeries(
      entry: ExampleSeriesManifest["series"][number],
    ): Promise<DicomSeries> {
      let imageIds: string[] = [];

      try {
        const exampleFiles = await readExampleDicomHeaders(
          entry,
          abortController.signal,
        );
        const seriesInstanceUids = new Set(
          exampleFiles.map((item) => item.info.seriesInstanceUid),
        );
        if (seriesInstanceUids.size !== 1) {
          throw new Error(`${entry.label} contains more than one DICOM series.`);
        }

        const urlByFileName = new Map(
          exampleFiles.map((item) => [item.info.file.name, item.url]),
        );
        const sortedDicomFiles = sortDicomFiles(
          exampleFiles.map((item) => item.info),
        );
        imageIds = sortedDicomFiles.map((item) => {
          const url = urlByFileName.get(item.file.name);
          if (!url) throw new Error(`Missing example file ${item.file.name}.`);
          return `wadouri:${url}`;
        });
        imageIds.forEach((imageId) => pendingExampleImageIds.add(imageId));

        const initialIndex = Math.floor(imageIds.length / 2);
        const middleImage = await withTimeout(
          imageLoader.loadAndCacheImage(imageIds[initialIndex]),
          `${entry.label} took too long to decode.`,
          () => releaseImageIds(imageIds),
        );
        const thumbnailUrl = await createSeriesThumbnail(
          middleImage,
          sortedDicomFiles[initialIndex]?.modality,
        );
        const firstFile = sortedDicomFiles[0];

        return {
          id: `example-${firstFile.seriesInstanceUid}`,
          files: sortedDicomFiles,
          imageIds,
          currentIndex: initialIndex,
          imageCount: imageIds.length,
          isExample: true,
          label:
            firstFile.seriesDescription ||
            firstFile.studyDescription ||
            entry.label,
          modality: firstFile.modality,
          seriesInstanceUid: firstFile.seriesInstanceUid,
          thumbnailUrl,
        };
      } catch (exampleError) {
        releaseImageIds(imageIds);
        throw exampleError;
      }
    }

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
        if (!response.ok) throw new Error("Example manifest could not be loaded.");

        const manifest = (await response.json()) as ExampleSeriesManifest;
        const results = await Promise.allSettled(
          manifest.series.map(loadExampleSeries),
        );
        const examples = results.flatMap((result) =>
          result.status === "fulfilled" ? [result.value] : [],
        );

        if (cancelled) {
          examples.forEach((series) => releaseImageIds(series.imageIds));
          return;
        }
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
        examples.forEach((series) =>
          series.imageIds.forEach((imageId) =>
            pendingExampleImageIds.delete(imageId),
          ),
        );
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
      releaseImageIds([...pendingExampleImageIds]);
      pendingExampleImageIds.clear();
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
        setIsCropping(false);
        setHasCrop(false);
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
        setIsCropping(false);
        setHasCrop(false);
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

  const selectSeries = useCallback(async (seriesId: string) => {
    if (seriesId === activeSeriesIdRef.current) return;

    const series = seriesListRef.current.find((item) => item.id === seriesId);
    const renderingEngine = renderingEngineRef.current;
    if (!series || !renderingEngine) return;

    const generation = ++loadGenerationRef.current;
    navigationGenerationRef.current += 1;
    releaseImageIds(pendingImageIdsRef.current);
    pendingImageIdsRef.current = [];
    setIsLoading(true);
    setLoadingMessage("Displaying series…");
    setError(null);

    try {
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
    } catch (selectionError) {
      if (generation === loadGenerationRef.current) {
        setError(getErrorMessage(selectionError));
      }
    } finally {
      if (generation === loadGenerationRef.current) setIsLoading(false);
    }
  }, [displaySeries]);

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
  }, [displaySeries]);

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
    if (
      !renderingEngine ||
      !series ||
      viewModeRef.current !== "volume"
    ) {
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
    if (
      !renderingEngine ||
      !series ||
      viewModeRef.current !== "volume"
    ) {
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
    if (
      !renderingEngine ||
      !series ||
      viewModeRef.current !== "volume"
    ) {
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
    const toolGroup = ToolGroupManager.getToolGroup(TOOL_GROUP_ID);
    const croppingTool = getVolumeCroppingTool();
    if (
      !renderingEngine ||
      !toolGroup ||
      !croppingTool ||
      viewModeRef.current !== "volume"
    ) {
      return;
    }

    try {
      if (isCropping) {
        croppingTool.setClippingPlanesVisible(true);
        croppingTool.setHandlesVisible(false);
        const cropPlanes = croppingTool.originalClippingPlanes.slice(0, 6);
        if (cropPlanes.length === 6) {
          const cropCenter = cropPlanes.reduce<Types.Point3>(
            (center, { origin }) => [
              center[0] + origin[0] / cropPlanes.length,
              center[1] + origin[1] / cropPlanes.length,
              center[2] + origin[2] / cropPlanes.length,
            ],
            [0, 0, 0],
          );
          const viewport =
            renderingEngine.getViewport<
              InstanceType<typeof LegacyVolumeViewport3D>
            >(VIEWPORT_ID);
          recenterCamera(viewport, cropCenter);
          viewport.render();
        }
        toolGroup.setToolDisabled(TouchVolumeCroppingTool.toolName);
        toolGroup.setToolActive(OrbitRotateTool.toolName, {
          bindings: [{ mouseButton: ToolEnums.MouseBindings.Primary }],
        });
        setIsCropping(false);
        return;
      }

      if (hasCrop) {
        toolGroup.setToolDisabled(OrbitRotateTool.toolName);
        toolGroup.setToolActive(TouchVolumeCroppingTool.toolName, {
          bindings: [
            { mouseButton: ToolEnums.MouseBindings.Primary },
            { numTouchPoints: 1 },
          ],
        });
        croppingTool.setClippingPlanesVisible(true);
        croppingTool.setHandlesVisible(true);
        setIsCropping(true);
        return;
      }

      toolGroup.setToolDisabled(OrbitRotateTool.toolName);
      toolGroup.setToolActive(TouchVolumeCroppingTool.toolName, {
        bindings: [
          { mouseButton: ToolEnums.MouseBindings.Primary },
          { numTouchPoints: 1 },
        ],
      });
      croppingTool.setClippingPlanesVisible(true);
      croppingTool.setHandlesVisible(true);
      setIsCropping(true);
      setHasCrop(true);
      setError(null);
    } catch (cropError) {
      setError(`Could not enable cropping: ${getErrorMessage(cropError)}`);
    }
  }

  function clearVolumeCrop() {
    const renderingEngine = renderingEngineRef.current;
    const toolGroup = ToolGroupManager.getToolGroup(TOOL_GROUP_ID);
    const croppingTool = getVolumeCroppingTool();
    const series = seriesListRef.current.find(
      (item) => item.id === activeSeriesIdRef.current,
    );
    if (
      !renderingEngine ||
      !toolGroup ||
      !croppingTool ||
      viewModeRef.current !== "volume"
    ) {
      return;
    }

    try {
      const viewport =
        renderingEngine.getViewport<
          InstanceType<typeof LegacyVolumeViewport3D>
        >(VIEWPORT_ID);
      croppingTool.setClippingPlanesVisible(false);
      croppingTool.setHandlesVisible(false);
      const volumeActor = croppingTool._getVolumeActor();
      const imageData = volumeActor?.getMapper()?.getInputData();
      const directions = croppingTool.volumeDirectionVectors;
      if (imageData && directions && croppingTool.sphereStates.length) {
        const [width, height, depth] = imageData.getDimensions();
        const center = [width / 2, height / 2, depth / 2];
        const { xDir, yDir, zDir } = directions;
        croppingTool.originalClippingPlanes = [
          {
            origin: imageData.indexToWorld([0, center[1], center[2]]),
            normal: [...xDir],
          },
          {
            origin: imageData.indexToWorld([width, center[1], center[2]]),
            normal: [-xDir[0], -xDir[1], -xDir[2]],
          },
          {
            origin: imageData.indexToWorld([center[0], 0, center[2]]),
            normal: [...yDir],
          },
          {
            origin: imageData.indexToWorld([center[0], height, center[2]]),
            normal: [-yDir[0], -yDir[1], -yDir[2]],
          },
          {
            origin: imageData.indexToWorld([center[0], center[1], 0]),
            normal: [...zDir],
          },
          {
            origin: imageData.indexToWorld([center[0], center[1], depth]),
            normal: [-zDir[0], -zDir[1], -zDir[2]],
          },
        ];
        croppingTool._updateFaceSpheresFromClippingPlanes();
        croppingTool._updateCornerSpheresFromFaces();
        croppingTool._updateFaceSpheresFromCorners();
        croppingTool._updateCornerSpheres();
        croppingTool._updateEdgeLines();
      }

      if (series?.initialVolumeCamera?.focalPoint) {
        recenterCamera(viewport, series.initialVolumeCamera.focalPoint);
      }

      toolGroup.setToolDisabled(TouchVolumeCroppingTool.toolName);
      toolGroup.setToolActive(OrbitRotateTool.toolName, {
        bindings: [{ mouseButton: ToolEnums.MouseBindings.Primary }],
      });
      viewport.render();
      setIsCropping(false);
      setHasCrop(false);
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

                {imageCount > 0 &&
                  viewMode === "volume" &&
                  isVolumeOptionsOpen && (
                  <div className="absolute inset-x-2 top-16 z-10 w-auto rounded-md border border-white/10 bg-black/70 p-2.5 text-white/80 backdrop-blur-sm md:inset-x-auto md:left-3 md:top-3 md:w-[min(22rem,calc(100%-9rem))]">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <div className="whitespace-nowrap text-xs font-medium text-white/90">
                        3D rendering options
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        className="-mr-1 -mt-1 text-white/55 hover:bg-white/10 hover:text-white"
                        aria-label="Close 3D rendering options"
                        onClick={() => setIsVolumeOptionsOpen(false)}
                      >
                        <X />
                      </Button>
                    </div>
                    <label
                      className="mb-1 block text-[11px] text-white/55"
                      htmlFor="volume-preset"
                    >
                      Preset
                    </label>
                    <select
                      id="volume-preset"
                      className="h-8 w-full rounded border border-white/15 bg-black/60 px-2 text-xs text-white outline-none focus-visible:border-white/35 focus-visible:ring-2 focus-visible:ring-white/20"
                      value={volumePreset}
                      onChange={(event) =>
                        changeVolumePreset(event.target.value)
                      }
                    >
                      {volumePresetOptions.map((preset) => (
                        <option key={preset.value} value={preset.value}>
                          {preset.label}
                        </option>
                      ))}
                    </select>
                    <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1.5 md:flex-nowrap">
                      <label
                        className="w-full shrink-0 text-[11px] text-white/55 md:w-auto"
                        htmlFor="opacity-threshold"
                      >
                        Threshold
                      </label>
                      <input
                        id="opacity-threshold"
                        aria-valuetext={`${opacityThreshold}% intensity cutoff`}
                        className="h-2 min-w-16 flex-1 cursor-pointer accent-primary"
                        type="range"
                        min={0}
                        max={95}
                        step={1}
                        value={opacityThreshold}
                        onChange={(event) =>
                          changeOpacityThreshold(Number(event.target.value))
                        }
                      />
                      <span className="w-9 shrink-0 text-right font-mono text-[11px] tabular-nums text-white/60">
                        {opacityThreshold}%
                      </span>
                    </div>
                    <div className="mt-2.5 flex flex-wrap items-center gap-2 border-t border-white/10 pt-2.5">
                      <Button
                        type="button"
                        variant={hasCrop ? "secondary" : "outline"}
                        size="xs"
                        className="gap-1.5"
                        onClick={toggleCroppingMode}
                      >
                        <Crop />
                        {isCropping
                          ? "Apply crop"
                          : hasCrop
                            ? "Edit crop"
                            : "Crop volume"}
                      </Button>
                      {hasCrop && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="xs"
                          className="text-white/60 hover:bg-white/10 hover:text-white"
                          onClick={clearVolumeCrop}
                        >
                          Clear crop
                        </Button>
                      )}
                    </div>
                  </div>
                )}

                {imageCount > 0 &&
                  viewMode === "volume" &&
                  !isVolumeOptionsOpen && (
                    <Button
                      type="button"
                      variant="outline"
                      size="xs"
                      className="absolute left-3 top-3 z-10 h-10 gap-1.5 border-white/10 bg-black/70 px-3 text-sm text-white/70 backdrop-blur-sm hover:bg-black/80 hover:text-white @max-[18rem]:size-10 @max-[18rem]:gap-0 @max-[18rem]:px-0"
                      aria-label="Open 3D rendering options"
                      title="3D rendering options"
                      onClick={() => setIsVolumeOptionsOpen(true)}
                    >
                      <SlidersHorizontal className="size-4" />
                      <span className="@max-[18rem]:hidden">Options</span>
                    </Button>
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
