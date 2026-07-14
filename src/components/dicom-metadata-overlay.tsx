import { Info, X } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";

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

type DicomMetadataOverlayProps = {
  metadata?: DicomMetadata;
  currentIndex: number;
  imageCount: number;
};

const PATIENT_POSITIONS: Record<string, string> = {
  FFP: "Feet first · prone",
  FFS: "Feet first · supine",
  HFP: "Head first · prone",
  HFS: "Head first · supine",
};

function joinMetadata(values: Array<string | undefined>) {
  return values.filter(Boolean).join(" · ");
}

function formatPatientName(name?: string) {
  return name?.split("^").filter(Boolean).join(" ");
}

function formatDicomDate(date?: string) {
  if (!date || !/^\d{8}$/.test(date)) return date;
  return `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
}

function formatMeasurement(value: number) {
  return Number(value.toFixed(2)).toString();
}

export function DicomMetadataOverlay({
  metadata,
  currentIndex,
  imageCount,
}: DicomMetadataOverlayProps) {
  const [isOpen, setIsOpen] = useState(true);
  const patientName = formatPatientName(metadata?.patientName);
  const patientDetails = joinMetadata([
    metadata?.patientId ? `ID ${metadata.patientId}` : undefined,
    metadata?.patientAge,
    metadata?.patientSex,
    formatDicomDate(metadata?.studyDate),
  ]);
  const scanDetails = joinMetadata([
    metadata?.modality,
    metadata?.bodyPart,
    metadata?.patientPosition
      ? (PATIENT_POSITIONS[metadata.patientPosition] ??
        metadata.patientPosition)
      : undefined,
  ]);
  const description =
    metadata?.seriesDescription ?? metadata?.studyDescription;
  const hasStudyContext =
    patientName || patientDetails || description || scanDetails;

  if (!isOpen) {
    return (
      <Button
        type="button"
        variant="outline"
        size="xs"
        className="absolute right-3 top-3 z-10 border-white/15 bg-black/60 text-white/70 backdrop-blur-sm hover:bg-black/80 hover:text-white"
        onClick={() => setIsOpen(true)}
      >
        <Info />
        Metadata
      </Button>
    );
  }

  return (
    <div className="pointer-events-none absolute inset-x-3 top-3 flex items-start justify-between gap-4 font-mono text-[11px] leading-4 text-white/70">
      {hasStudyContext ? (
        <div className="max-w-[min(28rem,55%)] rounded bg-black/60 px-2 py-1.5 backdrop-blur-sm">
          {(patientName || patientDetails) && (
            <>
              {patientName && (
                <div className="truncate font-sans font-medium text-white/90">
                  {patientName}
                </div>
              )}
              {patientDetails && <div>{patientDetails}</div>}
            </>
          )}
          {description && (
            <div className="truncate font-sans text-white/85">
              {description}
            </div>
          )}
          {scanDetails && <div>{scanDetails}</div>}
        </div>
      ) : (
        <div />
      )}

      <div className="shrink-0 rounded bg-black/60 px-2 py-1.5 text-right tabular-nums backdrop-blur-sm">
        <div className="flex items-start justify-end gap-1.5">
          <div className="text-white/90">
            {currentIndex + 1} / {imageCount}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="pointer-events-auto -mr-1 -mt-0.5 text-white/55 hover:bg-white/10 hover:text-white"
            aria-label="Close DICOM metadata"
            onClick={() => setIsOpen(false)}
          >
            <X />
          </Button>
        </div>
        {metadata?.columns && metadata.rows && (
          <div>
            {metadata.columns} × {metadata.rows} px
          </div>
        )}
        {metadata?.pixelSpacing && (
          <div>
            {formatMeasurement(metadata.pixelSpacing[1])} ×{" "}
            {formatMeasurement(metadata.pixelSpacing[0])} mm
          </div>
        )}
        {metadata?.sliceThicknessMm !== undefined && (
          <div>Thickness {formatMeasurement(metadata.sliceThicknessMm)} mm</div>
        )}
        {(metadata?.windowCenter !== undefined ||
          metadata?.windowWidth !== undefined) && (
          <div>
            {metadata.windowCenter !== undefined &&
              `WL ${formatMeasurement(metadata.windowCenter)}`}
            {metadata.windowCenter !== undefined &&
              metadata.windowWidth !== undefined &&
              " · "}
            {metadata.windowWidth !== undefined &&
              `WW ${formatMeasurement(metadata.windowWidth)}`}
          </div>
        )}
      </div>
    </div>
  );
}
