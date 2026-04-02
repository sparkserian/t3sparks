import type * as acp from "@agentclientprotocol/sdk";
import type {
  CanonicalItemType,
  CanonicalRequestType,
  ProviderApprovalDecision,
} from "@t3sparks/contracts";

export function mapCopilotToolKindToItemType(kind?: acp.ToolKind | null): CanonicalItemType {
  switch (kind) {
    case "execute":
      return "command_execution";
    case "edit":
    case "delete":
    case "move":
      return "file_change";
    default:
      return "dynamic_tool_call";
  }
}

export function mapCopilotToolKindToRequestType(
  kind?: acp.ToolKind | null,
): CanonicalRequestType {
  switch (kind) {
    case "execute":
      return "command_execution_approval";
    case "edit":
    case "delete":
    case "move":
      return "file_change_approval";
    case "read":
      return "file_read_approval";
    default:
      return "unknown";
  }
}

export function selectPermissionOptionId(
  decision: ProviderApprovalDecision,
  options: ReadonlyArray<acp.PermissionOption>,
): string | null {
  const kinds =
    decision === "acceptForSession"
      ? ["allow_always", "allow_once"]
      : decision === "accept"
        ? ["allow_once", "allow_always"]
        : decision === "decline"
          ? ["reject_once", "reject_always"]
          : [];

  for (const kind of kinds) {
    const option = options.find((entry) => entry.kind === kind);
    if (option) {
      return option.optionId;
    }
  }

  return null;
}

export function selectAutoApproveOptionId(
  options: ReadonlyArray<acp.PermissionOption>,
): string | null {
  return (
    options.find((entry) => entry.kind === "allow_always")?.optionId ??
    options.find((entry) => entry.kind === "allow_once")?.optionId ??
    null
  );
}

export function planEntriesToSteps(
  entries: ReadonlyArray<acp.PlanEntry> | null | undefined,
): Array<{
  step: string;
  status: "pending" | "inProgress" | "completed";
}> {
  return (entries ?? []).map((entry) => ({
    step: entry.content,
    status:
      entry.status === "in_progress"
        ? "inProgress"
        : entry.status === "completed"
          ? "completed"
          : "pending",
  }));
}

export function stopReasonToTurnStatus(
  stopReason: acp.StopReason | null | undefined,
): "completed" | "failed" | "interrupted" | "cancelled" {
  switch (stopReason) {
    case "cancelled":
      return "interrupted";
    case "refusal":
      return "failed";
    default:
      return "completed";
  }
}

export function summarizeToolCall(input: {
  readonly title?: string | null;
  readonly locations?: ReadonlyArray<acp.ToolCallLocation> | null;
  readonly rawInput?: unknown;
  readonly rawOutput?: unknown;
}): string | undefined {
  const locationList = input.locations
    ?.map((entry) => (typeof entry.line === "number" ? `${entry.path}:${entry.line}` : entry.path))
    .slice(0, 3);
  if (locationList && locationList.length > 0) {
    return locationList.join(", ");
  }

  for (const value of [input.rawOutput, input.rawInput]) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim().slice(0, 180);
    }
    if (value && typeof value === "object") {
      try {
        return JSON.stringify(value).slice(0, 180);
      } catch {
        // Ignore serialization failures.
      }
    }
  }

  const title = input.title?.trim();
  return title && title.length > 0 ? title : undefined;
}
