import { spawnSync } from "node:child_process";

const shouldSkipPatch =
  process.env.CI === "true" ||
  process.env.GITHUB_ACTIONS === "true" ||
  process.env.EFFECT_LANGUAGE_SERVICE_SKIP_PATCH === "1";

if (shouldSkipPatch) {
  console.log("[prepare] Skipping effect-language-service patch in CI.");
  process.exit(0);
}

const command = process.platform === "win32" ? "effect-language-service.cmd" : "effect-language-service";
const result = spawnSync(command, ["patch"], {
  stdio: "inherit",
  env: process.env,
});

if (result.error) {
  console.error("[prepare] Failed to run effect-language-service patch:", result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
