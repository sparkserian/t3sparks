import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const VALID_PLATFORMS = new Set(["mac-arm64", "win"]);
const EXPECTED_ASSET_PATTERNS = {
  "mac-arm64": [/\.dmg$/u, /\.zip$/u, /\.blockmap$/u, /^latest-mac\.yml$/u],
  win: [/\.exe$/u, /\.blockmap$/u, /^latest\.yml$/u],
};

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

function sleep(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function findTriggeredRun(repo, workflowFile, triggeredAfterUnixMs) {
  const deadline = Date.now() + 60_000;

  while (Date.now() < deadline) {
    const output = runCapture("gh", [
      "run",
      "list",
      "--repo",
      repo,
      "--workflow",
      workflowFile,
      "--limit",
      "20",
      "--json",
      "databaseId,url,createdAt,event,headBranch",
    ]);
    const runs = JSON.parse(output);
    if (Array.isArray(runs)) {
      const run = runs.find((candidate) => {
        if (!candidate?.databaseId || typeof candidate.createdAt !== "string") {
          return false;
        }
        if (candidate.event !== "workflow_dispatch" || candidate.headBranch !== "main") {
          return false;
        }
        const createdAt = Date.parse(candidate.createdAt);
        return Number.isFinite(createdAt) && createdAt >= triggeredAfterUnixMs;
      });
      if (run) {
        return run;
      }
    }

    sleep(2_000);
  }

  fail("Could not find the triggered GitHub Actions run.");
}

function getRelease(repo, tag) {
  const output = runCapture("gh", [
    "release",
    "view",
    tag,
    "--repo",
    repo,
    "--json",
    "url,assets",
  ]);
  return JSON.parse(output);
}

function verifyReleaseAssets(repo, tag, platform) {
  const release = getRelease(repo, tag);
  const assets = Array.isArray(release?.assets) ? release.assets : [];
  const assetNames = assets
    .map((asset) => (typeof asset?.name === "string" ? asset.name : ""))
    .filter(Boolean);
  const expectedPatterns = EXPECTED_ASSET_PATTERNS[platform];

  const missingPatterns = expectedPatterns.filter(
    (pattern) => !assetNames.some((assetName) => pattern.test(assetName)),
  );

  if (missingPatterns.length > 0) {
    fail(
      `GitHub Release ${tag} is missing expected ${platform} assets. Found: ${
        assetNames.length > 0 ? assetNames.join(", ") : "none"
      }`,
    );
  }

  const matchedAssetNames = assetNames.filter((assetName) =>
    expectedPatterns.some((pattern) => pattern.test(assetName)),
  );

  console.log(`[release] Uploaded assets for ${platform}:`);
  for (const assetName of matchedAssetNames) {
    console.log(`[release]   - ${assetName}`);
  }
  console.log(`[release] Release page: ${release.url}`);
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
  process.env.T3SPARKS_DESKTOP_UPDATE_REPOSITORY?.trim() ||
  process.env.GITHUB_REPOSITORY?.trim() ||
  "";

if (!repository) {
  fail("Set T3SPARKS_DESKTOP_UPDATE_REPOSITORY in .env.local before publishing.");
}

runCapture("git", ["rev-parse", "--verify", tag]);

console.log(`[release] Pushing main and ${tag} to origin...`);
run("git", ["push", "origin", "HEAD:main"]);
run("git", ["push", "origin", `refs/tags/${tag}`]);

console.log(`[release] Triggering ${platform} release workflow for ${tag}...`);
const triggerStartedAt = Date.now() - 2_000;
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

const runInfo = findTriggeredRun(repository, "release.yml", triggerStartedAt);
console.log(`[release] Watching workflow run ${runInfo.databaseId}...`);
console.log(`[release] Workflow URL: ${runInfo.url}`);
run("gh", ["run", "watch", String(runInfo.databaseId), "--repo", repository, "--exit-status"]);

verifyReleaseAssets(repository, tag, platform);
console.log(`[release] Release flow completed.`);
