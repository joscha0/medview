import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { ANATOMY_LAYERS, type AnatomyLayerId } from "./constants";

type AnatomyLayerPickerProps = {
  selectedLayers: ReadonlySet<AnatomyLayerId>;
  onToggleLayer: (id: AnatomyLayerId) => void;
};

export function AnatomyLayerPicker({
  selectedLayers,
  onToggleLayer,
}: AnatomyLayerPickerProps) {
  return (
    <div
      className="absolute bottom-2 left-2 top-2 z-10 grid w-60 auto-rows-max grid-cols-3 gap-1 overflow-y-auto rounded-md bg-black/60 p-1 backdrop-blur-sm"
      aria-label="Anatomy layers"
    >
      {ANATOMY_LAYERS.map((layer) => {
        const selected = selectedLayers.has(layer.id);
        return (
          <Card
            key={layer.id}
            className={cn(
              "h-[76px] overflow-hidden rounded-md bg-black/30 shadow-none transition-colors",
              selected ? "border-white/40 bg-white/10" : "border-white/10",
            )}
          >
            <Button
              type="button"
              variant="ghost"
              aria-pressed={selected}
              onClick={() => onToggleLayer(layer.id)}
              className={cn(
                "h-full w-full flex-col gap-0 rounded-[5px] p-0.5 font-normal whitespace-normal",
                selected
                  ? "text-white hover:bg-white/5"
                  : "text-white/55 hover:bg-white/5 hover:text-white/80",
              )}
            >
              <img
                src={`/anatomy-layers/previews/${layer.id}.png`}
                alt=""
                draggable={false}
                className="h-12 min-h-0 w-full select-none object-contain"
              />
              <CardTitle className="line-clamp-2 flex min-h-5 w-full items-center justify-center px-0.5 text-center text-[9px] font-normal leading-[1.05]">
                {layer.name}
              </CardTitle>
            </Button>
          </Card>
        );
      })}
    </div>
  );
}

