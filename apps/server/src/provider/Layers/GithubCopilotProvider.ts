/**
 * GithubCopilotProviderLive — GitHub Copilot CLI provider snapshot layer.
 *
 * Reports installation / auth status based on settings. At this stage we do
 * not run a process-based binary probe (the full ACP runtime port will
 * replace this with a proper `copilot --version` check and auth
 * introspection); instead we report "ready" when the provider is enabled
 * with a non-empty binary path and "disabled" otherwise.
 *
 * @module GithubCopilotProviderLive
 */
import type {
  GithubCopilotSettings,
  ServerProvider,
  ServerProviderModel,
} from "@t3tools/contracts";
import { Duration, Effect, Equal, Layer, Stream } from "effect";

import { ServerSettingsService } from "../../serverSettings.ts";
import { makeManagedServerProvider } from "../makeManagedServerProvider.ts";
import { buildServerProvider, providerModelsFromSettings } from "../providerSnapshot.ts";
import { GithubCopilotProvider } from "../Services/GithubCopilotProvider.ts";

const PROVIDER = "githubCopilot" as const;
const GITHUB_COPILOT_PRESENTATION = {
  displayName: "GitHub Copilot",
  showInteractionModeToggle: false,
} as const;
const GITHUB_COPILOT_REFRESH_INTERVAL = Duration.seconds(30);
const EMPTY_CAPABILITIES = { optionDescriptors: [] } as const;

function getBuiltInCopilotModels(): ReadonlyArray<ServerProviderModel> {
  return [
    {
      slug: "auto",
      name: "Auto",
      isCustom: false,
      capabilities: EMPTY_CAPABILITIES,
    },
  ];
}

function buildCopilotSnapshot(settings: GithubCopilotSettings): ServerProvider {
  const checkedAt = new Date().toISOString();
  const models = providerModelsFromSettings(
    getBuiltInCopilotModels(),
    PROVIDER,
    settings.customModels,
    EMPTY_CAPABILITIES,
  );

  if (!settings.enabled) {
    return buildServerProvider({
      provider: PROVIDER,
      presentation: GITHUB_COPILOT_PRESENTATION,
      enabled: false,
      checkedAt,
      models,
      probe: {
        installed: false,
        version: null,
        status: "warning",
        auth: { status: "unknown" },
        message: "GitHub Copilot CLI is disabled in settings.",
      },
    });
  }

  const binaryPath = settings.binaryPath.trim() || "copilot";
  return buildServerProvider({
    provider: PROVIDER,
    presentation: GITHUB_COPILOT_PRESENTATION,
    enabled: true,
    checkedAt,
    models,
    probe: {
      installed: true,
      version: null,
      // Ready at the infrastructure level — runtime adapter will fail fast
      // with a clear "not yet ported" error when a session is requested.
      status: "warning",
      auth: { status: "unknown" },
      message:
        binaryPath === "copilot"
          ? "GitHub Copilot CLI runtime adapter is scaffolded but streaming sessions are not yet wired. Install `@github/copilot` globally and wait for the adapter port."
          : `GitHub Copilot CLI configured at ${binaryPath}. Streaming sessions not yet wired.`,
    },
  });
}

export const GithubCopilotProviderLive = Layer.effect(
  GithubCopilotProvider,
  Effect.gen(function* () {
    const serverSettings = yield* ServerSettingsService;

    const checkProvider = serverSettings.getSettings.pipe(
      Effect.map((settings) => buildCopilotSnapshot(settings.providers.githubCopilot)),
    );

    return yield* makeManagedServerProvider<GithubCopilotSettings>({
      getSettings: serverSettings.getSettings.pipe(
        Effect.map((settings) => settings.providers.githubCopilot),
        Effect.orDie,
      ),
      streamSettings: serverSettings.streamChanges.pipe(
        Stream.map((settings) => settings.providers.githubCopilot),
      ),
      haveSettingsChanged: (previous, next) => !Equal.equals(previous, next),
      initialSnapshot: buildCopilotSnapshot,
      checkProvider,
      refreshInterval: GITHUB_COPILOT_REFRESH_INTERVAL,
    });
  }),
);
