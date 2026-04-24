import { Context } from "effect";

import type { ProviderAdapterError } from "../Errors.ts";
import type { ProviderAdapterShape } from "./ProviderAdapter.ts";

export interface GithubCopilotAdapterShape extends ProviderAdapterShape<ProviderAdapterError> {
  readonly provider: "githubCopilot";
}

export class GithubCopilotAdapter extends Context.Service<
  GithubCopilotAdapter,
  GithubCopilotAdapterShape
>()("t3/provider/Services/GithubCopilotAdapter") {}
