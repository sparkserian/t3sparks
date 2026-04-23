import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const PLATFORM_CONFIG = {
  "mac-arm64": {
    expectedAssetPatterns: [/\.dmg$/u, /\.zip$/u, /\.blockmap$/u, /^latest-mac\.yml$/u],
    localArgs: [
      "run",
      "scripts/build-desktop-artifact.ts",
      "--platform",
      "mac",
      "--target",
      "dmg",
      "--arch",
      "arm64",
      "--publish",
      "--verbose",
    ],
    supportsLocalPublish: () => process.platform === "darwin" && process.arch === "arm64",
    workflowPlatform: "mac-arm64",
  },
  win: {
    expectedAssetPatterns: [/\.exe$/u, /\.blockmap$/u, /^latest\.yml$/u],
    localArgs: [
      "run",
      "scripts/build-desktop-artifact.ts",
      "--platform",
      "win",
      "--target",
      "nsis",
      "--arch",
      "x64",
      "--publish",
      "--verbose",
    ],
    supportsLocalPublish: () => process.platform === "win32",
    workflowPlatform: "win",
  },
  linux: {
    expectedAssetPatterns: [/\.AppImage$/u, /\.deb$/u, /\.rpm$/u, /^latest-linux\.yml$/u],
    localArgs: [
      "run",
      "scripts/build-desktop-artifact.ts",
      "--platform",
      "linux",
      "--target",
      "AppImage",
      "--arch",
      "x64",
      "--publish",
      "--verbose",
    ],
    supportsLocalPublish: () => process.platform === "linux",
    workflowPlatform: "linux",
  },
};

const VALID_PLATFORMS = new Set(Object.keys(PLATFORM_CONFIG));
const repoRoot = resolve(import.meta.dirname, "..");

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

function resolveRepository() {
  const owner = process.env.GH_RELEASE_OWNER?.trim() || "";
  const repo = process.env.GH_RELEASE_REPO?.trim() || "";
  if (owner && repo) {
    return { owner, repo, slug: `${owner}/${repo}` };
  }

  const slug =
    process.env.T3SPARKS_DESKTOP_UPDATE_REPOSITORY?.trim() ||
    process.env.GITHUB_REPOSITORY?.trim() ||
    "";
  const [fallbackOwner, fallbackRepo, ...rest] = slug.split("/");
  if (!fallbackOwner || !fallbackRepo || rest.length > 0) {
    fail("Set GH_RELEASE_OWNER/GH_RELEASE_REPO or T3SPARKS_DESKTOP_UPDATE_REPOSITORY in .env.local before publishing.");
  }

  return { owner: fallbackOwner, repo: fallbackRepo, slug };
}

function requireGitHubToken() {
  const token =
    process.env.GH_TOKEN?.trim() ||
    process.env.T3SPARKS_DESKTOP_UPDATE_GITHUB_TOKEN?.trim() ||
    "";
  if (!token) {
    fail("Set GH_TOKEN in .env.local before publishing.");
  }
  return token;
}

async function githubRequest(token, path, init = {}) {
  const response = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "User-Agent": "t3-sparks-release-script",
      ...init.headers,
    },
  });

  if (!response.ok) {
    const body = await response.text();
    fail(`GitHub API ${response.status} ${response.statusText}: ${body}`);
  }

  if (response.status === 204) {
    return null;
  }
  return response.json();
}

async function dispatchWorkflow(token, repository, version, platform) {
  await githubRequest(
    token,
    `/repos/${repository.slug}/actions/workflows/release.yml/dispatches`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ref: "main",
        inputs: {
          version,
          platform,
        },
      }),
    },
  );
}

async function findTriggeredRun(token, repository, triggeredAfterUnixMs) {
  const deadline = Date.now() + 90_000;

  while (Date.now() < deadline) {
    const data = await githubRequest(
      token,
      `/repos/${repository.slug}/actions/workflows/release.yml/runs?event=workflow_dispatch&branch=main&per_page=20`,
    );
    const runs = Array.isArray(data?.workflow_runs) ? data.workflow_runs : [];
    const run = runs.find((candidate) => {
      if (typeof candidate?.created_at !== "string" || typeof candidate?.id !== "number") {
        return false;
      }
      const createdAt = Date.parse(candidate.created_at);
      return Number.isFinite(createdAt) && createdAt >= triggeredAfterUnixMs;
    });
    if (run) {
      return run;
    }

    sleep(2_000);
  }

  fail("Could not find the triggered GitHub Actions run.");
}

async function waitForRunCompletion(token, repository, runId) {
  while (true) {
    const run = await githubRequest(token, `/repos/${repository.slug}/actions/runs/${runId}`);
    if (run?.status === "completed") {
      if (run.conclusion !== "success") {
        fail(`GitHub Actions run failed with conclusion '${run.conclusion ?? "unknown"}'. ${run.html_url ?? ""}`.trim());
      }
      return run;
    }
    sleep(5_000);
  }
}

async function verifyReleaseAssets(token, repository, tag, platform) {
  const release = await githubRequest(token, `/repos/${repository.slug}/releases/tags/${tag}`);
  const assets = Array.isArray(release?.assets) ? release.assets : [];
  const assetNames = assets
    .map((asset) => (typeof asset?.name === "string" ? asset.name : ""))
    .filter(Boolean);
  const expectedPatterns = PLATFORM_CONFIG[platform].expectedAssetPatterns;

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

  console.log(`[release] Uploaded assets for ${platform}:`);
  for (const assetName of assetNames.filter((assetName) =>
    expectedPatterns.some((pattern) => pattern.test(assetName)),
  )) {
    console.log(`[release]   - ${assetName}`);
  }
  console.log(`[release] Release page: ${release.html_url}`);
}

function assertLocalTagExists(tag) {
  runCapture("git", ["rev-parse", "--verify", tag]);
}

async function publishLocal(platform, token, repository, tag) {
  console.log(`[release] Publishing ${platform} locally on ${process.platform}/${process.arch}...`);
  run("bun", PLATFORM_CONFIG[platform].localArgs);
  await verifyReleaseAssets(token, repository, tag, platform);
}

async function publishViaActions(platform, token, repository, version, tag) {
  console.log(`[release] ${platform} cannot be published locally from ${process.platform}/${process.arch}. Using GitHub Actions instead...`);
  console.log(`[release] Pushing main and ${tag} to origin...`);
  run("git", ["push", "origin", "HEAD:main"]);
  run("git", ["push", "origin", `refs/tags/${tag}`]);

  console.log(`[release] Triggering ${platform} release workflow for ${tag}...`);
  const triggerStartedAt = Date.now() - 2_000;
  await dispatchWorkflow(token, repository, version, PLATFORM_CONFIG[platform].workflowPlatform);
  const runInfo = await findTriggeredRun(token, repository, triggerStartedAt);
  console.log(`[release] Watching workflow run ${runInfo.id}...`);
  console.log(`[release] Workflow URL: ${runInfo.html_url}`);
  await waitForRunCompletion(token, repository, runInfo.id);
  await verifyReleaseAssets(token, repository, tag, platform);
}

const platform = process.argv[2];

if (!VALID_PLATFORMS.has(platform)) {
  fail("Usage: node scripts/publish-release.mjs <mac-arm64|win|linux>");
}

loadDotEnvLocal();

const packageJson = JSON.parse(readFileSync(resolve(repoRoot, "package.json"), "utf8"));
const version = packageJson.version;
if (typeof version !== "string" || version.length === 0) {
  fail("Root package.json is missing a valid version.");
}

const tag = `v${version}`;
const repository = resolveRepository();
const token = requireGitHubToken();

assertLocalTagExists(tag);

if (PLATFORM_CONFIG[platform].supportsLocalPublish()) {
  await publishLocal(platform, token, repository, tag);
} else {
  await publishViaActions(platform, token, repository, version, tag);
}

console.log("[release] Release flow completed.");
