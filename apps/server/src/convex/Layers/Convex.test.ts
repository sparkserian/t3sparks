import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildConvexCommands,
  inferConvexPackageManager,
  parsePackageManagerName,
} from "./Convex";

function makeTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe("Convex helpers", () => {
  it("parses supported package manager names", () => {
    expect(parsePackageManagerName("bun@1.3.10")).toBe("bun");
    expect(parsePackageManagerName("npm")).toBe("npm");
    expect(parsePackageManagerName("pnpm@9.0.0")).toBe("pnpm");
    expect(parsePackageManagerName("yarn@4.6.0")).toBe("yarn");
    expect(parsePackageManagerName("cargo")).toBeNull();
  });

  it("infers package manager from packageManager field before lockfiles", () => {
    expect(
      inferConvexPackageManager({
        packageManagerField: "pnpm@9.15.3",
        existingFiles: ["package-lock.json", "yarn.lock"],
      }),
    ).toBe("pnpm");
  });

  it("infers package manager from known lockfiles", () => {
    expect(inferConvexPackageManager({ existingFiles: ["bun.lock", "package.json"] })).toBe("bun");
    expect(inferConvexPackageManager({ existingFiles: ["pnpm-lock.yaml"] })).toBe("pnpm");
    expect(inferConvexPackageManager({ existingFiles: ["yarn.lock"] })).toBe("yarn");
    expect(inferConvexPackageManager({ existingFiles: ["package-lock.json"] })).toBe("npm");
  });

  it("builds package-manager-specific Convex commands", () => {
    expect(buildConvexCommands("bun")).toEqual({
      installCommand: "npm install convex",
      devCommand: "npx convex dev",
      deployCommand: "npx convex deploy",
    });
    expect(buildConvexCommands("npm")).toEqual({
      installCommand: "npm install convex",
      devCommand: "npx convex dev",
      deployCommand: "npx convex deploy",
    });
  });

  it("leaves commands empty when package manager is unknown", () => {
    expect(buildConvexCommands(null)).toEqual({
      installCommand: null,
      devCommand: null,
      deployCommand: null,
    });
  });

  it("supports real workspace filenames", () => {
    const cwd = makeTempDir("t3code-convex-helper-");
    fs.writeFileSync(path.join(cwd, "package.json"), '{"packageManager":"bun@1.3.10"}');
    fs.writeFileSync(path.join(cwd, "bun.lock"), "");
    expect(
      inferConvexPackageManager({
        packageManagerField: JSON.parse(
          fs.readFileSync(path.join(cwd, "package.json"), "utf8"),
        ).packageManager,
        existingFiles: fs.readdirSync(cwd),
      }),
    ).toBe("bun");
  });
});
