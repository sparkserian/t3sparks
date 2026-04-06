import type {
  ServerImportSnapshotInput,
  ServerImportSnapshotResult,
} from "@t3sparks/contracts";
import { ServiceMap } from "effect";
import type { Effect } from "effect";

import type { ProjectionRepositoryError } from "../../persistence/Errors.ts";

export interface ProjectionSnapshotImportShape {
  readonly replaceSnapshot: (
    input: ServerImportSnapshotInput,
  ) => Effect.Effect<ServerImportSnapshotResult, ProjectionRepositoryError>;
}

export class ProjectionSnapshotImport extends ServiceMap.Service<
  ProjectionSnapshotImport,
  ProjectionSnapshotImportShape
>()("t3sparks/orchestration/Services/ProjectionSnapshotImport") {}
