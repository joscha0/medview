import { ChevronLeft, ChevronRight, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { ViewMode } from "@/dicom/types";

interface ViewerFooterProps {
  currentIndex: number;
  imageCount: number;
  isCropping: boolean;
  mode: ViewMode;
  onChangeImage: (index: number) => void;
  onResetVolume: () => void;
}

export function ViewerFooter({
  currentIndex,
  imageCount,
  isCropping,
  mode,
  onChangeImage,
  onResetVolume,
}: ViewerFooterProps) {
  return (
    <div className="flex h-16 shrink-0 items-center gap-3 border-t px-3 sm:px-4">
      {mode === "stack" ? (
        <>
          <Button
            variant="outline"
            size="icon"
            aria-label="Previous image"
            disabled={!imageCount || currentIndex === 0}
            onClick={() => onChangeImage(currentIndex - 1)}
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
            onChange={(event) => onChangeImage(Number(event.target.value))}
          />

          <span className="w-20 text-center font-mono text-xs tabular-nums text-muted-foreground">
            {imageCount ? currentIndex + 1 : 0} / {imageCount}
          </span>

          <Button
            variant="outline"
            size="icon"
            aria-label="Next image"
            disabled={!imageCount || currentIndex === imageCount - 1}
            onClick={() => onChangeImage(currentIndex + 1)}
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
            onClick={onResetVolume}
          >
            <RotateCcw className="size-4" />
            Reset view
          </Button>
        </>
      )}
    </div>
  );
}
