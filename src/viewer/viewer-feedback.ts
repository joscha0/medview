export interface ViewerFeedbackState {
  error: string | null;
  isLoading: boolean;
  loadingMessage: string;
}

export type ViewerFeedbackAction =
  | { type: "start"; message: string }
  | { type: "stop" }
  | { type: "message"; message: string }
  | { type: "error"; error: string | null };

export const initialViewerFeedbackState: ViewerFeedbackState = {
  error: null,
  isLoading: false,
  loadingMessage: "Opening series…",
};

export function viewerFeedbackReducer(
  state: ViewerFeedbackState,
  action: ViewerFeedbackAction,
): ViewerFeedbackState {
  switch (action.type) {
    case "start":
      return { error: null, isLoading: true, loadingMessage: action.message };
    case "stop":
      return { ...state, isLoading: false };
    case "message":
      return { ...state, loadingMessage: action.message };
    case "error":
      return { ...state, error: action.error };
  }
}
