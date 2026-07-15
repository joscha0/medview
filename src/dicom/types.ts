import type { Types } from "@cornerstonejs/core";

export type Vector3 = [number, number, number];
export type ViewMode = "stack" | "volume";

export type DicomMetadata = {
  patientName?: string;
  patientId?: string;
  patientAge?: string;
  patientSex?: string;
  studyDate?: string;
  modality?: string;
  studyDescription?: string;
  seriesDescription?: string;
  bodyPart?: string;
  patientPosition?: string;
  rows?: number;
  columns?: number;
  pixelSpacing?: [number, number];
  sliceThicknessMm?: number;
  windowCenter?: number;
  windowWidth?: number;
};

export type DicomFileInfo = DicomMetadata & {
  file: File;
  imageOrientation?: [number, number, number, number, number, number];
  imagePosition?: Vector3;
  patientHeightMm?: number;
  instanceNumber?: number;
  seriesInstanceUid: string;
};

export type ExampleSeriesManifest = {
  series: Array<{
    directory: string;
    files: string[];
    label: string;
    thumbnail?: string;
  }>;
};

export type DicomSeries = {
  id: string;
  imageCount: number;
  label: string;
  modality?: string;
  thumbnailUrl?: string;
  isExample?: boolean;
  exampleEntry?: ExampleSeriesManifest["series"][number];
  files: DicomFileInfo[];
  imageIds: string[];
  initialVolumeCamera?: Types.ICamera;
  currentIndex: number;
  opacityThreshold?: number;
  seriesInstanceUid: string;
  volumePreset?: string;
};

export type ExampleDicomFile = {
  info: DicomFileInfo;
  url: string;
};
