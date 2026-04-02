import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  getBundledCopilotPlatformPackages,
  normalizeCopilotBinaryOverride,
  resolveBundledCopilotCliPathFrom,
} from "./copilotBinary.ts";

const SDK_ENTRYPOINT = "/repo/apps/server/node_modules/@github/copilot-sdk/dist/index.js";

describe("normalizeCopilotBinaryOverride", () => {
  it("treats plain copilot command names as no override", () => {
    expect(normalizeCopilotBinaryOverride("copilot")).toBeUndefined();
    expect(normalizeCopilotBinaryOverride(" copilot ")).toBeUndefined();
  });

  it("preserves explicit filesystem paths", () => {
    expect(normalizeCopilotBinaryOverride("/usr/local/bin/copilot")).toBe(
      "/usr/local/bin/copilot",
    );
  });
});

describe("getBundledCopilotPlatformPackages", () => {
  it("returns the matching package for each supported target", () => {
    expect(getBundledCopilotPlatformPackages("darwin", "arm64")).toEqual(["copilot-darwin-arm64"]);
    expect(getBundledCopilotPlatformPackages("linux", "x64")).toEqual(["copilot-linux-x64"]);
    expect(getBundledCopilotPlatformPackages("win32", "x64")).toEqual(["copilot-win32-x64"]);
  });
});

describe("resolveBundledCopilotCliPathFrom", () => {
  it("prefers unpacked platform binaries when present", () => {
    const expected = path.join(
      "/repo/apps/server/node_modules",
      "@github",
      "copilot-linux-x64",
      "copilot",
    );

    expect(
      resolveBundledCopilotCliPathFrom({
        currentDir: "/repo/apps/server/src/provider/Layers",
        sdkEntrypoint: SDK_ENTRYPOINT,
        platform: "linux",
        arch: "x64",
        exists: (candidate) => candidate === expected,
      }),
    ).toBe(expected);
  });

  it("falls back to the npm loader when no platform binary exists", () => {
    const expected = path.join(
      "/repo/apps/server/node_modules",
      "@github",
      "copilot",
      "npm-loader.js",
    );

    expect(
      resolveBundledCopilotCliPathFrom({
        currentDir: "/repo/apps/server/src/provider/Layers",
        sdkEntrypoint: SDK_ENTRYPOINT,
        platform: "linux",
        arch: "x64",
        exists: (candidate) => candidate === expected,
      }),
    ).toBe(expected);
  });

  it("checks app.asar.unpacked resources for packaged desktop builds", () => {
    const expected = path.join(
      "/Applications/T3 Sparks.app/Contents/Resources/app.asar.unpacked/node_modules",
      "@github",
      "copilot-darwin-arm64",
      "copilot",
    );

    expect(
      resolveBundledCopilotCliPathFrom({
        currentDir: "/repo/apps/server/src/provider/Layers",
        resourcesPath: "/Applications/T3 Sparks.app/Contents/Resources",
        sdkEntrypoint: SDK_ENTRYPOINT,
        platform: "darwin",
        arch: "arm64",
        exists: (candidate) => candidate === expected,
      }),
    ).toBe(expected);
  });
});
