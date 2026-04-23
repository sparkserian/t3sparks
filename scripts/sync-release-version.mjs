import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "..");
const rootPackageJsonPath = resolve(repoRoot, "package.json");
const rootPackageJson = JSON.parse(readFileSync(rootPackageJsonPath, "utf8"));
const version = rootPackageJson.version;

if (typeof version !== "string" || version.length === 0) {
  throw new Error("Root package.json is missing a valid version.");
}

const packageJsonPaths = [
  "apps/desktop/package.json",
  "apps/server/package.json",
  "apps/web/package.json",
  "packages/contracts/package.json",
];

for (const relativePath of packageJsonPaths) {
  const absolutePath = resolve(repoRoot, relativePath);
  const packageJson = JSON.parse(readFileSync(absolutePath, "utf8"));
  if (packageJson.version === version) {
    continue;
  }
  packageJson.version = version;
  writeFileSync(absolutePath, `${JSON.stringify(packageJson, null, 2)}\n`);
}

console.log(`[release] Synced workspace package versions to ${version}`);
