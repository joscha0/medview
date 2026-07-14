import {
  type KeyboardEvent,
  type PointerEvent,
  type RefObject,
  useRef,
  useState,
} from "react";

import { cn } from "@/lib/utils";

type PanelResizeHandleProps = {
  containerRef: RefObject<HTMLElement | null>;
  label: string;
  minFirstSize: number;
  minSecondSize: number;
  onChange: (value: number) => void;
  onReset: () => void;
  orientation: "horizontal" | "vertical";
  value: number;
};

const HANDLE_SIZE = 8;
const KEYBOARD_STEP = 2;

function clampPanelSize(
  value: number,
  availableSize: number,
  minFirstSize: number,
  minSecondSize: number,
) {
  if (availableSize <= 0) return value;

  const minValue = Math.min(50, (minFirstSize / availableSize) * 100);
  const maxValue = Math.max(50, 100 - (minSecondSize / availableSize) * 100);
  return Math.min(maxValue, Math.max(minValue, value));
}

export function PanelResizeHandle({
  containerRef,
  label,
  minFirstSize,
  minSecondSize,
  onChange,
  onReset,
  orientation,
  value,
}: PanelResizeHandleProps) {
  const dragStartRef = useRef({ coordinate: 0, value: 0 });
  const [isDragging, setIsDragging] = useState(false);

  function getAvailableSize() {
    const container = containerRef.current;
    if (!container) return 0;
    const size =
      orientation === "vertical"
        ? container.getBoundingClientRect().width
        : container.getBoundingClientRect().height;
    return Math.max(0, size - HANDLE_SIZE);
  }

  function setClampedValue(nextValue: number) {
    onChange(
      clampPanelSize(
        nextValue,
        getAvailableSize(),
        minFirstSize,
        minSecondSize,
      ),
    );
  }

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragStartRef.current = {
      coordinate: orientation === "vertical" ? event.clientX : event.clientY,
      value,
    };
    setIsDragging(true);
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!isDragging || !event.currentTarget.hasPointerCapture(event.pointerId)) {
      return;
    }

    const coordinate =
      orientation === "vertical" ? event.clientX : event.clientY;
    const availableSize = getAvailableSize();
    if (!availableSize) return;

    const delta = coordinate - dragStartRef.current.coordinate;
    setClampedValue(dragStartRef.current.value + (delta / availableSize) * 100);
  }

  function handlePointerUp(event: PointerEvent<HTMLDivElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setIsDragging(false);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const decrementKey = orientation === "vertical" ? "ArrowLeft" : "ArrowUp";
    const incrementKey =
      orientation === "vertical" ? "ArrowRight" : "ArrowDown";

    if (event.key === decrementKey || event.key === incrementKey) {
      event.preventDefault();
      setClampedValue(
        value + (event.key === incrementKey ? KEYBOARD_STEP : -KEYBOARD_STEP),
      );
    } else if (event.key === "Home") {
      event.preventDefault();
      setClampedValue(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setClampedValue(100);
    }
  }

  return (
    <div
      role="separator"
      aria-label={label}
      aria-orientation={orientation}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value)}
      className={cn(
        "group relative z-30 grid shrink-0 touch-none select-none place-items-center bg-border/70 outline-none transition-colors hover:bg-primary/60 focus-visible:bg-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
        orientation === "vertical"
          ? "h-full w-2 cursor-col-resize"
          : "h-2 w-full cursor-row-resize",
        isDragging && "bg-primary",
      )}
      tabIndex={0}
      title={`${label}. Drag to resize or double-click to reset.`}
      onDoubleClick={onReset}
      onKeyDown={handleKeyDown}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      <span
        aria-hidden="true"
        className={cn(
          "rounded-full bg-muted-foreground/70 transition-colors group-hover:bg-primary-foreground group-focus-visible:bg-primary-foreground",
          orientation === "vertical" ? "h-8 w-0.5" : "h-0.5 w-8",
        )}
      />
    </div>
  );
}
