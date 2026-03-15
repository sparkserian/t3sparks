import { useEffect, useMemo, useState } from "react";
import { ChevronDownIcon, FileTextIcon, PlusIcon, Trash2Icon, XIcon } from "lucide-react";

import {
  clearProjectNotes,
  createProjectNote,
  deleteProjectNote,
  MAX_PROJECT_NOTE_LENGTH,
  type ProjectNote,
  updateProjectNote,
  useProjectNotes,
} from "../projectNotes";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import {
  Sheet,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetPanel,
  SheetPopup,
  SheetTitle,
} from "./ui/sheet";
import { Textarea } from "./ui/textarea";

function formatSavedAtLabel(savedAt: string | null): string {
  if (!savedAt) {
    return "Saved automatically for this project";
  }

  const date = new Date(savedAt);
  if (Number.isNaN(date.getTime())) {
    return "Saved automatically for this project";
  }

  return `Saved ${date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })}`;
}

function notePreview(content: string): string {
  const normalized = content.trim();
  if (normalized.length === 0) {
    return "No content yet";
  }
  return normalized.split("\n")[0] ?? "No content yet";
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
  const [expandedNoteIds, setExpandedNoteIds] = useState<string[]>([]);

  useEffect(() => {
    if (notes.length === 0) {
      setExpandedNoteIds([]);
      return;
    }

    setExpandedNoteIds((current) =>
      current.filter((noteId) => notes.some((note) => note.id === noteId)),
    );
  }, [notes, projectCwd]);

  const noteCountLabel = useMemo(
    () => `${notes.length} note${notes.length === 1 ? "" : "s"}`,
    [notes.length],
  );

  const createNote = () => {
    const nextNote = createProjectNote(projectCwd, {
      title: `Note ${notes.length + 1}`,
    });
    setExpandedNoteIds((current) =>
      current.includes(nextNote.id) ? current : [...current, nextNote.id],
    );
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetPopup
        backdropClassName="bg-transparent backdrop-blur-none"
        className="bg-card/96 shadow-2xl"
        side="right"
        showCloseButton={false}
        variant="inset"
      >
        <SheetHeader>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 space-y-2">
              <SheetTitle>Project notes</SheetTitle>
              <SheetDescription>
                Keep named notes, feature ideas, and rough plans attached to{" "}
                <strong>{projectName}</strong>.
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
        <SheetPanel className="space-y-4">
          <div className="rounded-2xl border border-border/70 bg-muted/35 p-4">
            <p className="text-sm text-foreground">
              These notes stay with this project and will still be here when you reopen it later.
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              {notes[0] ? formatSavedAtLabel(notes[0].updatedAt) : "Saved automatically for this project"}
            </p>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="text-xs text-muted-foreground">
                <span>{noteCountLabel}</span>
              </div>
              <Button onClick={createNote} size="xs" variant="outline">
                <PlusIcon className="size-3.5" />
                New note
              </Button>
            </div>

            {notes.length === 0 ? (
              <button
                type="button"
                className="flex w-full items-center gap-3 rounded-2xl border border-dashed border-border/70 bg-muted/20 px-4 py-6 text-left transition-colors hover:bg-accent/40"
                onClick={createNote}
              >
                <FileTextIcon className="size-4 shrink-0 text-muted-foreground" />
                <div className="space-y-1">
                  <div className="text-sm font-medium text-foreground">Create your first note</div>
                  <div className="text-xs text-muted-foreground">
                    Start a named note for features, bugs, or launch tasks.
                  </div>
                </div>
              </button>
            ) : null}

            {notes.map((note) => {
              return (
                <ProjectNoteCard
                  key={note.id}
                  expanded={expandedNoteIds.includes(note.id)}
                  note={note}
                  onDelete={() => {
                    deleteProjectNote(projectCwd, note.id);
                    setExpandedNoteIds((current) => current.filter((noteId) => noteId !== note.id));
                  }}
                  onToggle={() => {
                    setExpandedNoteIds((current) =>
                      current.includes(note.id)
                        ? current.filter((noteId) => noteId !== note.id)
                        : [...current, note.id],
                    );
                  }}
                  onUpdate={(changes) => {
                    void updateProjectNote(projectCwd, note.id, changes);
                  }}
                />
              );
            })}
          </div>
        </SheetPanel>
        <SheetFooter variant="bare">
          <Button
            variant="destructive-outline"
            onClick={() => {
              clearProjectNotes(projectCwd);
              setExpandedNoteIds([]);
            }}
          >
            Clear all notes
          </Button>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </SheetFooter>
      </SheetPopup>
    </Sheet>
  );
}

function ProjectNoteCard({
  note,
  expanded,
  onToggle,
  onUpdate,
  onDelete,
}: {
  note: ProjectNote;
  expanded: boolean;
  onToggle: () => void;
  onUpdate: (changes: { title?: string; content?: string }) => void;
  onDelete: () => void;
}) {
  const contentCountLabel = useMemo(
    () => `${note.content.length}/${MAX_PROJECT_NOTE_LENGTH}`,
    [note.content.length],
  );

  return (
    <div className="overflow-hidden rounded-2xl border border-border/70 bg-card/70">
      <div className="flex items-stretch gap-2 border-b border-border/60 px-3 py-3">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-start gap-3 text-left"
          onClick={onToggle}
        >
          <span className="mt-0.5 rounded-md border border-border/70 bg-muted/30 p-1">
            <FileTextIcon className="size-3.5 text-muted-foreground" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-foreground">{note.title}</span>
            <span className="mt-1 block truncate text-xs text-muted-foreground">
              {notePreview(note.content)}
            </span>
          </span>
          <ChevronDownIcon
            className={`mt-1 size-4 shrink-0 text-muted-foreground transition-transform ${
              expanded ? "rotate-180" : ""
            }`}
          />
        </button>
        <Button
          aria-label={`Delete ${note.title}`}
          className="shrink-0 rounded-full"
          onClick={onDelete}
          size="icon-sm"
          variant="ghost"
        >
          <Trash2Icon className="size-4" />
        </Button>
      </div>

      {expanded ? (
        <div className="space-y-3 p-3">
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
              <span>Name</span>
              <span>{formatSavedAtLabel(note.updatedAt)}</span>
            </div>
            <Input
              aria-label="Note title"
              placeholder="Untitled note"
              value={note.title}
              onChange={(event) => {
                onUpdate({ title: event.target.value });
              }}
            />
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
              <span>Body</span>
              <span>{contentCountLabel}</span>
            </div>
            <Textarea
              aria-label="Note content"
              className="min-h-[260px]"
              placeholder="Add details, tasks, or reminders..."
              value={note.content}
              onChange={(event) => {
                onUpdate({ content: event.target.value });
              }}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
