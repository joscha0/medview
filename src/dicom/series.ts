import { parseDicom, type DataSet } from "dicom-parser";

import type { DicomSlicePlane } from "@/components/anatomy/types";
import type {
  DicomFileInfo,
  DicomSeries,
  ExampleDicomFile,
  ExampleSeriesManifest,
  Vector3,
} from "@/dicom/types";

const HEADER_READ_SIZE = 1024 * 1024;
const EXAMPLE_HEADER_READ_SIZE = 8 * 1024;
const HEADER_READER_COUNT = 4;
const EXAMPLE_HEADER_READER_COUNT = 12;

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

  const imagePosition = parseNumberList(dataSet.string("x00200032"), 3) as
    | Vector3
    | undefined;
  const imageOrientation = parseNumberList(
    dataSet.string("x00200037"),
    6,
  ) as DicomFileInfo["imageOrientation"];
  const pixelSpacing = parseNumberList(
    dataSet.string("x00280030"),
    2,
  ) as DicomFileInfo["pixelSpacing"];
  const patientSizeMeters = Number(dataSet.string("x00101020"));

  return {
    file,
    imageOrientation,
    imagePosition,
    pixelSpacing,
    rows: dataSet.uint16("x00280010"),
    columns: dataSet.uint16("x00280011"),
    bodyPart: dataSet.string("x00180015")?.trim(),
    modality: dataSet.string("x00080060")?.trim(),
    studyDate: dataSet.string("x00080020")?.trim(),
    seriesDescription: dataSet.string("x0008103e")?.trim(),
    studyDescription: dataSet.string("x00081030")?.trim(),
    patientName: dataSet.string("x00100010")?.trim(),
    patientId: dataSet.string("x00100020")?.trim(),
    patientSex: dataSet.string("x00100040")?.trim(),
    patientAge: dataSet.string("x00101010")?.trim(),
    patientPosition: dataSet.string("x00185100")?.trim(),
    sliceThicknessMm: parseFirstNumber(dataSet.string("x00180050")),
    windowCenter: parseFirstNumber(dataSet.string("x00281050")),
    windowWidth: parseFirstNumber(dataSet.string("x00281051")),
    patientHeightMm:
      Number.isFinite(patientSizeMeters) && patientSizeMeters > 0
        ? patientSizeMeters * 1000
        : undefined,
    instanceNumber: dataSet.intString("x00200013"),
    seriesInstanceUid,
  };
}

async function readConcurrently<T>(
  length: number,
  concurrency: number,
  read: (index: number) => Promise<T>,
) {
  const results = new Array<T>(length);
  let nextIndex = 0;
  async function readNext() {
    while (nextIndex < length) {
      const index = nextIndex++;
      results[index] = await read(index);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, length) }, readNext),
  );
  return results;
}

export function readDicomHeaders(files: File[]) {
  return readConcurrently(files.length, HEADER_READER_COUNT, (index) =>
    parseDicomHeader(files[index]),
  );
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

function readExampleDicomHeaders(
  entry: ExampleSeriesManifest["series"][number],
  signal: AbortSignal,
) {
  return readConcurrently(
    entry.files.length,
    EXAMPLE_HEADER_READER_COUNT,
    (index) =>
      readExampleDicomHeader(entry.directory, entry.files[index], signal),
  );
}

export async function hydrateExampleSeries(
  series: DicomSeries,
  signal: AbortSignal,
) {
  const entry = series.exampleEntry;
  if (!entry || series.files.length) return;
  const exampleFiles = await readExampleDicomHeaders(entry, signal);
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
  const imageIds = sortedDicomFiles.map((item) => {
    const url = urlByFileName.get(item.file.name);
    if (!url) throw new Error(`Missing example file ${item.file.name}.`);
    return `wadouri:${url}`;
  });
  const firstFile = sortedDicomFiles[0];

  Object.assign(series, {
    files: sortedDicomFiles,
    imageIds,
    currentIndex: Math.floor(imageIds.length / 2),
    imageCount: imageIds.length,
    label:
      firstFile.seriesDescription || firstFile.studyDescription || entry.label,
    modality: firstFile.modality,
    seriesInstanceUid: firstFile.seriesInstanceUid,
  });
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
  return magnitude
    ? (normal.map((value) => value / magnitude) as Vector3)
    : undefined;
}

export function sortDicomFiles(files: DicomFileInfo[]) {
  const normal = getSliceNormal(
    files.find((item) => item.imageOrientation)?.imageOrientation,
  );
  return [...files].sort((a, b) => {
    if (normal && a.imagePosition && b.imagePosition) {
      const distanceA =
        a.imagePosition[0] * normal[0] +
        a.imagePosition[1] * normal[1] +
        a.imagePosition[2] * normal[2];
      const distanceB =
        b.imagePosition[0] * normal[0] +
        b.imagePosition[1] * normal[1] +
        b.imagePosition[2] * normal[2];
      if (distanceA !== distanceB) return distanceA - distanceB;
    }
    if (a.instanceNumber !== undefined && b.instanceNumber !== undefined) {
      return a.instanceNumber - b.instanceNumber;
    }
    return a.file.name.localeCompare(b.file.name, undefined, { numeric: true });
  });
}

export function getDicomSlicePlane(
  files: DicomFileInfo[],
  index: number,
): DicomSlicePlane | null {
  const current = files[index];
  if (
    !current?.imageOrientation ||
    !current.imagePosition ||
    !current.pixelSpacing ||
    !current.rows ||
    !current.columns
  ) {
    return null;
  }
  const normal = getSliceNormal(current.imageOrientation);
  if (!normal) return null;
  const sliceDistances = files.flatMap((file) =>
    file.imagePosition
      ? [
          file.imagePosition[0] * normal[0] +
            file.imagePosition[1] * normal[1] +
            file.imagePosition[2] * normal[2],
        ]
      : [],
  );
  if (!sliceDistances.length) return null;
  const currentDistance =
    current.imagePosition[0] * normal[0] +
    current.imagePosition[1] * normal[1] +
    current.imagePosition[2] * normal[2];
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
