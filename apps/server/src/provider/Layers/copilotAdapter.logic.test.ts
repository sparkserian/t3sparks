import { describe, expect, it } from "vitest";

import {
  mapCopilotToolKindToItemType,
  mapCopilotToolKindToRequestType,
  planEntriesToSteps,
  selectAutoApproveOptionId,
  selectPermissionOptionId,
  stopReasonToTurnStatus,
} from "./copilotAdapter.logic.ts";

describe("mapCopilotToolKindToItemType", () => {
  it("maps execute tools to command execution items", () => {
    expect(mapCopilotToolKindToItemType("execute")).toBe("command_execution");
  });

  it("maps edit-like tools to file changes", () => {
    expect(mapCopilotToolKindToItemType("edit")).toBe("file_change");
    expect(mapCopilotToolKindToItemType("delete")).toBe("file_change");
  });
});

describe("mapCopilotToolKindToRequestType", () => {
  it("maps read tools to file-read approvals", () => {
    expect(mapCopilotToolKindToRequestType("read")).toBe("file_read_approval");
  });

  it("maps unknown tools to unknown approvals", () => {
    expect(mapCopilotToolKindToRequestType("other")).toBe("unknown");
  });
});

describe("selectPermissionOptionId", () => {
  const options = [
    { optionId: "allow-once", kind: "allow_once", name: "Allow once" },
    { optionId: "allow-always", kind: "allow_always", name: "Always allow" },
    { optionId: "reject-once", kind: "reject_once", name: "Reject once" },
  ] as const;

  it("prefers session-wide approvals for acceptForSession", () => {
    expect(selectPermissionOptionId("acceptForSession", options)).toBe("allow-always");
  });

  it("prefers single-run approvals for accept", () => {
    expect(selectPermissionOptionId("accept", options)).toBe("allow-once");
  });

  it("returns null for cancel", () => {
    expect(selectPermissionOptionId("cancel", options)).toBeNull();
  });
});

describe("selectAutoApproveOptionId", () => {
  it("prefers allow_always when available", () => {
    expect(
      selectAutoApproveOptionId([
        { optionId: "allow-once", kind: "allow_once", name: "Allow once" },
        { optionId: "allow-always", kind: "allow_always", name: "Always allow" },
      ]),
    ).toBe("allow-always");
  });

  it("falls back to allow_once when allow_always is unavailable", () => {
    expect(
      selectAutoApproveOptionId([
        { optionId: "allow-once", kind: "allow_once", name: "Allow once" },
        { optionId: "reject-once", kind: "reject_once", name: "Deny" },
      ]),
    ).toBe("allow-once");
  });
});

describe("planEntriesToSteps", () => {
  it("maps ACP plan states to renderer plan states", () => {
    expect(
      planEntriesToSteps([
        { content: "Inspect repo", priority: "high", status: "pending" },
        { content: "Implement adapter", priority: "high", status: "in_progress" },
        { content: "Run tests", priority: "medium", status: "completed" },
      ]),
    ).toEqual([
      { step: "Inspect repo", status: "pending" },
      { step: "Implement adapter", status: "inProgress" },
      { step: "Run tests", status: "completed" },
    ]);
  });
});

describe("stopReasonToTurnStatus", () => {
  it("maps cancelled turns to interrupted", () => {
    expect(stopReasonToTurnStatus("cancelled")).toBe("interrupted");
  });
});
