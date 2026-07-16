import { Crop, SlidersHorizontal, X } from "lucide-react";

import { Button } from "@/components/ui/button";

type PresetOption = { label: string; value: string };

type VolumeRenderingOptionsProps = {
  hasCrop: boolean;
  isCropping: boolean;
  isOpen: boolean;
  opacityThreshold: number;
  preset: string;
  presets: readonly PresetOption[];
  onClearCrop: () => void;
  onClose: () => void;
  onOpen: () => void;
  onPresetChange: (preset: string) => void;
  onThresholdChange: (threshold: number) => void;
  onToggleCrop: () => void;
};

export function VolumeRenderingOptions({
  hasCrop,
  isCropping,
  isOpen,
  opacityThreshold,
  preset,
  presets,
  onClearCrop,
  onClose,
  onOpen,
  onPresetChange,
  onThresholdChange,
  onToggleCrop,
}: VolumeRenderingOptionsProps) {
  if (!isOpen) {
    return (
      <Button
        type="button"
        variant="outline"
        size="xs"
        className="absolute left-3 top-3 z-10 h-10 gap-1.5 border-white/10 bg-black/70 px-3 text-sm text-white/70 backdrop-blur-sm hover:bg-black/80 hover:text-white @max-[18rem]:size-10 @max-[18rem]:gap-0 @max-[18rem]:px-0"
        aria-label="Open 3D rendering options"
        title="3D rendering options"
        onClick={onOpen}
      >
        <SlidersHorizontal className="size-4" />
        <span className="@max-[18rem]:hidden">Options</span>
      </Button>
    );
  }

  return (
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
          onClick={onClose}
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
        value={preset}
        onChange={(event) => onPresetChange(event.target.value)}
      >
        {presets.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
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
          onChange={(event) => onThresholdChange(Number(event.target.value))}
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
          onClick={onToggleCrop}
        >
          <Crop />
          {isCropping ? "Apply crop" : hasCrop ? "Edit crop" : "Crop volume"}
        </Button>
        {hasCrop && (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className="text-white/60 hover:bg-white/10 hover:text-white"
            onClick={onClearCrop}
          >
            Clear crop
          </Button>
        )}
      </div>
    </div>
  );
}
