import { Upload } from "lucide-react";

import { AnatomyViewer } from "@/components/anatomy-viewer";
import { DicomMetadataOverlay } from "@/components/dicom-metadata-overlay";
import { PanelResizeHandle } from "@/components/panel-resize-handle";
import { SeriesPicker } from "@/components/series-picker";
import { ViewModeSwitcher } from "@/components/view-mode-switcher";
import { ViewerFooter } from "@/components/viewer-footer";
import { ViewerStatusOverlay } from "@/components/viewer-status-overlay";
import { VolumeRenderingOptions } from "@/components/volume-rendering-options";
import { useMedViewController } from "@/hooks/use-medview-controller";

const DEFAULT_ANATOMY_PANEL_SIZE = 35;
const MIN_VIEWER_PANEL_HEIGHT = 140;

function App() {
  const {
    activeSeriesId,
    anatomyPanelSize,
    beginVolumeInteraction,
    changeOpacityThreshold,
    changeVolumePreset,
    clearVolumeCrop,
    currentIndex,
    error,
    fileInputRef,
    goToImage,
    handleDragEnter,
    handleDragLeave,
    handleDrop,
    handleFileSelection,
    handleKeyDown,
    handleWheel,
    hasCrop,
    imageCount,
    isCropping,
    isDragging,
    isLoading,
    isLoadingExamples,
    isReady,
    isVolumeOptionsOpen,
    loadingMessage,
    opacityThreshold,
    resetVolumeCamera,
    scheduleFinalVolumeRender,
    selectSeries,
    seriesFiles,
    seriesList,
    setAnatomyPanelSize,
    setIsVolumeOptionsOpen,
    slicePlane,
    switchViewMode,
    toggleCroppingMode,
    viewMode,
    viewerPanelsRef,
    viewportElementRef,
    volumePreset,
    volumePresetOptions,
  } = useMedViewController();
  return (
    <div
      className="medview-app dark flex h-svh min-h-[520px] flex-col overflow-hidden bg-background text-foreground"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={(event) => event.preventDefault()}
      onDrop={handleDrop}
    >
      <input
        ref={fileInputRef}
        className="sr-only"
        type="file"
        multiple
        onChange={handleFileSelection}
      />

      <main className="relative flex min-h-0 flex-1">
        <SeriesPicker
          activeSeriesId={activeSeriesId}
          disabled={!isReady || isLoading}
          isLoadingExamples={isLoadingExamples}
          series={seriesList}
          onAdd={() => fileInputRef.current?.click()}
          onSelect={(seriesId) => void selectSeries(seriesId)}
        />

        <section className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div
            ref={viewerPanelsRef}
            className="grid min-h-0 flex-1"
            style={{
              gridTemplateRows:
                viewMode === "stack"
                  ? `minmax(${MIN_VIEWER_PANEL_HEIGHT}px, ${anatomyPanelSize}fr) auto minmax(${MIN_VIEWER_PANEL_HEIGHT}px, ${100 - anatomyPanelSize}fr)`
                  : "minmax(0, 1fr)",
            }}
          >
            {viewMode === "stack" && (
              <>
                <AnatomyViewer slicePlane={slicePlane} />

                <PanelResizeHandle
                  containerRef={viewerPanelsRef}
                  label="Resize anatomy and DICOM viewer panels"
                  minFirstSize={MIN_VIEWER_PANEL_HEIGHT}
                  minSecondSize={MIN_VIEWER_PANEL_HEIGHT}
                  orientation="horizontal"
                  value={anatomyPanelSize}
                  onChange={setAnatomyPanelSize}
                  onReset={() =>
                    setAnatomyPanelSize(DEFAULT_ANATOMY_PANEL_SIZE)
                  }
                />
              </>
            )}

            <div
              className="@container relative min-h-0 min-w-0 touch-none overflow-hidden bg-black outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onWheel={handleWheel}
              onPointerDown={beginVolumeInteraction}
              onPointerUp={scheduleFinalVolumeRender}
              onPointerCancel={scheduleFinalVolumeRender}
              onLostPointerCapture={scheduleFinalVolumeRender}
              onKeyDown={handleKeyDown}
              tabIndex={0}
              aria-label="DICOM image viewport. Use the mouse wheel or arrow keys to move through the series."
            >
              <div ref={viewportElementRef} className="absolute inset-0" />

              {imageCount > 0 && (
                <ViewModeSwitcher
                  disabled={isLoading}
                  mode={viewMode}
                  onChange={(mode) => void switchViewMode(mode)}
                />
              )}

              {imageCount > 0 && viewMode === "volume" && (
                <VolumeRenderingOptions
                  hasCrop={hasCrop}
                  isCropping={isCropping}
                  isOpen={isVolumeOptionsOpen}
                  opacityThreshold={opacityThreshold}
                  preset={volumePreset}
                  presets={volumePresetOptions}
                  onClearCrop={clearVolumeCrop}
                  onClose={() => setIsVolumeOptionsOpen(false)}
                  onOpen={() => setIsVolumeOptionsOpen(true)}
                  onPresetChange={changeVolumePreset}
                  onThresholdChange={changeOpacityThreshold}
                  onToggleCrop={toggleCroppingMode}
                />
              )}

              <ViewerStatusOverlay
                error={error}
                hasImages={imageCount > 0}
                isLoading={isLoading}
                isReady={isReady}
                loadingMessage={loadingMessage}
                onChooseFiles={() => fileInputRef.current?.click()}
              />

              {imageCount > 0 && viewMode === "stack" && (
                <DicomMetadataOverlay
                  metadata={seriesFiles[currentIndex]}
                  currentIndex={currentIndex}
                  imageCount={imageCount}
                />
              )}
            </div>
          </div>

          <ViewerFooter
            currentIndex={currentIndex}
            imageCount={imageCount}
            isCropping={isCropping}
            mode={viewMode}
            onChangeImage={goToImage}
            onResetVolume={resetVolumeCamera}
          />
        </section>

        {isDragging && (
          <div className="pointer-events-none absolute inset-3 z-50 grid place-items-center rounded-lg border-2 border-dashed border-primary bg-background/95">
            <div className="text-center">
              <Upload className="mx-auto size-6" />
              <p className="mt-3 text-sm font-medium">Drop files to open</p>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
