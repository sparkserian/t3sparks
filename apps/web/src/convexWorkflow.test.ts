import { describe, expect, it } from "vitest";

import {
  beginConvexAction,
  CONVEX_DEV_TERMINAL_ID,
  CONVEX_TASK_TERMINAL_ID,
  createInitialConvexWorkflowState,
  reduceConvexExit,
  reduceConvexOutput,
} from "./convexWorkflow";

describe("convexWorkflow", () => {
  it("captures authorization links from terminal output", () => {
    const next = reduceConvexOutput(beginConvexAction("dev"), {
      terminalId: CONVEX_DEV_TERMINAL_ID,
      data: "Please authorize in your browser: https://example.com/auth",
    });

    expect(next.phase).toBe("awaiting-auth");
    expect(next.authUrl).toBe("https://example.com/auth");
  });

  it("marks dev as running when ready text appears", () => {
    const next = reduceConvexOutput(beginConvexAction("dev"), {
      terminalId: CONVEX_DEV_TERMINAL_ID,
      data: "Watching for local changes...",
    });

    expect(next.phase).toBe("dev-running");
    expect(next.message).toBe("Convex dev is running.");
  });

  it("reports successful install completion", () => {
    const next = reduceConvexExit(beginConvexAction("install"), {
      terminalId: CONVEX_TASK_TERMINAL_ID,
      exitCode: 0,
      exitSignal: null,
    });

    expect(next.phase).toBe("success");
    expect(next.message).toBe("Convex installed.");
  });

  it("reports terminal failures", () => {
    const next = reduceConvexExit(createInitialConvexWorkflowState(), {
      terminalId: CONVEX_TASK_TERMINAL_ID,
      exitCode: 1,
      exitSignal: null,
    });

    expect(next.phase).toBe("error");
    expect(next.lastError).toContain("code 1");
  });
});
