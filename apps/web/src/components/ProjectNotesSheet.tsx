import { useEffect, useMemo, useState } from "react";
import { FileTextIcon, PlusIcon, SearchIcon, Trash2Icon, XIcon } from "lucide-react";

import {
  clearProjectNotes,
  createProjectNote,
  deleteProjectNote,
  MAX_PROJECT_NOTE_LENGTH,
  MAX_PROJECT_NOTE_TITLE_LENGTH,
  type ProjectNote,
  updateProjectNote,
  useProjectNotes,
} from "../projectNotes";
import { cn } from "~/lib/utils";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { ScrollArea } from "./ui/scroll-area";
import {
  Sheet,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetPopup,
  SheetTitle,
} from "./ui/sheet";
import { Textarea } from "./ui/textarea";

interface NoteDraft {
  id: string | null;
  title: string;
  content: string;
  savedTitle: string;
  savedContent: string;
  isNew: boolean;
}

function formatSavedAtLabel(savedAt: string | null): string {
  if (!savedAt) {
    return "Not saved yet";
  }

  const date = new Date(savedAt);
  if (Number.isNaN(date.getTime())) {
    return "Saved recently";
  }

  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function notePreview(content: string): string {
  const normalized = content.trim();
  if (normalized.length === 0) {
    return "No content yet";
  }
  return normalized.split("\n")[0] ?? "No content yet";
}

function createDraftFromNote(note: ProjectNote): NoteDraft {
  return {
    id: note.id,
    title: note.title,
    content: note.content,
    savedTitle: note.title,
    savedContent: note.content,
    isNew: false,
  };
}

function createEmptyDraft(): NoteDraft {
  return {
    id: null,
    title: "",
    content: "",
    savedTitle: "",
    savedContent: "",
    isNew: true,
  };
}

function isDraftDirty(draft: NoteDraft | null): boolean {
  if (!draft) {
    return false;
  }
  return draft.title !== draft.savedTitle || draft.content !== draft.savedContent;
}

interface ProjectNotesSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectName: string;
  projectCwd: string;
}

export default function ProjectNotesSheet({
  open,
  onOpenChange,
  projectName,
  projectCwd,
}: ProjectNotesSheetProps) {
  const notes = useProjectNotes(projectCwd);
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [draft, setDraft] = useState<NoteDraft | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    setSelectedNoteId(null);
    setDraft(null);
    setSearchQuery("");
  }, [projectCwd]);

  useEffect(() => {
    if (selectedNoteId && !notes.some((note) => note.id === selectedNoteId)) {
      setSelectedNoteId(null);
    }
    if (draft && !draft.isNew && !notes.some((note) => note.id === draft.id)) {
      setDraft(null);
    }
  }, [draft, notes, selectedNoteId]);

  const filteredNotes = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();
    if (normalizedQuery.length === 0) {
      return notes;
    }
    return notes.filter((note) => {
      const haystack = `${note.title}\n${note.content}`.toLowerCase();
      return haystack.includes(normalizedQuery);
    });
  }, [notes, searchQuery]);

  const activeNote = useMemo(
    () =>
      draft?.isNew
        ? null
        : notes.find((note) => note.id === (draft?.id ?? selectedNoteId)) ?? null,
    [draft, notes, selectedNoteId],
  );

  const draftDirty = isDraftDirty(draft);
  const canSaveDraft =
    !!draft &&
    draftDirty &&
    (draft.title.trim().length > 0 || draft.content.trim().length > 0);
  const noteCountLabel = `${notes.length} note${notes.length === 1 ? "" : "s"}`;

  const confirmDiscardDraft = (): boolean => {
    if (!draftDirty) {
      return true;
    }
    return window.confirm("Discard your unsaved note changes?");
  };

  const selectNote = (note: ProjectNote) => {
    if (!confirmDiscardDraft()) {
      return;
    }
    setSelectedNoteId(note.id);
    setDraft(createDraftFromNote(note));
  };

  const startNewNote = () => {
    if (!confirmDiscardDraft()) {
      return;
    }
    setSelectedNoteId(null);
    setDraft(createEmptyDraft());
  };

  const resetDraft = () => {
    if (!draft) {
      return;
    }
    if (draft.isNew) {
      setDraft(null);
      return;
    }
    const sourceNote = notes.find((note) => note.id === draft.id);
    setDraft(sourceNote ? createDraftFromNote(sourceNote) : null);
  };

  const saveDraft = () => {
    if (!draft || !canSaveDraft) {
      return;
    }

    if (draft.isNew) {
      const created = createProjectNote(projectCwd, {
        title: draft.title,
        content: draft.content,
      });
      setSelectedNoteId(created.id);
      setDraft(createDraftFromNote(created));
      return;
    }

    if (!draft.id) {
      return;
    }

    const updated = updateProjectNote(projectCwd, draft.id, {
      title: draft.title,
      content: draft.content,
    });
    if (!updated) {
      return;
    }
    setSelectedNoteId(updated.id);
    setDraft(createDraftFromNote(updated));
  };

  const deleteDraftNote = () => {
    const noteId = draft?.isNew ? null : draft?.id ?? selectedNoteId;
    if (!noteId) {
      return;
    }
    const note = notes.find((entry) => entry.id === noteId);
    if (!note) {
      return;
    }
    if (!window.confirm(`Delete "${note.title}"?`)) {
      return;
    }
    deleteProjectNote(projectCwd, noteId);
    setSelectedNoteId(null);
    setDraft(null);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetPopup
        backdropClassName="bg-transparent backdrop-blur-none"
        className="bg-card/96 shadow-2xl sm:max-w-5xl"
        side="right"
        showCloseButton={false}
        variant="inset"
      >
        <SheetHeader>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 space-y-2">
              <SheetTitle>Project notes</SheetTitle>
              <SheetDescription>
                Capture durable notes, tasks, and ideas for <strong>{projectName}</strong> without
                burying them in a single collapsed block.
              </SheetDescription>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="shrink-0">
                {projectName}
              </Badge>
              <Button
                aria-label="Close notes"
                className="shrink-0 rounded-full"
                onClick={() => onOpenChange(false)}
                size="icon"
                variant="ghost"
              >
                <XIcon className="size-4" />
              </Button>
            </div>
          </div>
        </SheetHeader>

        <div className="min-h-0 flex-1 px-6 pb-4">
          <div className="grid h-full min-h-0 gap-4 lg:grid-cols-[20rem_minmax(0,1fr)]">
            <section className="flex min-h-0 flex-col overflow-hidden rounded-3xl border border-border/70 bg-muted/20">
              <div className="space-y-3 border-b border-border/60 px-4 py-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="space-y-1">
                    <div className="text-sm font-medium text-foreground">Saved notes</div>
                    <div className="text-xs text-muted-foreground">{noteCountLabel}</div>
                  </div>
                  <Button onClick={startNewNote} size="xs" variant="outline">
                    <PlusIcon className="size-3.5" />
                    New note
                  </Button>
                </div>
                <div className="relative">
                  <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    aria-label="Search project notes"
                    className="pl-9"
                    placeholder="Search notes"
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                  />
                </div>
              </div>

              <ScrollArea className="min-h-0 flex-1" scrollFade scrollbarGutter>
                <div className="space-y-2 p-3">
                  {filteredNotes.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-border/70 bg-background/60 px-4 py-8 text-center">
                      <div className="mx-auto mb-3 flex size-10 items-center justify-center rounded-2xl border border-border/60 bg-muted/40">
                        <FileTextIcon className="size-4 text-muted-foreground" />
                      </div>
                      <div className="text-sm font-medium text-foreground">
                        {notes.length === 0 ? "No notes yet" : "No notes match this search"}
                      </div>
                      <div className="mt-2 text-xs text-muted-foreground">
                        {notes.length === 0
                          ? "Create saved notes for bugs, plans, and loose context."
                          : "Try a different search term or open another note."}
                      </div>
                    </div>
                  ) : null}

                  {filteredNotes.map((note) => {
                    const isActive = selectedNoteId === note.id && !draft?.isNew;
                    return (
                      <button
                        key={note.id}
                        type="button"
                        className={cn(
                          "flex w-full flex-col gap-2 rounded-2xl border px-4 py-3 text-left transition-colors",
                          isActive
                            ? "border-foreground/20 bg-background text-foreground shadow-sm"
                            : "border-border/60 bg-background/65 hover:bg-accent/40",
                        )}
                        onClick={() => selectNote(note)}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-medium text-foreground">
                              {note.title}
                            </div>
                            <div className="mt-1 text-xs text-muted-foreground">
                              {formatSavedAtLabel(note.updatedAt)}
                            </div>
                          </div>
                          {isActive ? (
                            <Badge variant="outline" className="shrink-0">
                              Open
                            </Badge>
                          ) : null}
                        </div>
                        <div className="line-clamp-2 text-xs leading-5 text-muted-foreground">
                          {notePreview(note.content)}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </ScrollArea>
            </section>

            <section className="flex min-h-0 flex-col overflow-hidden rounded-3xl border border-border/70 bg-background/75">
              {draft ? (
                <>
                  <div className="flex items-center justify-between gap-3 border-b border-border/60 px-5 py-4">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <div className="text-sm font-medium text-foreground">
                          {draft.isNew ? "New note" : activeNote?.title ?? "Edit note"}
                        </div>
                        {draft.isNew ? <Badge variant="outline">Draft</Badge> : null}
                        {draftDirty ? <Badge variant="outline">Unsaved</Badge> : null}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {draft.isNew
                          ? "Create and save this note when you're ready."
                          : `Last saved ${formatSavedAtLabel(activeNote?.updatedAt ?? null)}`}
                      </div>
                    </div>
                    {!draft.isNew ? (
                      <Button
                        aria-label="Delete note"
                        className="rounded-full"
                        onClick={deleteDraftNote}
                        size="icon-sm"
                        variant="ghost"
                      >
                        <Trash2Icon className="size-4" />
                      </Button>
                    ) : null}
                  </div>

                  <div className="flex min-h-0 flex-1 flex-col gap-4 p-5">
                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                        <span>Name</span>
                        <span>{draft.title.length}/{MAX_PROJECT_NOTE_TITLE_LENGTH}</span>
                      </div>
                      <Input
                        aria-label="Note title"
                        maxLength={MAX_PROJECT_NOTE_TITLE_LENGTH}
                        placeholder="Name this note"
                        value={draft.title}
                        onChange={(event) =>
                          setDraft((current) =>
                            current
                              ? {
                                  ...current,
                                  title: event.target.value,
                                }
                              : current,
                          )
                        }
                      />
                    </div>

                    <div className="flex min-h-0 flex-1 flex-col gap-2">
                      <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                        <span>Body</span>
                        <span>{draft.content.length}/{MAX_PROJECT_NOTE_LENGTH}</span>
                      </div>
                      <Textarea
                        aria-label="Note content"
                        className="min-h-[18rem] flex-1 resize-none"
                        maxLength={MAX_PROJECT_NOTE_LENGTH}
                        placeholder="Write context, tasks, implementation notes, or future ideas..."
                        value={draft.content}
                        onChange={(event) =>
                          setDraft((current) =>
                            current
                              ? {
                                  ...current,
                                  content: event.target.value,
                                }
                              : current,
                          )
                        }
                      />
                    </div>
                  </div>
                </>
              ) : (
                <div className="flex flex-1 flex-col items-center justify-center gap-4 px-8 text-center">
                  <div className="flex size-12 items-center justify-center rounded-2xl border border-border/70 bg-muted/35">
                    <FileTextIcon className="size-5 text-muted-foreground" />
                  </div>
                  <div className="space-y-2">
                    <div className="text-base font-medium text-foreground">
                      Choose a saved note or start a new one
                    </div>
                    <div className="max-w-md text-sm leading-6 text-muted-foreground">
                      Notes stay attached to this project, but each one is now saved and managed on
                      its own instead of living in one collapsing stack.
                    </div>
                  </div>
                  <Button onClick={startNewNote}>
                    <PlusIcon className="size-4" />
                    New note
                  </Button>
                </div>
              )}
            </section>
          </div>
        </div>

        <SheetFooter variant="bare" className="items-center justify-between">
          <div className="text-xs text-muted-foreground">
            {draft
              ? draftDirty
                ? "This note has unsaved edits."
                : "All note changes are saved."
              : "Open a note to edit it."}
          </div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center">
            <Button
              variant="destructive-outline"
              onClick={() => {
                if (!notes.length) {
                  return;
                }
                if (!window.confirm("Delete every saved note for this project?")) {
                  return;
                }
                clearProjectNotes(projectCwd);
                setSelectedNoteId(null);
                setDraft(null);
              }}
            >
              Clear all notes
            </Button>
            {draft ? (
              <Button variant="outline" onClick={resetDraft}>
                {draft.isNew ? "Discard draft" : "Revert changes"}
              </Button>
            ) : null}
            {draft ? (
              <Button onClick={saveDraft} disabled={!canSaveDraft}>
                {draft.isNew ? "Save note" : "Save changes"}
              </Button>
            ) : null}
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Done
            </Button>
          </div>
        </SheetFooter>
      </SheetPopup>
    </Sheet>
  );
}
