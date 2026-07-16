import { Info, X } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import type { DicomMetadata } from "@/dicom/types";

export type { DicomMetadata } from "@/dicom/types";

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
  const [isOpen, setIsOpen] = useState(
    () =>
      typeof window === "undefined" ||
      window.matchMedia("(min-width: 1024px)").matches,
  );
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
        className="absolute left-3 top-3 z-10 h-10 gap-1.5 border-white/10 bg-black/70 px-3 text-sm text-white/70 backdrop-blur-sm hover:bg-black/80 hover:text-white @max-[18rem]:size-10 @max-[18rem]:gap-0 @max-[18rem]:px-0"
        aria-label="Open DICOM metadata"
        title="DICOM metadata"
        onClick={() => setIsOpen(true)}
      >
        <Info className="size-4" />
        <span className="@max-[18rem]:hidden">Metadata</span>
      </Button>
    );
  }

  return (
    <div className="metadata-selectable pointer-events-auto absolute inset-x-2 top-16 max-w-none rounded bg-black/60 px-2 py-1.5 font-mono text-[11px] leading-4 text-white/70 backdrop-blur-sm md:inset-x-auto md:left-3 md:top-3 md:max-w-[min(28rem,calc(100%-9rem))]">
      <div className="flex flex-wrap items-start gap-x-3 gap-y-1 md:flex-nowrap">
        <div className="min-w-0 w-full flex-1 [overflow-wrap:anywhere] md:w-auto">
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
        <div className="flex shrink-0 items-start gap-1.5 tabular-nums">
          <div className="text-white/90">{currentIndex + 1} / {imageCount}</div>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="-mr-1 -mt-0.5 text-white/55 hover:bg-white/10 hover:text-white"
            aria-label="Close DICOM metadata"
            onClick={() => setIsOpen(false)}
          >
            <X />
          </Button>
        </div>
      </div>

      <div
        className={hasStudyContext ? "mt-1 border-t border-white/10 pt-1" : ""}
      >
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
