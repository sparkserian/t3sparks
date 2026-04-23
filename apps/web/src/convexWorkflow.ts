const URL_PATTERN = /https?:\/\/[^\s"'`<>]+/i;
const AUTH_KEYWORDS = ["authorize", "authorization", "sign in", "login", "log in", "browser"];
const DEV_READY_KEYWORDS = ["watching", "ready", "convex dev", "functions ready", "sync complete"];

export const CONVEX_DEV_TERMINAL_ID = "convex-dev";
export const CONVEX_TASK_TERMINAL_ID = "convex-task";

export type ConvexAction = "install" | "dev" | "deploy";
export type ConvexWorkflowPhase =
  | "idle"
  | "installing"
  | "starting-dev"
  | "deploying"
  | "awaiting-auth"
  | "dev-running"
  | "success"
  | "error";

export interface ConvexWorkflowState {
  readonly phase: ConvexWorkflowPhase;
  readonly activeAction: ConvexAction | null;
  readonly authUrl: string | null;
  readonly message: string | null;
  readonly lastError: string | null;
}

export function createInitialConvexWorkflowState(): ConvexWorkflowState {
  return {
    phase: "idle",
    activeAction: null,
    authUrl: null,
    message: null,
    lastError: null,
  };
}

function extractUrl(value: string): string | null {
  return value.match(URL_PATTERN)?.[0] ?? null;
}

export function beginConvexAction(action: ConvexAction): ConvexWorkflowState {
  return {
    phase: action === "install" ? "installing" : action === "deploy" ? "deploying" : "starting-dev",
    activeAction: action,
    authUrl: null,
    message:
      action === "install"
        ? "Installing Convex..."
        : action === "deploy"
          ? "Deploying Convex..."
          : "Starting Convex dev...",
    lastError: null,
  };
}

export function reduceConvexOutput(
  state: ConvexWorkflowState,
  input: {
    readonly terminalId: string;
    readonly data: string;
  },
): ConvexWorkflowState {
  const lower = input.data.toLowerCase();
  const authUrl = extractUrl(input.data);
  const mentionsAuth = AUTH_KEYWORDS.some((keyword) => lower.includes(keyword));
  if (authUrl && mentionsAuth) {
    return {
      ...state,
      phase: "awaiting-auth",
      authUrl,
      message: "Authorize Convex in your browser to continue.",
      lastError: null,
    };
  }

  if (
    input.terminalId === CONVEX_DEV_TERMINAL_ID &&
    DEV_READY_KEYWORDS.some((keyword) => lower.includes(keyword))
  ) {
    return {
      ...state,
      phase: "dev-running",
      activeAction: "dev",
      message: "Convex dev is running.",
      lastError: null,
    };
  }

  return state;
}

export function reduceConvexExit(
  state: ConvexWorkflowState,
  input: {
    readonly terminalId: string;
    readonly exitCode: number | null;
    readonly exitSignal: number | null;
  },
): ConvexWorkflowState {
  if (input.exitCode === 0) {
    if (input.terminalId === CONVEX_DEV_TERMINAL_ID) {
      return {
        phase: "idle",
        activeAction: null,
        authUrl: null,
        message: "Convex dev stopped.",
        lastError: null,
      };
    }

    const action = state.activeAction;
    return {
      phase: "success",
      activeAction: null,
      authUrl: state.authUrl,
      message:
        action === "install"
          ? "Convex installed."
          : action === "deploy"
            ? "Convex deployed."
            : "Convex command completed.",
      lastError: null,
    };
  }

  const reasonParts = [
    input.exitCode !== null ? `code ${input.exitCode}` : null,
    input.exitSignal !== null ? `signal ${input.exitSignal}` : null,
  ].filter((value): value is string => value !== null);

  return {
    phase: "error",
    activeAction: null,
    authUrl: state.authUrl,
    message: "Convex command failed.",
    lastError: reasonParts.length > 0 ? `Process exited with ${reasonParts.join(", ")}.` : null,
  };
}
