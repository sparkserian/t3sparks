import type { ConvexStatusResult } from "@t3sparks/contracts";
import { queryOptions } from "@tanstack/react-query";

import { ensureNativeApi } from "~/nativeApi";

export const convexQueryKeys = {
  all: ["convex"] as const,
  status: (cwd: string | null) => ["convex", "status", cwd] as const,
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

export function convexStatusQueryOptions(cwd: string | null) {
  return queryOptions({
    queryKey: convexQueryKeys.status(cwd),
    queryFn: async () => {
      const api = ensureNativeApi();
      if (!cwd) {
        throw new Error("Convex status is unavailable.");
      }
      return api.convex.status({ cwd });
    },
    enabled: cwd !== null,
    staleTime: 5_000,
    placeholderData: (previous) => previous ?? EMPTY_CONVEX_STATUS,
  });
}
