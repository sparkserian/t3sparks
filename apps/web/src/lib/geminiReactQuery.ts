import { queryOptions } from "@tanstack/react-query";

import { ensureNativeApi } from "~/nativeApi";

export const geminiQueryKeys = {
  all: ["gemini"] as const,
  status: (cwd: string | null) => ["gemini", "status", cwd] as const,
};

export function geminiStatusQueryOptions(cwd: string | null) {
  return queryOptions({
    queryKey: geminiQueryKeys.status(cwd),
    queryFn: async () => {
      if (!cwd) {
        throw new Error("Gemini status requires a project folder.");
      }
      const api = ensureNativeApi();
      return api.gemini.status({ cwd });
    },
    enabled: Boolean(cwd),
    staleTime: 5_000,
  });
}
