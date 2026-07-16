import { AlertCircle, FileImage, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

interface ViewerStatusOverlayProps {
  error: string | null;
  hasImages: boolean;
  isLoading: boolean;
  isReady: boolean;
  loadingMessage: string;
  onChooseFiles: () => void;
}

export function ViewerStatusOverlay({
  error,
  hasImages,
  isLoading,
  isReady,
  loadingMessage,
  onChooseFiles,
}: ViewerStatusOverlayProps) {
  return (
    <>
      {!hasImages && !isLoading && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center p-6">
          <div className="text-center">
            <FileImage className="mx-auto size-7 text-muted-foreground" />
            <p className="mt-3 text-sm text-muted-foreground">
              {isReady ? "Drop a DICOM series to begin" : "Starting viewer…"}
            </p>
            {isReady && (
              <Button
                className="pointer-events-auto mt-4"
                variant="secondary"
                size="sm"
                onClick={onChooseFiles}
              >
                Choose files
              </Button>
            )}
          </div>
        </div>
      )}

      {isLoading && (
        <div
          className="absolute inset-0 z-20 grid place-items-center bg-black/80"
          role="status"
          aria-live="polite"
        >
          <div className="text-center">
            <Loader2 className="mx-auto size-5 animate-spin" />
            <p className="mt-3 text-sm text-muted-foreground">
              {loadingMessage}
            </p>
          </div>
        </div>
      )}

      {error && !isLoading && (
        <Card
          className="absolute left-1/2 top-4 z-20 w-[min(28rem,calc(100%-2rem))] -translate-x-1/2 border-destructive/50 bg-background shadow-none"
          role="alert"
        >
          <CardContent className="flex gap-2.5 p-3 text-sm">
            <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
            <p>{error}</p>
          </CardContent>
        </Card>
      )}
    </>
  );
}
