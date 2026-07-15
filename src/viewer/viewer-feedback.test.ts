import { describe, expect, it } from "vitest";

import {
  initialViewerFeedbackState,
  viewerFeedbackReducer,
} from "@/viewer/viewer-feedback";

describe("viewerFeedbackReducer", () => {
  it("starts an operation and clears a stale error atomically", () => {
    const state = {
      ...initialViewerFeedbackState,
      error: "Previous failure",
    };

    expect(
      viewerFeedbackReducer(state, {
        type: "start",
        message: "Building 3D volume…",
      }),
    ).toEqual({
      error: null,
      isLoading: true,
      loadingMessage: "Building 3D volume…",
    });
  });

  it("updates progress without discarding the current operation state", () => {
    const state = {
      error: null,
      isLoading: true,
      loadingMessage: "Reading headers…",
    };

    expect(
      viewerFeedbackReducer(state, {
        type: "message",
        message: "Decoding first image…",
      }),
    ).toEqual({
      ...state,
      loadingMessage: "Decoding first image…",
    });
  });

  it("stops loading while preserving a result warning", () => {
    const warningState = viewerFeedbackReducer(
      initialViewerFeedbackState,
      { type: "error", error: "3D is unavailable for this series." },
    );

    expect(
      viewerFeedbackReducer(
        { ...warningState, isLoading: true },
        { type: "stop" },
      ),
    ).toEqual({
      ...warningState,
      isLoading: false,
    });
  });
});
