import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { Schema } from "effect";

export class ProjectDirectoryError extends Schema.TaggedErrorClass<ProjectDirectoryError>()(
  "ProjectDirectoryError",
  {
    message: Schema.String,
  },
) {}

export function expandUserHomePath(input: string): string {
  const trimmed = input.trim();
  if (trimmed === "~") {
    return os.homedir();
  }
  if (trimmed.startsWith("~/") || trimmed.startsWith("~\\")) {
    return path.join(os.homedir(), trimmed.slice(2));
  }
  return trimmed;
}

export function resolveProjectDirectoryPath(input: {
  parentPath: string;
  directoryName: string;
}): string {
  const parentPath = expandUserHomePath(input.parentPath);
  const directoryName = input.directoryName.trim();

  if (!path.isAbsolute(parentPath)) {
    throw new ProjectDirectoryError({
      message: "Project home parent path must be absolute.",
    });
  }

  if (directoryName.length === 0) {
    throw new ProjectDirectoryError({
      message: "Project folder name cannot be empty.",
    });
  }

  if (directoryName === "." || directoryName === "..") {
    throw new ProjectDirectoryError({
      message: "Project folder name must be a real folder name.",
    });
  }

  if (directoryName.includes("/") || directoryName.includes("\\")) {
    throw new ProjectDirectoryError({
      message: "Project folder name cannot contain path separators.",
    });
  }

  return path.resolve(parentPath, directoryName);
}

export async function ensureProjectDirectory(input: {
  parentPath: string;
  directoryName: string;
}): Promise<{ path: string; created: boolean }> {
  const targetPath = resolveProjectDirectoryPath(input);

  try {
    const existing = await fs.stat(targetPath);
    if (!existing.isDirectory()) {
      throw new ProjectDirectoryError({
        message: "A file already exists at that project folder path.",
      });
    }
    return { path: targetPath, created: false };
  } catch (error) {
    if ((error as NodeJS.ErrnoException | null)?.code !== "ENOENT") {
      throw error;
    }
  }

  await fs.mkdir(targetPath, { recursive: true });
  return { path: targetPath, created: true };
}
