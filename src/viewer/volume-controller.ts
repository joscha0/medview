import {
  cache,
  LegacyVolumeViewport3D,
  type Types,
} from "@cornerstonejs/core";
import {
  Enums as ToolEnums,
  ToolGroupManager,
  ZoomTool,
} from "@cornerstonejs/tools";

import { OrbitRotateTool } from "@/tools/orbit-rotate-tool";
import { TouchVolumeCroppingTool } from "@/tools/touch-volume-cropping-tool";

export const RENDERING_ENGINE_ID = "medview-rendering-engine";
export const VIEWPORT_ID = "medview-stack-viewport";
export const TOOL_GROUP_ID = "medview-volume-tools";

type VolumeViewport = InstanceType<typeof LegacyVolumeViewport3D>;

function getCroppingTool() {
  return ToolGroupManager.getToolGroup(TOOL_GROUP_ID)?.getToolInstance(
    TouchVolumeCroppingTool.toolName,
  ) as TouchVolumeCroppingTool | undefined;
}

function activateOrbitTool() {
  ToolGroupManager.getToolGroup(TOOL_GROUP_ID)?.setToolActive(
    OrbitRotateTool.toolName,
    { bindings: [{ mouseButton: ToolEnums.MouseBindings.Primary }] },
  );
}

export function getDefaultVolumePreset(modality?: string) {
  return modality?.toUpperCase() === "MR" ? "MR-Default" : "CT-Bone";
}

export function cloneCamera(camera: Types.ICamera): Types.ICamera {
  return {
    ...camera,
    aspectRatio: camera.aspectRatio ? [...camera.aspectRatio] : undefined,
    clippingRange: camera.clippingRange
      ? [...camera.clippingRange]
      : undefined,
    focalPoint: camera.focalPoint ? [...camera.focalPoint] : undefined,
    position: camera.position ? [...camera.position] : undefined,
    viewPlaneNormal: camera.viewPlaneNormal
      ? [...camera.viewPlaneNormal]
      : undefined,
    viewUp: camera.viewUp ? [...camera.viewUp] : undefined,
  };
}

export function alignVolumeCameraForOrbit(viewport: VolumeViewport) {
  const camera = viewport.getCamera();
  if (!camera.focalPoint || !camera.position) return;
  const distance = Math.hypot(
    camera.position[0] - camera.focalPoint[0],
    camera.position[1] - camera.focalPoint[1],
    camera.position[2] - camera.focalPoint[2],
  );
  if (!distance) return;
  viewport.setCamera({
    focalPoint: [...camera.focalPoint],
    position: [
      camera.focalPoint[0],
      camera.focalPoint[1] - distance,
      camera.focalPoint[2],
    ],
    viewUp: [0, 0, 1],
  });
}

export function recenterCamera(
  viewport: VolumeViewport,
  nextFocalPoint: Types.Point3,
) {
  const camera = viewport.getCamera();
  if (!camera.focalPoint || !camera.position) return;
  const offset: Types.Point3 = [
    nextFocalPoint[0] - camera.focalPoint[0],
    nextFocalPoint[1] - camera.focalPoint[1],
    nextFocalPoint[2] - camera.focalPoint[2],
  ];
  viewport.setCamera({
    focalPoint: [...nextFocalPoint],
    position: [
      camera.position[0] + offset[0],
      camera.position[1] + offset[1],
      camera.position[2] + offset[2],
    ],
  });
}

export function applyVolumePresentation(
  viewport: VolumeViewport,
  preset: string,
  opacityThreshold: number,
) {
  viewport.setProperties({ preset });
  if (opacityThreshold <= 0) return;
  const volumeActor = viewport.getDefaultActor().actor as Types.VolumeActor;
  const opacityFunction = volumeActor.getProperty().getScalarOpacity(0);
  const nodes = Array.from(
    { length: opacityFunction.getSize() },
    (_, index) => {
      const node = [0, 0, 0.5, 0];
      opacityFunction.getNodeValue(index, node);
      return node;
    },
  );
  if (!nodes.length) return;
  const minimum = nodes[0][0];
  const maximum = nodes[nodes.length - 1][0];
  const threshold = minimum + (maximum - minimum) * (opacityThreshold / 100);
  opacityFunction.removeAllPoints();
  opacityFunction.addPoint(minimum, 0);
  opacityFunction.addPoint(threshold, 0);
  nodes
    .filter(([intensity]) => intensity > threshold)
    .forEach(([intensity, opacity, midpoint, sharpness]) => {
      opacityFunction.addPointLong(intensity, opacity, midpoint, sharpness);
    });
}

export function removeCachedVolume(volumeId: string | null) {
  if (!volumeId) return;
  const volume = cache.getVolume(volumeId);
  if (!volume) return;
  if ("cancelLoading" in volume) volume.cancelLoading();
  try {
    cache.removeVolumeLoadObject(volumeId);
  } catch {
    // A concurrent mode or series change may already have removed it.
  }
}

export function setVolumeToolsActive(active: boolean) {
  const toolGroup = ToolGroupManager.getToolGroup(TOOL_GROUP_ID);
  if (!toolGroup) return;
  if (!active) {
    toolGroup.setToolDisabled(OrbitRotateTool.toolName);
    toolGroup.setToolDisabled(TouchVolumeCroppingTool.toolName);
    toolGroup.setToolDisabled(ZoomTool.toolName);
    return;
  }
  toolGroup.setToolDisabled(TouchVolumeCroppingTool.toolName);
  activateOrbitTool();
  toolGroup.setToolActive(ZoomTool.toolName, {
    bindings: [
      { mouseButton: ToolEnums.MouseBindings.Wheel },
      { numTouchPoints: 2 },
    ],
  });
}

export function forgetVolumeCropState() {
  const tool = getCroppingTool();
  if (!tool) return;
  tool.originalClippingPlanes = [];
  tool.sphereStates = [];
  tool.edgeLines = {};
}

export function bindToolsToViewport() {
  const toolGroup = ToolGroupManager.getToolGroup(TOOL_GROUP_ID);
  if (!toolGroup) return;
  const bound = toolGroup.getViewportsInfo().some(
    (viewport) =>
      viewport.viewportId === VIEWPORT_ID &&
      viewport.renderingEngineId === RENDERING_ENGINE_ID,
  );
  if (!bound) toolGroup.addViewport(VIEWPORT_ID, RENDERING_ENGINE_ID);
}

export function startCropEditing() {
  const toolGroup = ToolGroupManager.getToolGroup(TOOL_GROUP_ID);
  const tool = getCroppingTool();
  if (!toolGroup || !tool) throw new Error("Crop tool is unavailable.");
  toolGroup.setToolDisabled(OrbitRotateTool.toolName);
  toolGroup.setToolActive(TouchVolumeCroppingTool.toolName, {
    bindings: [
      { mouseButton: ToolEnums.MouseBindings.Primary },
      { numTouchPoints: 1 },
    ],
  });
  tool.setClippingPlanesVisible(true);
  tool.setHandlesVisible(true);
}

export function applyCurrentCrop(viewport: VolumeViewport) {
  const toolGroup = ToolGroupManager.getToolGroup(TOOL_GROUP_ID);
  const tool = getCroppingTool();
  if (!toolGroup || !tool) throw new Error("Crop tool is unavailable.");
  tool.setClippingPlanesVisible(true);
  tool.setHandlesVisible(false);
  const planes = tool.originalClippingPlanes.slice(0, 6);
  if (planes.length === 6) {
    const center = planes.reduce<Types.Point3>(
      (sum, { origin }) => [
        sum[0] + origin[0] / planes.length,
        sum[1] + origin[1] / planes.length,
        sum[2] + origin[2] / planes.length,
      ],
      [0, 0, 0],
    );
    recenterCamera(viewport, center);
  }
  toolGroup.setToolEnabled(TouchVolumeCroppingTool.toolName);
  activateOrbitTool();
  viewport.render();
}

export function clearCurrentCrop(
  viewport: VolumeViewport,
  initialFocalPoint?: Types.Point3,
) {
  const toolGroup = ToolGroupManager.getToolGroup(TOOL_GROUP_ID);
  const tool = getCroppingTool();
  if (!toolGroup || !tool) throw new Error("Crop tool is unavailable.");
  tool.setClippingPlanesVisible(false);
  tool.setHandlesVisible(false);
  const imageData = tool._getVolumeActor()?.getMapper()?.getInputData();
  const directions = tool.volumeDirectionVectors;
  if (imageData && directions && tool.sphereStates.length) {
    const [width, height, depth] = imageData.getDimensions();
    const center = [width / 2, height / 2, depth / 2];
    const { xDir, yDir, zDir } = directions;
    tool.originalClippingPlanes = [
      { origin: imageData.indexToWorld([0, center[1], center[2]]), normal: [...xDir] },
      { origin: imageData.indexToWorld([width, center[1], center[2]]), normal: [-xDir[0], -xDir[1], -xDir[2]] },
      { origin: imageData.indexToWorld([center[0], 0, center[2]]), normal: [...yDir] },
      { origin: imageData.indexToWorld([center[0], height, center[2]]), normal: [-yDir[0], -yDir[1], -yDir[2]] },
      { origin: imageData.indexToWorld([center[0], center[1], 0]), normal: [...zDir] },
      { origin: imageData.indexToWorld([center[0], center[1], depth]), normal: [-zDir[0], -zDir[1], -zDir[2]] },
    ];
    tool._updateFaceSpheresFromClippingPlanes();
    tool._updateCornerSpheresFromFaces();
    tool._updateFaceSpheresFromCorners();
    tool._updateCornerSpheres();
    tool._updateEdgeLines();
  }
  if (initialFocalPoint) recenterCamera(viewport, initialFocalPoint);
  toolGroup.setToolDisabled(TouchVolumeCroppingTool.toolName);
  activateOrbitTool();
  viewport.render();
}

export function syncCropAfterResize(viewport: VolumeViewport) {
  const tool = getCroppingTool();
  if (
    !tool?.getClippingPlanesVisible() ||
    tool.originalClippingPlanes.length < 6
  ) {
    return;
  }
  tool._updateClippingPlanes(viewport);
  viewport.render();
}
