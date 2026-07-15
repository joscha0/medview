import { getEnabledElement } from "@cornerstonejs/core";
import {
  BaseTool,
  type Types as CornerstoneToolTypes,
} from "@cornerstonejs/tools";

import {
  orbitCamera,
  type OrbitVector3,
} from "@/lib/orbit-camera";

const DEFAULT_MIN_POLAR_ANGLE = Math.PI / 36;
const DEFAULT_MAX_POLAR_ANGLE = Math.PI - DEFAULT_MIN_POLAR_ANGLE;

export class OrbitRotateTool extends BaseTool {
  static toolName = "OrbitRotate";

  constructor(
    toolProps: CornerstoneToolTypes.PublicToolProps = {},
    defaultToolProps: CornerstoneToolTypes.ToolProps = {
      supportedInteractionTypes: ["Mouse", "Touch"],
      configuration: {
        maxPolarAngle: DEFAULT_MAX_POLAR_ANGLE,
        minPolarAngle: DEFAULT_MIN_POLAR_ANGLE,
        rotateSpeed: 0.8,
        // Cornerstone volumes use DICOM patient coordinates, where Z is the
        // anatomical equivalent of Three.js' default Y-up world axis.
        worldUp: [0, 0, 1],
      },
    },
  ) {
    super(toolProps, defaultToolProps);
    this.mouseDragCallback = this.dragCallback.bind(this);
    this.touchDragCallback = this.dragCallback.bind(this);
  }

  mouseDragCallback: (
    event: CornerstoneToolTypes.EventTypes.InteractionEventType,
  ) => void;

  touchDragCallback: (
    event: CornerstoneToolTypes.EventTypes.InteractionEventType,
  ) => void;

  private dragCallback(
    event: CornerstoneToolTypes.EventTypes.InteractionEventType,
  ) {
    const { currentPoints, element, lastPoints } = event.detail;
    const enabledElement = getEnabledElement(element);
    if (!enabledElement) return;
    const { viewport } = enabledElement;
    const camera = viewport.getCamera();
    if (!camera.focalPoint || !camera.position || !camera.viewUp) return;

    const nextCamera = orbitCamera(
      {
        focalPoint: [...camera.focalPoint] as OrbitVector3,
        position: [...camera.position] as OrbitVector3,
        viewUp: [...camera.viewUp] as OrbitVector3,
      },
      [
        currentPoints.canvas[0] - lastPoints.canvas[0],
        currentPoints.canvas[1] - lastPoints.canvas[1],
      ],
      element.clientHeight,
      {
        maxPolarAngle: this.configuration.maxPolarAngle,
        minPolarAngle: this.configuration.minPolarAngle,
        rotateSpeed: this.configuration.rotateSpeed,
        worldUp: this.configuration.worldUp as OrbitVector3,
      },
    );

    viewport.setCamera(nextCamera);
    viewport.render();
  }
}
