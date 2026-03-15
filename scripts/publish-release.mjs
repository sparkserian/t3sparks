import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const VALID_PLATFORMS = new Set(["mac-arm64", "win"]);

function fail(message) {
  console.error(`[release] ${message}`);
  process.exit(1);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: "inherit",
    env: process.env,
    ...options,
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function runCapture(command, args) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    const stderr = (result.stderr ?? "").trim();
    fail(stderr || `${command} ${args.join(" ")} failed`);
  }
  return (result.stdout ?? "").trim();
}

function loadDotEnvLocal() {
  const envPath = resolve(repoRoot, ".env.local");
  if (!existsSync(envPath)) {
    return;
  }

  const raw = readFileSync(envPath, "utf8");
  for (const line of raw.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    if (!key || process.env[key]) {
      continue;
    }

    let value = trimmed.slice(separatorIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  }
}

function findLatestRunId(repo, workflowFile) {
  const output = runCapture("gh", [
    "run",
    "list",
    "--repo",
    repo,
    "--workflow",
    workflowFile,
    "--limit",
    "1",
    "--json",
    "databaseId,url",
  ]);
  const runs = JSON.parse(output);
  const run = Array.isArray(runs) ? runs[0] : undefined;
  if (!run?.databaseId) {
    fail("Could not find the triggered GitHub Actions run.");
  }
  return run;
}

const repoRoot = resolve(import.meta.dirname, "..");
const platform = process.argv[2];

if (!VALID_PLATFORMS.has(platform)) {
  fail("Usage: node scripts/publish-release.mjs <mac-arm64|win>");
}

loadDotEnvLocal();

const packageJson = JSON.parse(readFileSync(resolve(repoRoot, "package.json"), "utf8"));
const version = packageJson.version;
if (typeof version !== "string" || version.length === 0) {
  fail("Root package.json is missing a valid version.");
}

const tag = `v${version}`;
const repository =
  process.env.T3CODE_DESKTOP_UPDATE_REPOSITORY?.trim() ||
  process.env.GITHUB_REPOSITORY?.trim() ||
  "";

if (!repository) {
  fail("Set T3CODE_DESKTOP_UPDATE_REPOSITORY in .env.local before publishing.");
}

runCapture("git", ["rev-parse", "--verify", tag]);

console.log(`[release] Pushing main and ${tag} to origin...`);
run("git", ["push", "origin", "HEAD:main"]);
run("git", ["push", "origin", `refs/tags/${tag}`]);

console.log(`[release] Triggering ${platform} release workflow for ${tag}...`);
run("gh", [
  "workflow",
  "run",
  "release.yml",
  "--repo",
  repository,
  "--ref",
  "main",
  "-f",
  `version=${version}`,
  "-f",
  `platform=${platform}`,
]);

const runInfo = findLatestRunId(repository, "release.yml");
console.log(`[release] Watching workflow run ${runInfo.databaseId}...`);
run("gh", ["run", "watch", String(runInfo.databaseId), "--repo", repository, "--exit-status"]);

console.log(`[release] Release flow completed: ${runInfo.url}`);
