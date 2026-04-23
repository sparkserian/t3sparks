import { describe, expect, it } from "vitest";

import { resolveCodeFenceLanguage } from "./codeFenceLanguage";

describe("resolveCodeFenceLanguage", () => {
  it("falls back to text when a fence language is missing", () => {
    expect(resolveCodeFenceLanguage(undefined)).toBe("text");
  });

  it("maps env-style fences to bash", () => {
    expect(resolveCodeFenceLanguage("language-env")).toBe("bash");
    expect(resolveCodeFenceLanguage("language-dotenv")).toBe("bash");
    expect(resolveCodeFenceLanguage("language-.env")).toBe("bash");
  });

  it("preserves supported languages that do not need aliasing", () => {
    expect(resolveCodeFenceLanguage("language-tsx")).toBe("tsx");
  });
});
