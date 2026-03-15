import { describe, expect, it } from "vitest";

import {
  getAppSettingsSnapshot,
  getAppModelOptions,
  getSlashModelOptions,
  normalizeCustomModelSlugs,
  resolveAppServiceTier,
  shouldShowFastTierIcon,
  resolveAppModelSelection,
} from "./appSettings";

describe("normalizeCustomModelSlugs", () => {
  it("normalizes aliases, removes built-ins, and deduplicates values", () => {
    expect(
      normalizeCustomModelSlugs([
        " custom/internal-model ",
        "gpt-5.3-codex",
        "5.3",
        "custom/internal-model",
        "",
        null,
      ]),
    ).toEqual(["custom/internal-model"]);
  });

  it("normalizes Gemini aliases against the Gemini catalog", () => {
    expect(
      normalizeCustomModelSlugs(
        [" 3.1-pro ", " pro ", " 2.5-pro ", " gemini-experimental "],
        "gemini",
      ),
    ).toEqual(["gemini-experimental"]);
  });
});

describe("getAppSettingsSnapshot", () => {
  it("provides onboarding defaults for new installs", () => {
    expect(getAppSettingsSnapshot()).toMatchObject({
      projectHomePath: "",
      hasSeenOnboarding: false,
    });
  });

  it("hydrates persisted onboarding state from local storage", () => {
    const store = new Map<string, string>();
    const previousWindow = (globalThis as typeof globalThis & { window?: unknown }).window;

    try {
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: {
          localStorage: {
            getItem: (key: string) => store.get(key) ?? null,
            setItem: (key: string, value: string) => {
              store.set(key, value);
            },
          },
        },
      });
      store.set(
        "t3sparks:app-settings:v1",
        JSON.stringify({
          projectHomePath: "/Users/william/Projects",
          hasSeenOnboarding: true,
          customInstructions: [
            {
              id: "review",
              title: " Review carefully ",
              body: " Prefer smaller diffs and call out risky assumptions. ",
            },
            {
              id: "review",
              title: "Duplicate should be ignored",
              body: "Duplicate body",
            },
          ],
        }),
      );

      expect(getAppSettingsSnapshot()).toMatchObject({
        projectHomePath: "/Users/william/Projects",
        hasSeenOnboarding: true,
        customInstructions: [
          {
            id: "review",
            title: "Review carefully",
            body: "Prefer smaller diffs and call out risky assumptions.",
          },
        ],
      });
    } finally {
      if (previousWindow === undefined) {
        Reflect.deleteProperty(globalThis, "window");
      } else {
        Object.defineProperty(globalThis, "window", {
          configurable: true,
          value: previousWindow,
        });
      }
    }
  });
});

describe("getAppModelOptions", () => {
  it("appends saved custom models after the built-in options", () => {
    const options = getAppModelOptions("codex", ["custom/internal-model"]);

    expect(options.map((option) => option.slug)).toEqual([
      "gpt-5.4",
      "gpt-5.3-codex",
      "gpt-5.3-codex-spark",
      "gpt-5.2-codex",
      "gpt-5.2",
      "custom/internal-model",
    ]);
  });

  it("keeps the currently selected custom model available even if it is no longer saved", () => {
    const options = getAppModelOptions("codex", [], "custom/selected-model");

    expect(options.at(-1)).toEqual({
      slug: "custom/selected-model",
      name: "custom/selected-model",
      isCustom: true,
    });
  });

  it("returns Gemini built-ins before custom Gemini models", () => {
    const options = getAppModelOptions("gemini", ["gemini-experimental"]);

    expect(options.map((option) => option.slug)).toEqual([
      "auto",
      "gemini-3.1-pro-preview",
      "gemini-2.5-pro",
      "gemini-2.5-flash",
      "gemini-2.5-flash-lite",
      "gemini-experimental",
    ]);
  });
});

describe("resolveAppModelSelection", () => {
  it("preserves saved custom model slugs instead of falling back to the default", () => {
    expect(resolveAppModelSelection("codex", ["galapagos-alpha"], "galapagos-alpha")).toBe(
      "galapagos-alpha",
    );
  });

  it("falls back to the provider default when no model is selected", () => {
    expect(resolveAppModelSelection("codex", [], "")).toBe("gpt-5.4");
  });

  it("falls back to Gemini's provider default when no Gemini model is selected", () => {
    expect(resolveAppModelSelection("gemini", [], "")).toBe("auto");
  });
});

describe("getSlashModelOptions", () => {
  it("includes saved custom model slugs for /model command suggestions", () => {
    const options = getSlashModelOptions(
      "codex",
      ["custom/internal-model"],
      "",
      "gpt-5.3-codex",
    );

    expect(options.some((option) => option.slug === "custom/internal-model")).toBe(true);
  });

  it("filters slash-model suggestions across built-in and custom model names", () => {
    const options = getSlashModelOptions(
      "codex",
      ["openai/gpt-oss-120b"],
      "oss",
      "gpt-5.3-codex",
    );

    expect(options.map((option) => option.slug)).toEqual(["openai/gpt-oss-120b"]);
  });
});

describe("resolveAppServiceTier", () => {
  it("maps automatic to no override", () => {
    expect(resolveAppServiceTier("auto")).toBeNull();
  });

  it("preserves explicit service tier overrides", () => {
    expect(resolveAppServiceTier("fast")).toBe("fast");
    expect(resolveAppServiceTier("flex")).toBe("flex");
  });
});

describe("shouldShowFastTierIcon", () => {
  it("shows the fast-tier icon only for gpt-5.4 on fast tier", () => {
    expect(shouldShowFastTierIcon("gpt-5.4", "fast")).toBe(true);
    expect(shouldShowFastTierIcon("gpt-5.4", "auto")).toBe(false);
    expect(shouldShowFastTierIcon("gpt-5.3-codex", "fast")).toBe(false);
  });
});
