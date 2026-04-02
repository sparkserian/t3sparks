import type { ServerProviderModel, ServerProviderQuotaSnapshot } from "@t3sparks/contracts";
import { normalizeModelSlug } from "@t3sparks/shared/model";

export interface CopilotProviderModelMetadata {
  readonly slug: string;
  readonly name: string;
  readonly billingMultiplier?: number;
}

const COPILOT_QUOTA_PRIORITY = ["premium_interactions", "chat", "completions"] as const;

function getCopilotQuotaPriority(key: string): number {
  const index = COPILOT_QUOTA_PRIORITY.indexOf(key as (typeof COPILOT_QUOTA_PRIORITY)[number]);
  return index === -1 ? Number.POSITIVE_INFINITY : index;
}

function normalizeCopilotRemainingPercentage(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function formatCopilotQuotaLabel(key: string): string {
  return key.replaceAll("_", " ");
}

function formatCopilotQuotaResetDate(value: string | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function pickCopilotQuotaSnapshot(
  quotaSnapshots: ReadonlyArray<ServerProviderQuotaSnapshot> | undefined,
): ServerProviderQuotaSnapshot | null {
  if (!quotaSnapshots || quotaSnapshots.length === 0) return null;
  return quotaSnapshots.toSorted((left, right) => {
    const priorityDiff = getCopilotQuotaPriority(left.key) - getCopilotQuotaPriority(right.key);
    return priorityDiff !== 0 ? priorityDiff : left.key.localeCompare(right.key);
  })[0] ?? null;
}

export function normalizeCopilotProviderModels(
  models: ReadonlyArray<ServerProviderModel> | undefined,
): ReadonlyArray<CopilotProviderModelMetadata> {
  if (!models || models.length === 0) {
    return [];
  }

  const normalized: CopilotProviderModelMetadata[] = [];
  const seen = new Set<string>();
  for (const model of models) {
    const slug = normalizeModelSlug(model.id, "githubCopilot");
    if (!slug || seen.has(slug)) {
      continue;
    }
    seen.add(slug);
    normalized.push({
      slug,
      name: model.name,
      ...(typeof model.billingMultiplier === "number"
        ? { billingMultiplier: model.billingMultiplier }
        : {}),
    });
  }

  return normalized;
}

export function deriveCopilotQuotaSummary(
  quotaSnapshots: ReadonlyArray<ServerProviderQuotaSnapshot> | undefined,
): {
  readonly title: string;
  readonly detail: string;
  readonly remainingPercent: number;
  readonly progressTone: "default" | "warning" | "danger";
} | null {
  const snapshot = pickCopilotQuotaSnapshot(quotaSnapshots);
  if (!snapshot) return null;

  const remainingPercent = normalizeCopilotRemainingPercentage(snapshot.remainingPercentage);
  const resetDate = formatCopilotQuotaResetDate(snapshot.resetDate);
  const detailParts = [
    `${snapshot.remainingRequests}/${snapshot.entitlementRequests} requests left`,
    ...(resetDate ? [`resets ${resetDate}`] : []),
  ];

  return {
    title: formatCopilotQuotaLabel(snapshot.key),
    detail: detailParts.join(" • "),
    remainingPercent,
    progressTone:
      remainingPercent <= 10 ? "danger" : remainingPercent <= 25 ? "warning" : "default",
  };
}
