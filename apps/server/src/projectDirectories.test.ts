import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  ProjectDirectoryError,
  ensureProjectDirectory,
  expandUserHomePath,
  resolveProjectDirectoryPath,
} from "./projectDirectories";

describe("expandUserHomePath", () => {
  it("expands ~/ prefixes to the current home directory", () => {
    expect(expandUserHomePath("~/Downloads")).toBe(path.join(os.homedir(), "Downloads"));
  });
});

describe("resolveProjectDirectoryPath", () => {
  it("rejects relative parent paths", () => {
    expect(() =>
      resolveProjectDirectoryPath({
        parentPath: "Downloads",
        directoryName: "my-projects",
      }),
    ).toThrow(ProjectDirectoryError);
  });

  it("rejects path separators in the directory name", () => {
    expect(() =>
      resolveProjectDirectoryPath({
        parentPath: os.homedir(),
        directoryName: "client/app",
      }),
    ).toThrow(ProjectDirectoryError);
  });
});

describe("ensureProjectDirectory", () => {
  it("creates a directory when it does not exist yet", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "t3-project-home-"));
    const result = await ensureProjectDirectory({
      parentPath: tempRoot,
      directoryName: "alpha-project",
    });

    expect(result.created).toBe(true);
    const stat = await fs.stat(result.path);
    expect(stat.isDirectory()).toBe(true);
  });

  it("reuses an existing directory", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "t3-project-home-"));
    const existingPath = path.join(tempRoot, "beta-project");
    await fs.mkdir(existingPath);

    const result = await ensureProjectDirectory({
      parentPath: tempRoot,
      directoryName: "beta-project",
    });

    expect(result).toEqual({
      path: existingPath,
      created: false,
    });
  });
});
