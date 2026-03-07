import { useEffect, useMemo, useState } from "react";

import { readNativeApi } from "../nativeApi";
import { joinPathSegments, suggestProjectDirectoryName } from "../onboarding";
import { toastManager } from "./ui/toast";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";

interface NewProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectHomePath: string;
  onProjectCreated: (projectPath: string, title: string) => Promise<void>;
}

export function NewProjectDialog({
  open,
  onOpenChange,
  projectHomePath,
  onProjectCreated,
}: NewProjectDialogProps) {
  const [projectName, setProjectName] = useState("");
  const [folderName, setFolderName] = useState("");
  const [folderNameDirty, setFolderNameDirty] = useState(false);
  const [isCreatingProject, setIsCreatingProject] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setProjectName("");
      setFolderName("");
      setFolderNameDirty(false);
      setIsCreatingProject(false);
      setError(null);
    }
  }, [open]);

  useEffect(() => {
    if (folderNameDirty) {
      return;
    }
    setFolderName(suggestProjectDirectoryName(projectName));
  }, [folderNameDirty, projectName]);

  const previewPath = useMemo(
    () => joinPathSegments(projectHomePath, folderName),
    [folderName, projectHomePath],
  );

  const handleCreateProject = async () => {
    const api = readNativeApi();
    if (!api) {
      return;
    }

    const trimmedProjectName = projectName.trim();
    const trimmedFolderName = folderName.trim();
    if (trimmedProjectName.length === 0) {
      setError("Give the project a name.");
      return;
    }
    if (trimmedFolderName.length === 0) {
      setError("Give the project folder a name.");
      return;
    }

    setError(null);
    setIsCreatingProject(true);
    try {
      const result = await api.projects.createDirectory({
        parentPath: projectHomePath,
        directoryName: trimmedFolderName,
      });
      await onProjectCreated(result.path, trimmedProjectName);
      toastManager.add({
        type: "success",
        title: result.created ? "Project created" : "Project folder reused",
        description: result.path,
      });
      onOpenChange(false);
    } catch (creationError) {
      setError(
        creationError instanceof Error ? creationError.message : "Unable to create the project.",
      );
    } finally {
      setIsCreatingProject(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Create a new project folder</DialogTitle>
          <DialogDescription>
            This creates a real folder inside your saved project home and opens it in T3 Sparks.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-4">
          <label className="block space-y-2">
            <span className="text-xs font-medium text-foreground">Project name</span>
            <Input
              value={projectName}
              onChange={(event) => setProjectName(event.target.value)}
              placeholder="Marketing site"
            />
          </label>

          <label className="block space-y-2">
            <span className="text-xs font-medium text-foreground">Folder name</span>
            <Input
              value={folderName}
              onChange={(event) => {
                setFolderNameDirty(true);
                setFolderName(event.target.value);
              }}
              placeholder="marketing-site"
            />
            <p className="text-xs text-muted-foreground">
              T3 Sparks will create this folder inside <code>{projectHomePath}</code>.
            </p>
          </label>

          <div className="rounded-2xl border border-border bg-muted/35 p-4">
            <div className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground/70">
              Folder preview
            </div>
            <code className="mt-2 block break-all text-xs text-foreground">
              {previewPath || "Enter a project name to see the folder path."}
            </code>
          </div>

          {error ? (
            <div className="rounded-xl border border-destructive/35 bg-destructive/8 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          ) : null}
        </DialogPanel>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void handleCreateProject()} disabled={isCreatingProject}>
            {isCreatingProject ? "Creating..." : "Create project"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
