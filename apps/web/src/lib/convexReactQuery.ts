import type { ConvexStatusResult, EnvironmentId } from "@t3tools/contracts";
import { queryOptions } from "@tanstack/react-query";

import { ensureEnvironmentApi } from "~/environmentApi";

export const convexQueryKeys = {
  all: ["convex"] as const,
  status: (environmentId: EnvironmentId | null, cwd: string | null) =>
    ["convex", "status", environmentId ?? null, cwd] as const,
};

const EMPTY_CONVEX_STATUS: ConvexStatusResult = {
  cwd: "",
  hasPackageJson: false,
  packageManager: null,
  hasConvexDependency: false,
  hasConvexDirectory: false,
  hasEnvLocal: false,
  isConfigured: false,
  installCommand: null,
  devCommand: null,
  deployCommand: null,
};

export function convexStatusQueryOptions(input: {
  environmentId: EnvironmentId | null;
  cwd: string | null;
}) {
  return queryOptions({
    queryKey: convexQueryKeys.status(input.environmentId, input.cwd),
    queryFn: async () => {
      if (!input.cwd || !input.environmentId) {
        throw new Error("Convex status is unavailable.");
      }
      const api = ensureEnvironmentApi(input.environmentId);
      return api.convex.status({ cwd: input.cwd });
    },
    enabled: input.environmentId !== null && input.cwd !== null,
    staleTime: 5_000,
    placeholderData: (previous) => previous ?? EMPTY_CONVEX_STATUS,
  });
}
