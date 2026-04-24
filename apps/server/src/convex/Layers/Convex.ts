/**
 * ConvexLive - Inspects a workspace to detect Convex setup state.
 */
import fs from "node:fs/promises";
import path from "node:path";

import {
  ConvexStatusError,
  type ConvexPackageManager,
  type ConvexStatusResult,
} from "@t3tools/contracts";
import { Effect, Layer, Schema } from "effect";

import { Convex, type ConvexShape } from "../Services/Convex.ts";

interface PackageJsonLike {
  readonly dependencies?: Record<string, unknown>;
  readonly devDependencies?: Record<string, unknown>;
  readonly packageManager?: string;
}

const PACKAGE_MANAGER_BY_LOCKFILE: ReadonlyArray<readonly [string, ConvexPackageManager]> = [
  ["bun.lock", "bun"],
  ["bun.lockb", "bun"],
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
  ["package-lock.json", "npm"],
  ["npm-shrinkwrap.json", "npm"],
] as const;

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

export function parsePackageManagerName(value: string | undefined): ConvexPackageManager | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (normalized.length === 0) return null;
  const [name] = normalized.split("@", 1);
  switch (name) {
    case "bun":
    case "npm":
    case "pnpm":
    case "yarn":
      return name;
    default:
      return null;
  }
}

export function inferConvexPackageManager(input: {
  readonly packageManagerField?: string;
  readonly existingFiles?: Iterable<string>;
}): ConvexPackageManager | null {
  const declared = parsePackageManagerName(input.packageManagerField);
  if (declared) return declared;

  const existingFiles = new Set(input.existingFiles ?? []);
  for (const [filename, packageManager] of PACKAGE_MANAGER_BY_LOCKFILE) {
    if (existingFiles.has(filename)) {
      return packageManager;
    }
  }

  return null;
}

export function buildConvexCommands(
  packageManager: ConvexPackageManager | null,
): Pick<ConvexStatusResult, "installCommand" | "devCommand" | "deployCommand"> {
  switch (packageManager) {
    case "bun":
      return {
        installCommand: "bun add convex",
        devCommand: "bunx convex dev",
        deployCommand: "bunx convex deploy",
      };
    case "pnpm":
      return {
        installCommand: "pnpm add convex",
        devCommand: "pnpm dlx convex dev",
        deployCommand: "pnpm dlx convex deploy",
      };
    case "yarn":
      return {
        installCommand: "yarn add convex",
        devCommand: "yarn dlx convex dev",
        deployCommand: "yarn dlx convex deploy",
      };
    case "npm":
      return {
        installCommand: "npm install convex",
        devCommand: "npx convex dev",
        deployCommand: "npx convex deploy",
      };
    default:
      return {
        installCommand: null,
        devCommand: null,
        deployCommand: null,
      };
  }
}

async function readPackageJson(cwd: string): Promise<PackageJsonLike | null> {
  const packageJsonPath = path.join(cwd, "package.json");
  if (!(await pathExists(packageJsonPath))) {
    return null;
  }

  const raw = await fs.readFile(packageJsonPath, "utf8");
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      throw new Error("package.json must contain a JSON object.");
    }
    return parsed as PackageJsonLike;
  } catch (cause) {
    throw new ConvexStatusError({
      message: "Unable to parse package.json while checking Convex status.",
      cause,
    });
  }
}

async function readExistingFiles(cwd: string): Promise<Set<string>> {
  try {
    return new Set(await fs.readdir(cwd));
  } catch (cause) {
    throw new ConvexStatusError({
      message: "Unable to read workspace contents while checking Convex status.",
      cause,
    });
  }
}

function hasConvexPackage(packageJson: PackageJsonLike | null): boolean {
  if (!packageJson) return false;
  const deps = packageJson.dependencies ?? {};
  const devDeps = packageJson.devDependencies ?? {};
  return typeof deps.convex === "string" || typeof devDeps.convex === "string";
}

const makeConvex = Effect.sync(() => {
  const service: ConvexShape = {
    getStatus: ({ cwd }) =>
      Effect.tryPromise({
        try: async () => {
          const [packageJson, existingFiles] = await Promise.all([
            readPackageJson(cwd),
            readExistingFiles(cwd),
          ]);
          const hasPackageJson = packageJson !== null;
          const packageManager =
            inferConvexPackageManager({
              ...(packageJson?.packageManager
                ? { packageManagerField: packageJson.packageManager }
                : {}),
              existingFiles,
            }) ?? (hasPackageJson ? "npm" : null);
          const hasConvexDependency = hasConvexPackage(packageJson);
          const hasConvexDirectory = await pathExists(path.join(cwd, "convex"));
          const hasEnvLocal = await pathExists(path.join(cwd, ".env.local"));
          const commands = hasPackageJson
            ? buildConvexCommands(packageManager)
            : { installCommand: null, devCommand: null, deployCommand: null };

          return {
            cwd,
            hasPackageJson,
            packageManager,
            hasConvexDependency,
            hasConvexDirectory,
            hasEnvLocal,
            isConfigured: hasConvexDependency && hasConvexDirectory && hasEnvLocal,
            ...commands,
          } satisfies ConvexStatusResult;
        },
        catch: (cause) =>
          Schema.is(ConvexStatusError)(cause)
            ? cause
            : new ConvexStatusError({
                message: "Unable to determine Convex project status.",
                cause,
              }),
      }),
  };

  return service;
});

export const ConvexLive = Layer.effect(Convex, makeConvex);
