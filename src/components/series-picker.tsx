import { FileImage, Loader2, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type SeriesPickerItem = {
  id: string;
  imageCount: number;
  label: string;
  modality?: string;
  thumbnailUrl?: string;
  isExample?: boolean;
};

type SeriesPickerProps = {
  activeSeriesId: string | null;
  disabled?: boolean;
  isLoadingExamples?: boolean;
  series: SeriesPickerItem[];
  onAdd: () => void;
  onSelect: (seriesId: string) => void;
};

export function SeriesPicker({
  activeSeriesId,
  disabled,
  isLoadingExamples,
  series,
  onAdd,
  onSelect,
}: SeriesPickerProps) {
  return (
    <aside
      aria-label="DICOM series picker"
      className="flex w-36 shrink-0 flex-col border-r bg-background sm:w-44"
    >
      <div className="flex h-11 shrink-0 items-center justify-between border-b px-3">
        <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          Series
        </h2>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Add DICOM series"
          disabled={disabled}
          onClick={onAdd}
        >
          <Plus />
        </Button>
      </div>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2">
        {series.map((item) => {
          const isActive = item.id === activeSeriesId;

          return (
            <button
              key={item.id}
              type="button"
              aria-current={isActive ? "true" : undefined}
              className={cn(
                "group w-full overflow-hidden rounded-md border bg-card text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                isActive
                  ? "border-primary ring-1 ring-primary"
                  : "hover:border-foreground/25 hover:bg-accent",
              )}
              disabled={disabled}
              onClick={() => onSelect(item.id)}
            >
              <div className="relative aspect-[4/3] overflow-hidden bg-black">
                {item.thumbnailUrl ? (
                  <img
                    src={item.thumbnailUrl}
                    alt=""
                    draggable={false}
                    className="size-full object-contain"
                  />
                ) : (
                  <div className="grid size-full place-items-center">
                    <FileImage className="size-5 text-white/35" />
                  </div>
                )}
                <span className="absolute bottom-1 right-1 rounded bg-black/70 px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-white/80">
                  {item.imageCount}
                </span>
                {item.isExample && (
                  <span className="absolute left-1 top-1 rounded bg-primary px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-primary-foreground">
                    Example
                  </span>
                )}
              </div>

              <div className="min-w-0 px-2 py-1.5">
                <div className="truncate text-xs font-medium">{item.label}</div>
                <div className="mt-0.5 truncate text-[10px] text-muted-foreground">
                  {item.modality ? `${item.modality} · ` : ""}
                  {item.imageCount} {item.imageCount === 1 ? "image" : "images"}
                </div>
              </div>
            </button>
          );
        })}

        {isLoadingExamples && (
          <div className="flex items-center gap-2 rounded-md border border-dashed px-2.5 py-3 text-[11px] text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" />
            Loading examples…
          </div>
        )}

        {!series.length && !isLoadingExamples && (
          <button
            type="button"
            className="grid w-full place-items-center rounded-md border border-dashed px-3 py-8 text-center text-xs text-muted-foreground outline-none transition-colors hover:border-foreground/25 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
            disabled={disabled}
            onClick={onAdd}
          >
            <Plus className="mb-2 size-5" />
            Add series
          </button>
        )}
      </div>
    </aside>
  );
}
