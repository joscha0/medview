import {
  VolumeCroppingTool,
  type Types as CornerstoneToolTypes,
} from "@cornerstonejs/tools";

/**
 * Cornerstone 5.5 provides touch dragging for volume crop handles, but does
 * not wire touch start to the handle hit-test used by mouse input. Route the
 * normalized touch event through that existing hit-test so dragging can begin.
 */
export class TouchVolumeCroppingTool extends VolumeCroppingTool {
  static toolName = "TouchVolumeCropping";

  constructor(
    toolProps?: CornerstoneToolTypes.PublicToolProps,
    defaultToolProps?: CornerstoneToolTypes.ToolProps,
  ) {
    super(toolProps, defaultToolProps);
    this.preTouchStartCallback = this.preMouseDownCallback;
  }

  preTouchStartCallback: (
    event: CornerstoneToolTypes.EventTypes.InteractionEventType,
  ) => boolean;
}
