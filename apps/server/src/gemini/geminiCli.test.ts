import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";

import {
  buildGeminiHeadlessArgs,
  readConfiguredGeminiAuth,
  type GeminiCliResolution,
} from "./geminiCli";

const ORIGINAL_ENV = {
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  GOOGLE_GENAI_USE_GCA: process.env.GOOGLE_GENAI_USE_GCA,
  GOOGLE_GENAI_USE_VERTEXAI: process.env.GOOGLE_GENAI_USE_VERTEXAI,
};

function restoreEnv(): void {
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

afterEach(() => {
  restoreEnv();
});

describe("readConfiguredGeminiAuth", () => {
  it("treats Google-account auth as configured but not directly verifiable", async () => {
    process.env.GOOGLE_GENAI_USE_GCA = "1";
    delete process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_GENAI_USE_VERTEXAI;

    const auth = await readConfiguredGeminiAuth();

    assert.deepEqual(auth, {
      authType: "oauth-personal",
      authStatus: "unknown",
    });
  });

  it("treats API-key auth as authenticated", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    delete process.env.GOOGLE_GENAI_USE_GCA;
    delete process.env.GOOGLE_GENAI_USE_VERTEXAI;

    const auth = await readConfiguredGeminiAuth();

    assert.deepEqual(auth, {
      authType: "gemini-api-key",
      authStatus: "authenticated",
    });
  });
});

describe("buildGeminiHeadlessArgs", () => {
  it("builds stream-json Gemini CLI args with model and resume session", () => {
    const resolution: GeminiCliResolution = {
      available: true,
      installed: false,
      command: "npx",
      args: ["-y", "@google/gemini-cli"],
      executableCommand: "npx -y @google/gemini-cli",
      setupCommand: "npx -y @google/gemini-cli",
      headlessCommand: 'npx -y @google/gemini-cli -p "<prompt>" -o stream-json --approval-mode yolo',
    };

    const args = buildGeminiHeadlessArgs(resolution, {
      prompt: "Summarize this repository.",
      model: "gemini-2.5-pro",
      sessionId: "session-123",
    });

    assert.deepEqual(args, [
      "-y",
      "@google/gemini-cli",
      "-p",
      "Summarize this repository.",
      "-o",
      "stream-json",
      "--approval-mode",
      "yolo",
      "-m",
      "gemini-2.5-pro",
      "--resume",
      "session-123",
    ]);
  });
});
