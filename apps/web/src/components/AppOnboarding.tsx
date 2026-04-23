import { FolderKanbanIcon, FolderPlusIcon, GithubIcon, SparklesIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useAppSettings } from "../appSettings";
import { readNativeApi } from "../nativeApi";
import {
  DEFAULT_PROJECT_HOME_DIRECTORY_LABEL,
  joinPathSegments,
  sanitizeProjectDirectoryName,
  splitParentPath,
  subscribeToOnboardingRequests,
} from "../onboarding";
import { isMacPlatform } from "../lib/utils";
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

const ONBOARDING_STEPS = [
  {
    id: "project-home",
    title: "Choose a project home",
    icon: FolderKanbanIcon,
  },
  {
    id: "projects",
    title: "How projects work",
    icon: FolderPlusIcon,
  },
  {
    id: "github",
    title: "GitHub basics",
    icon: GithubIcon,
  },
] as const;

function defaultProjectHomeDraft(existingPath: string): {
  parentPath: string;
  directoryName: string;
} {
  if (existingPath.trim().length > 0) {
    const existing = splitParentPath(existingPath);
    return {
      parentPath: existing.parentPath,
      directoryName: existing.directoryName,
    };
  }

  const defaultDirectoryName = sanitizeProjectDirectoryName(DEFAULT_PROJECT_HOME_DIRECTORY_LABEL);
  if (typeof navigator !== "undefined" && isMacPlatform(navigator.platform)) {
    return {
      parentPath: "~/Downloads",
      directoryName: defaultDirectoryName,
    };
  }

  return {
    parentPath: "",
    directoryName: defaultDirectoryName,
  };
}

export function AppOnboarding() {
  const { settings, updateSettings } = useAppSettings();
  const [open, setOpen] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [parentPath, setParentPath] = useState("");
  const [directoryName, setDirectoryName] = useState("");
  const [isSavingProjectHome, setIsSavingProjectHome] = useState(false);
  const [isOpeningGithubDesktop, setIsOpeningGithubDesktop] = useState(false);
  const [projectHomeError, setProjectHomeError] = useState<string | null>(null);

  const syncDraftFromSettings = useCallback(() => {
    const nextDraft = defaultProjectHomeDraft(settings.projectHomePath);
    setParentPath(nextDraft.parentPath);
    setDirectoryName(nextDraft.directoryName);
    setProjectHomeError(null);
  }, [settings.projectHomePath]);

  useEffect(() => {
    if (!settings.hasSeenOnboarding) {
      syncDraftFromSettings();
      setStepIndex(0);
      setOpen(true);
    }
  }, [settings.hasSeenOnboarding, syncDraftFromSettings]);

  useEffect(() => {
    return subscribeToOnboardingRequests(() => {
      syncDraftFromSettings();
      setStepIndex(0);
      setOpen(true);
    });
  }, [syncDraftFromSettings]);

  const closeOnboarding = useCallback(() => {
    updateSettings({ hasSeenOnboarding: true });
    setOpen(false);
  }, [updateSettings]);

  const previewPath = useMemo(
    () => joinPathSegments(parentPath, directoryName),
    [directoryName, parentPath],
  );
  const isProjectHomeConfigured = settings.projectHomePath.trim().length > 0;
  const isLastStep = stepIndex === ONBOARDING_STEPS.length - 1;
  const parentPathPlaceholder =
    typeof navigator !== "undefined" && isMacPlatform(navigator.platform)
      ? "~/Downloads"
      : "C:\\Users\\YourName\\Projects";

  const handleBrowseForParentFolder = useCallback(async () => {
    const api = readNativeApi();
    if (!api) {
      return;
    }
    try {
      const pickedPath = await api.dialogs.pickFolder();
      if (pickedPath) {
        setParentPath(pickedPath);
        setProjectHomeError(null);
      }
    } catch {
      // Ignore picker failures so the guide stays usable.
    }
  }, []);

  const handleSaveProjectHome = useCallback(async () => {
    const api = readNativeApi();
    if (!api) {
      return;
    }

    if (parentPath.trim().length === 0) {
      setProjectHomeError("Choose where your project folders should live.");
      return;
    }

    if (directoryName.trim().length === 0) {
      setProjectHomeError("Give the main project folder a name.");
      return;
    }

    setProjectHomeError(null);
    setIsSavingProjectHome(true);
    try {
      const result = await api.projects.createDirectory({
        parentPath,
        directoryName,
      });
      updateSettings({
        projectHomePath: result.path,
        hasSeenOnboarding: true,
      });
      toastManager.add({
        type: "success",
        title: result.created ? "Project home created" : "Project home saved",
        description: result.path,
      });
      setStepIndex(1);
    } catch (error) {
      setProjectHomeError(error instanceof Error ? error.message : "Unable to save project home.");
    } finally {
      setIsSavingProjectHome(false);
    }
  }, [directoryName, parentPath, updateSettings]);

  const handleOpenGithubDesktop = useCallback(async () => {
    const api = readNativeApi();
    if (!api) {
      return;
    }
    setIsOpeningGithubDesktop(true);
    try {
      await api.shell.openExternal("https://desktop.github.com/");
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Unable to open GitHub Desktop",
        description: error instanceof Error ? error.message : "An error occurred.",
      });
    } finally {
      setIsOpeningGithubDesktop(false);
    }
  }, []);

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => (!nextOpen ? closeOnboarding() : setOpen(true))}>
      <DialogPopup className="max-w-3xl overflow-hidden bg-card/96 shadow-2xl" showCloseButton>
        <DialogHeader className="border-b border-border/70 pb-4">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-2">
              <div className="inline-flex items-center gap-2 rounded-full border border-border bg-muted/60 px-3 py-1 text-[11px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
                <SparklesIcon className="size-3.5" />
                Quick Setup
              </div>
              <DialogTitle>Set up T3 Sparks for your first projects</DialogTitle>
              <DialogDescription className="max-w-2xl leading-relaxed">
                Pick one main folder for your work, learn how project folders behave inside the app,
                and get a simple GitHub workflow you can replay later.
              </DialogDescription>
            </div>
            {isProjectHomeConfigured ? (
              <div className="hidden rounded-2xl border border-emerald-400/40 bg-emerald-500/8 px-3 py-2 text-right text-xs text-emerald-950/85 sm:block dark:text-emerald-100/85">
                <div className="font-medium">Current project home</div>
                <div className="mt-1 max-w-72 break-all text-[11px] text-muted-foreground">
                  {settings.projectHomePath}
                </div>
              </div>
            ) : null}
          </div>
        </DialogHeader>

        <DialogPanel className="grid gap-5 lg:grid-cols-[190px_minmax(0,1fr)]">
          <aside className="space-y-2">
            {ONBOARDING_STEPS.map((step, index) => {
              const Icon = step.icon;
              const selected = index === stepIndex;
              const completed = index < stepIndex || (index === 0 && isProjectHomeConfigured);
              return (
                <button
                  key={step.id}
                  type="button"
                  className={`flex w-full items-center gap-3 rounded-2xl border px-3 py-3 text-left transition-colors ${
                    selected
                      ? "border-primary/50 bg-primary/8 text-foreground"
                      : completed
                        ? "border-emerald-400/35 bg-emerald-500/6 text-foreground"
                        : "border-border bg-background text-muted-foreground hover:bg-accent"
                  }`}
                  onClick={() => setStepIndex(index)}
                >
                  <span
                    className={`flex size-9 shrink-0 items-center justify-center rounded-xl ${
                      selected
                        ? "bg-primary/12 text-primary"
                        : completed
                          ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                          : "bg-secondary text-muted-foreground"
                    }`}
                  >
                    <Icon className="size-4" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground/80">
                      Step {index + 1}
                    </span>
                    <span className="mt-0.5 block text-sm font-medium">{step.title}</span>
                  </span>
                </button>
              );
            })}
          </aside>

          <div className="min-w-0">
            {stepIndex === 0 ? (
              <section className="space-y-5">
                <div className="space-y-2">
                  <h2 className="text-lg font-semibold text-foreground">Choose one home for all your projects</h2>
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    Think of this as your main shelf. Every new project you create in T3 Sparks can
                    get its own folder inside it, and you can change the location later if you want.
                  </p>
                </div>

                <div className="rounded-2xl border border-border bg-muted/35 p-4">
                  <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground/70">
                    Example
                  </p>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Pick <span className="font-medium text-foreground">Downloads</span> as the
                    place, type <span className="font-medium text-foreground">My Projects</span>{" "}
                    as the folder name, and T3 Sparks will save a folder like:
                  </p>
                  <code className="mt-3 block rounded-xl border border-border/70 bg-background px-3 py-2 text-xs text-foreground">
                    {previewPath || joinPathSegments(parentPathPlaceholder, "my-projects")}
                  </code>
                </div>

                <label className="block space-y-2">
                  <span className="text-xs font-medium text-foreground">Where should the main folder live?</span>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Input
                      value={parentPath}
                      onChange={(event) => setParentPath(event.target.value)}
                      placeholder={parentPathPlaceholder}
                    />
                    <Button variant="outline" onClick={() => void handleBrowseForParentFolder()}>
                      Browse
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Use Browse in the desktop app for a native picker. In browser preview, the same
                    button opens a path prompt because browsers do not expose full folder paths.
                  </p>
                </label>

                <label className="block space-y-2">
                  <span className="text-xs font-medium text-foreground">What should the main folder be called?</span>
                  <Input
                    value={directoryName}
                    onChange={(event) => setDirectoryName(event.target.value)}
                    placeholder={DEFAULT_PROJECT_HOME_DIRECTORY_LABEL}
                  />
                </label>

                <div className="rounded-2xl border border-border bg-background p-4">
                  <div className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground/70">
                    Saved location preview
                  </div>
                  <code className="mt-2 block break-all text-xs text-foreground">
                    {previewPath || "Choose a parent folder and a folder name."}
                  </code>
                </div>

                {projectHomeError ? (
                  <div className="rounded-xl border border-destructive/35 bg-destructive/8 px-3 py-2 text-sm text-destructive">
                    {projectHomeError}
                  </div>
                ) : null}
              </section>
            ) : null}

            {stepIndex === 1 ? (
              <section className="space-y-5">
                <div className="space-y-2">
                  <h2 className="text-lg font-semibold text-foreground">
                    How folders work in T3 Sparks
                  </h2>
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    T3 Sparks works directly in real folders on your computer. When the agent edits a
                    file, that file is saved in the project folder itself.
                  </p>
                </div>

                <div className="grid gap-3 md:grid-cols-3">
                  <div className="rounded-2xl border border-border bg-background p-4">
                    <div className="text-sm font-medium text-foreground">New project</div>
                    <p className="mt-2 text-sm text-muted-foreground">
                      Creates a new folder inside your saved project home so you can start from a
                      clean workspace.
                    </p>
                  </div>
                  <div className="rounded-2xl border border-border bg-background p-4">
                    <div className="text-sm font-medium text-foreground">Add project</div>
                    <p className="mt-2 text-sm text-muted-foreground">
                      Opens an existing folder you already have somewhere else on your computer.
                    </p>
                  </div>
                  <div className="rounded-2xl border border-border bg-background p-4">
                    <div className="text-sm font-medium text-foreground">Change later</div>
                    <p className="mt-2 text-sm text-muted-foreground">
                      You can replay this guide any time from the sidebar or settings if you want a
                      different project home.
                    </p>
                  </div>
                </div>

                <div className="rounded-2xl border border-sky-300/35 bg-sky-500/7 p-4">
                  <p className="text-sm text-muted-foreground">
                    Recommended beginner workflow: keep one folder per app or website, open that
                    folder in T3 Sparks, and let Git track the files inside it.
                  </p>
                </div>
              </section>
            ) : null}

            {stepIndex === 2 ? (
              <section className="space-y-5">
                <div className="space-y-2">
                  <h2 className="text-lg font-semibold text-foreground">A simple GitHub workflow</h2>
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    You do not have to use GitHub on day one, but it is the safest way to back up
                    work and share it later.
                  </p>
                </div>

                <div className="rounded-2xl border border-border bg-background p-4">
                  <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground/70">
                    Beginner version
                  </p>
                  <ol className="mt-3 space-y-2 text-sm text-muted-foreground">
                    <li>1. Create or open one project folder inside your main project-home folder.</li>
                    <li>2. Do your work in T3 Sparks. The files stay in that folder.</li>
                    <li>3. When you are ready, open that same folder in GitHub Desktop.</li>
                    <li>4. Publish it to GitHub so you have a backup and a remote repo.</li>
                  </ol>
                </div>

                <div className="rounded-2xl border border-border bg-muted/35 p-4">
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    {typeof navigator !== "undefined" && isMacPlatform(navigator.platform)
                      ? "On Mac, GitHub Desktop is usually the easiest way to create a repo and publish it without learning terminal Git commands first."
                      : "GitHub Desktop is an easy option if you want a visual Git workflow instead of terminal commands."}
                  </p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      onClick={() => void handleOpenGithubDesktop()}
                      disabled={isOpeningGithubDesktop}
                    >
                      {isOpeningGithubDesktop ? "Opening..." : "Get GitHub Desktop"}
                    </Button>
                    <Button variant="ghost" onClick={() => setStepIndex(0)}>
                      Restart guide
                    </Button>
                  </div>
                </div>
              </section>
            ) : null}
          </div>
        </DialogPanel>

        <DialogFooter>
          <Button variant="ghost" onClick={closeOnboarding}>
            {isProjectHomeConfigured ? "Close" : "Skip for now"}
          </Button>
          {stepIndex > 0 ? (
            <Button variant="outline" onClick={() => setStepIndex((current) => current - 1)}>
              Back
            </Button>
          ) : null}
          {stepIndex === 0 ? (
            <Button onClick={() => void handleSaveProjectHome()} disabled={isSavingProjectHome}>
              {isSavingProjectHome ? "Saving..." : "Save project home"}
            </Button>
          ) : null}
          {stepIndex > 0 && !isLastStep ? (
            <Button onClick={() => setStepIndex((current) => current + 1)}>Next</Button>
          ) : null}
          {stepIndex === 2 ? <Button onClick={closeOnboarding}>Finish</Button> : null}
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
