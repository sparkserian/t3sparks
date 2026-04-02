import { describe, expect, it } from "vitest";

import {
  deriveCopilotQuotaSummary,
  normalizeCopilotProviderModels,
} from "./copilotProviderStatus";

describe("normalizeCopilotProviderModels", () => {
  it("normalizes raw Copilot ids into picker-safe slugs", () => {
    expect(
      normalizeCopilotProviderModels([
        {
          id: "gpt-5.4",
          name: "GPT-5.4",
          supportsReasoningEffort: false,
          billingMultiplier: 2,
        },
      ]),
    ).toEqual([
      {
        slug: "copilot:gpt-5.4",
        name: "GPT-5.4",
        billingMultiplier: 2,
      },
    ]);
  });
});

describe("deriveCopilotQuotaSummary", () => {
  it("prefers premium interactions and builds a display summary", () => {
    const summary = deriveCopilotQuotaSummary([
        {
          key: "chat",
          entitlementRequests: 50,
          usedRequests: 10,
          remainingRequests: 40,
          remainingPercentage: 80,
          overage: 0,
          overageAllowedWithExhaustedQuota: false,
        },
        {
          key: "premium_interactions",
          entitlementRequests: 10,
          usedRequests: 5,
          remainingRequests: 5,
          remainingPercentage: 50,
          overage: 0,
          overageAllowedWithExhaustedQuota: false,
          resetDate: "2026-04-01T00:00:00.000Z",
        },
      ]);

    expect(summary).not.toBeNull();
    expect(summary).toMatchObject({
      title: "premium interactions",
      remainingPercent: 50,
      progressTone: "default",
    });
    expect(summary?.detail).toContain("5/10 requests left");
  });
});
