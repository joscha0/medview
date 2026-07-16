import { Box, Rows3 } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { ViewMode } from "@/dicom/types";

interface ViewModeSwitcherProps {
  disabled: boolean;
  mode: ViewMode;
  onChange: (mode: ViewMode) => void;
}

export function ViewModeSwitcher({
  disabled,
  mode,
  onChange,
}: ViewModeSwitcherProps) {
  return (
    <div className="absolute right-3 top-3 z-10 flex rounded-md border border-white/10 bg-black/70 p-1 backdrop-blur-sm">
      <Button
        className="h-8 gap-1.5 px-2.5"
        variant={mode === "stack" ? "secondary" : "ghost"}
        size="sm"
        disabled={disabled}
        aria-pressed={mode === "stack"}
        onClick={() => onChange("stack")}
      >
        <Rows3 className="size-3.5" />
        2D
      </Button>
      <Button
        className="h-8 gap-1.5 px-2.5"
        variant={mode === "volume" ? "secondary" : "ghost"}
        size="sm"
        disabled={disabled}
        aria-pressed={mode === "volume"}
        onClick={() => onChange("volume")}
      >
        <Box className="size-3.5" />
        3D
      </Button>
    </div>
  );
}
