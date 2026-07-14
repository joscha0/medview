import { Layers, X } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { cacheAnatomyAsset } from "./anatomy-cache";
import {
  ANATOMY_LAYERS,
  getAnatomyLayerPreviewUrl,
  type AnatomyLayerId,
} from "./constants";

type AnatomyLayerPickerProps = {
  selectedLayers: ReadonlySet<AnatomyLayerId>;
  onToggleLayer: (id: AnatomyLayerId) => void;
};

export function AnatomyLayerPicker({
  selectedLayers,
  onToggleLayer,
}: AnatomyLayerPickerProps) {
  const [isOpen, setIsOpen] = useState(true);

  if (!isOpen) {
    return (
      <Button
        type="button"
        variant="outline"
        size="xs"
        className="absolute left-2 top-2 z-10 border-white/15 bg-black/60 text-white/70 backdrop-blur-sm hover:bg-black/80 hover:text-white"
        onClick={() => setIsOpen(true)}
      >
        <Layers />
        Layers
      </Button>
    );
  }

  return (
    <div
      className="absolute bottom-2 left-2 top-2 z-10 flex w-[min(20rem,calc(100%-1rem))] max-w-full flex-col overflow-hidden rounded-md bg-black/60 backdrop-blur-sm"
      aria-label="Anatomy layers"
    >
      <div className="flex h-8 shrink-0 items-center justify-between px-2 text-[10px] font-medium text-white/65">
        <span>Layers</span>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="-mr-1 text-white/55 hover:bg-white/10 hover:text-white"
          aria-label="Close anatomy layer picker"
          onClick={() => setIsOpen(false)}
        >
          <X />
        </Button>
      </div>

      <div
        className="grid min-h-0 flex-1 auto-rows-max gap-1 overflow-y-auto p-1 pt-0"
        style={{
          gridTemplateColumns: "repeat(auto-fit, minmax(5rem, 1fr))",
        }}
      >
        {ANATOMY_LAYERS.map((layer) => {
          const selected = selectedLayers.has(layer.id);
          const previewUrl = getAnatomyLayerPreviewUrl(layer.id);
          return (
            <Card
              key={layer.id}
              className={cn(
                "h-[76px] min-w-0 overflow-hidden rounded-md bg-black/30 shadow-none transition-colors",
                selected ? "border-white/40 bg-white/10" : "border-white/10",
              )}
            >
              <Button
                type="button"
                variant="ghost"
                aria-pressed={selected}
                onClick={() => onToggleLayer(layer.id)}
                className={cn(
                  "h-full min-w-0 w-full flex-col gap-0 rounded-[5px] p-0.5 font-normal whitespace-normal",
                  selected
                    ? "text-white hover:bg-white/5"
                    : "text-white/55 hover:bg-white/5 hover:text-white/80",
                )}
              >
                <img
                  src={previewUrl}
                  alt=""
                  draggable={false}
                  onLoad={() => void cacheAnatomyAsset(previewUrl)}
                  className="h-12 min-h-0 w-full select-none object-contain"
                />
                <CardTitle className="line-clamp-2 flex min-h-5 min-w-0 w-full items-center justify-center break-words px-0.5 text-center text-[9px] font-normal leading-[1.05] [overflow-wrap:anywhere]">
                  {layer.name}
                </CardTitle>
              </Button>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
