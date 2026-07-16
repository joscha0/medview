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

  private animationFrameId: number | null = null;
  private lastRenderTime = Number.NEGATIVE_INFINITY;
  private pendingDelta: [number, number] = [0, 0];
  private pendingElement: HTMLDivElement | null = null;

  constructor(
    toolProps: CornerstoneToolTypes.PublicToolProps = {},
    defaultToolProps: CornerstoneToolTypes.ToolProps = {
      supportedInteractionTypes: ["Mouse", "Touch"],
      configuration: {
        maxPolarAngle: DEFAULT_MAX_POLAR_ANGLE,
        maxRenderFps: 30,
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

  onSetToolDisabled = () => {
    if (this.animationFrameId !== null) {
      window.cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    this.lastRenderTime = Number.NEGATIVE_INFINITY;
    this.pendingDelta = [0, 0];
    this.pendingElement = null;
  };

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
    this.pendingDelta[0] +=
      currentPoints.canvas[0] - lastPoints.canvas[0];
    this.pendingDelta[1] +=
      currentPoints.canvas[1] - lastPoints.canvas[1];
    this.pendingElement = element;

    if (this.animationFrameId !== null) return;
    this.animationFrameId = window.requestAnimationFrame(
      this.flushPendingRotation,
    );
  }

  private flushPendingRotation = (timestamp: number) => {
    this.animationFrameId = null;
    const minimumFrameInterval =
      1000 / Math.max(1, this.configuration.maxRenderFps);
    if (timestamp - this.lastRenderTime < minimumFrameInterval) {
      this.animationFrameId = window.requestAnimationFrame(
        this.flushPendingRotation,
      );
      return;
    }

    const element = this.pendingElement;
    const delta = this.pendingDelta;
    this.pendingDelta = [0, 0];
    if (!element || (delta[0] === 0 && delta[1] === 0)) return;

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
      delta,
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
    this.lastRenderTime = timestamp;
  };
}
