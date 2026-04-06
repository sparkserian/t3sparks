import type {
  OrchestrationReadModel,
  ProjectId,
  ProviderKind,
  ServerPathCheck,
  ServerProviderStatus,
} from "@t3sparks/contracts";
import { inferProviderForModel } from "@t3sparks/shared/model";

export interface SyncProjectBindingNeed {
  readonly projectId: ProjectId;
  readonly title: string;
  readonly workspaceRoot: string;
  readonly existsLocally: boolean;
  readonly boundWorkspaceRoot: string | null;
}

export function inferProvidersRequiredBySnapshot(
  snapshot: OrchestrationReadModel | null | undefined,
): ReadonlyArray<ProviderKind> {
  if (!snapshot) {
    return [];
  }

  const requiredProviders = new Set<ProviderKind>();
  for (const thread of snapshot.threads) {
    const sessionProvider = thread.session?.providerName;
    if (sessionProvider === "codex" || sessionProvider === "claudeAgent" || sessionProvider === "gemini" || sessionProvider === "githubCopilot") {
      requiredProviders.add(sessionProvider);
      continue;
    }

    const inferredProvider = inferProviderForModel(thread.model);
    if (inferredProvider) {
      requiredProviders.add(inferredProvider);
    }
  }

  return [...requiredProviders];
}

export function findMissingProviderStatuses(
  requiredProviders: ReadonlyArray<ProviderKind>,
  providerStatuses: ReadonlyArray<ServerProviderStatus>,
): ReadonlyArray<ServerProviderStatus> {
  const statusByProvider = new Map(providerStatuses.map((status) => [status.provider, status] as const));
  return requiredProviders.flatMap((provider) => {
    const status = statusByProvider.get(provider);
    return status && status.available && status.authStatus === "authenticated" ? [] : status ? [status] : [];
  });
}

export function findProjectsNeedingBindings(input: {
  snapshot: OrchestrationReadModel | null | undefined;
  pathChecks: ReadonlyArray<ServerPathCheck>;
  bindingsByProjectId: Partial<Record<ProjectId, string>>;
}): ReadonlyArray<SyncProjectBindingNeed> {
  if (!input.snapshot) {
    return [];
  }

  const pathCheckByPath = new Map(input.pathChecks.map((entry) => [entry.path, entry] as const));
  return input.snapshot.projects
    .map((project) => {
      const boundWorkspaceRoot = input.bindingsByProjectId[project.id] ?? null;
      const targetPath = boundWorkspaceRoot ?? project.workspaceRoot;
      const pathCheck = pathCheckByPath.get(targetPath);
      return {
        projectId: project.id,
        title: project.title,
        workspaceRoot: project.workspaceRoot,
        boundWorkspaceRoot,
        existsLocally: Boolean(pathCheck?.exists && pathCheck.isDirectory),
      } satisfies SyncProjectBindingNeed;
    })
    .filter((project) => !project.existsLocally);
}
