import type { CustomInstruction } from "@t3sparks/contracts";
import { BookTextIcon, PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { useAppSettings } from "~/appSettings";
import {
  normalizeSelectedCustomInstructionIds,
  resolveSelectedCustomInstructions,
  summarizeCustomInstructionBody,
} from "~/customInstructions";
import { cn } from "~/lib/utils";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
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
import { Textarea } from "./ui/textarea";

interface CustomInstructionsControlProps {
  selectedInstructionIds: readonly string[];
  onSelectedInstructionIdsChange: (instructionIds: string[]) => void;
}

function idsEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export default function CustomInstructionsControl({
  selectedInstructionIds,
  onSelectedInstructionIdsChange,
}: CustomInstructionsControlProps) {
  const { settings, updateSettings } = useAppSettings();
  const [open, setOpen] = useState(false);
  const [editingInstructionId, setEditingInstructionId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftBody, setDraftBody] = useState("");

  const instructionLibrary = settings.customInstructions;
  const resolvedSelectedInstructions = useMemo(
    () => resolveSelectedCustomInstructions(instructionLibrary, selectedInstructionIds),
    [instructionLibrary, selectedInstructionIds],
  );
  const resolvedSelectedIds = useMemo(
    () => resolvedSelectedInstructions.map((instruction) => instruction.id),
    [resolvedSelectedInstructions],
  );
  const isEditing = editingInstructionId !== null;
  const canSaveInstruction = draftTitle.trim().length > 0 && draftBody.trim().length > 0;

  useEffect(() => {
    if (idsEqual(resolvedSelectedIds, selectedInstructionIds)) {
      return;
    }
    onSelectedInstructionIdsChange(resolvedSelectedIds);
  }, [onSelectedInstructionIdsChange, resolvedSelectedIds, selectedInstructionIds]);

  useEffect(() => {
    if (!open) {
      return;
    }
    if (instructionLibrary.length === 0) {
      setEditingInstructionId(null);
    }
  }, [instructionLibrary.length, open]);

  const resetEditor = () => {
    setEditingInstructionId(null);
    setDraftTitle("");
    setDraftBody("");
  };

  const startCreate = () => {
    setEditingInstructionId(null);
    setDraftTitle("");
    setDraftBody("");
  };

  const startEdit = (instruction: CustomInstruction) => {
    setEditingInstructionId(instruction.id);
    setDraftTitle(instruction.title);
    setDraftBody(instruction.body);
  };

  const toggleInstruction = (instructionId: string, checked: boolean) => {
    const nextSelectedIds = checked
      ? normalizeSelectedCustomInstructionIds([...selectedInstructionIds, instructionId])
      : normalizeSelectedCustomInstructionIds(
          selectedInstructionIds.filter((candidateId) => candidateId !== instructionId),
        );
    onSelectedInstructionIdsChange(nextSelectedIds);
  };

  const saveInstruction = () => {
    const title = draftTitle.trim();
    const body = draftBody.trim();
    if (title.length === 0 || body.length === 0) {
      return;
    }

    if (editingInstructionId) {
      updateSettings({
        customInstructions: instructionLibrary.map((instruction) =>
          instruction.id === editingInstructionId ? { ...instruction, title, body } : instruction,
        ),
      });
      setEditingInstructionId(editingInstructionId);
    } else {
      updateSettings({
        customInstructions: [
          ...instructionLibrary,
          {
            id: crypto.randomUUID(),
            title,
            body,
          },
        ],
      });
    }

    resetEditor();
  };

  const deleteInstruction = (instructionId: string) => {
    updateSettings({
      customInstructions: instructionLibrary.filter((instruction) => instruction.id !== instructionId),
    });
    onSelectedInstructionIdsChange(
      normalizeSelectedCustomInstructionIds(
        selectedInstructionIds.filter((candidateId) => candidateId !== instructionId),
      ),
    );
    if (editingInstructionId === instructionId) {
      resetEditor();
    }
  };

  return (
    <>
      <Button
        variant="ghost"
        className="shrink-0 whitespace-nowrap px-2 text-muted-foreground/70 hover:text-foreground/80 sm:px-3"
        size="sm"
        type="button"
        onClick={() => setOpen(true)}
        title="Manage reusable custom instructions for this thread"
      >
        <BookTextIcon />
        <span className="sr-only sm:not-sr-only">Instructions</span>
        {resolvedSelectedInstructions.length > 0 ? (
          <Badge variant="secondary" className="ml-1 hidden text-[10px] sm:inline-flex">
            {resolvedSelectedInstructions.length} active
          </Badge>
        ) : null}
      </Button>

      <Dialog
        open={open}
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen);
          if (!nextOpen) {
            resetEditor();
          }
        }}
      >
        <DialogPopup className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Custom instructions</DialogTitle>
            <DialogDescription>
              Save reusable guidance once, then check the instructions you want active for this
              thread before each turn.
            </DialogDescription>
          </DialogHeader>

          <DialogPanel className="space-y-4">
            <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-muted/30 px-4 py-3">
              <div className="min-w-0">
                <div className="text-sm font-medium">Active on this thread</div>
                <div className="text-muted-foreground text-xs">
                  {resolvedSelectedInstructions.length === 0
                    ? "No custom instructions selected."
                    : `${resolvedSelectedInstructions.length} instruction${resolvedSelectedInstructions.length === 1 ? "" : "s"} will be sent with each turn.`}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {resolvedSelectedInstructions.length > 0 ? (
                  <Button
                    type="button"
                    size="xs"
                    variant="outline"
                    onClick={() => onSelectedInstructionIdsChange([])}
                  >
                    Clear selection
                  </Button>
                ) : null}
                <Button type="button" size="xs" onClick={startCreate}>
                  <PlusIcon />
                  Add instruction
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              {instructionLibrary.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border px-4 py-6 text-center">
                  <div className="text-sm font-medium">No saved instructions yet</div>
                  <div className="text-muted-foreground mt-1 text-xs">
                    Add reusable instructions like coding preferences, review rules, or tone
                    constraints.
                  </div>
                </div>
              ) : (
                instructionLibrary.map((instruction) => {
                  const checked = resolvedSelectedIds.includes(instruction.id);
                  return (
                    <div
                      key={instruction.id}
                      className={cn(
                        "flex items-start gap-3 rounded-xl border px-3 py-3 transition-colors",
                        checked ? "border-primary/35 bg-primary/6" : "border-border bg-background",
                      )}
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(nextChecked) =>
                          toggleInstruction(instruction.id, Boolean(nextChecked))
                        }
                        aria-label={`Use instruction ${instruction.title}`}
                        className="mt-0.5"
                      />
                      <button
                        type="button"
                        className="min-w-0 flex-1 text-left"
                        onClick={() => toggleInstruction(instruction.id, !checked)}
                      >
                        <div className="text-sm font-medium">{instruction.title}</div>
                        <div className="text-muted-foreground mt-1 text-xs leading-relaxed">
                          {summarizeCustomInstructionBody(instruction.body)}
                        </div>
                      </button>
                      <div className="flex shrink-0 items-center gap-1">
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="size-8"
                          onClick={() => startEdit(instruction)}
                          title={`Edit ${instruction.title}`}
                        >
                          <PencilIcon />
                        </Button>
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="size-8 text-destructive hover:text-destructive"
                          onClick={() => deleteInstruction(instruction.id)}
                          title={`Delete ${instruction.title}`}
                        >
                          <Trash2Icon />
                        </Button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <div className="space-y-3 rounded-xl border border-border bg-background px-4 py-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-medium">
                    {isEditing ? "Edit instruction" : "New instruction"}
                  </div>
                  <div className="text-muted-foreground text-xs">
                    Keep each instruction focused so you can mix and match them with checkboxes.
                  </div>
                </div>
                {(draftTitle.length > 0 || draftBody.length > 0 || isEditing) && (
                  <Button type="button" size="xs" variant="ghost" onClick={resetEditor}>
                    Reset
                  </Button>
                )}
              </div>

              <div className="space-y-2">
                <label className="text-xs font-medium" htmlFor="custom-instruction-title">
                  Name
                </label>
                <Input
                  id="custom-instruction-title"
                  value={draftTitle}
                  onChange={(event) => setDraftTitle(event.target.value)}
                  placeholder="Example: Review for production readiness"
                />
              </div>

              <div className="space-y-2">
                <label className="text-xs font-medium" htmlFor="custom-instruction-body">
                  Instruction
                </label>
                <Textarea
                  id="custom-instruction-body"
                  value={draftBody}
                  onChange={(event) => setDraftBody(event.target.value)}
                  rows={6}
                  placeholder="Example: Prefer smaller diffs, call out risky assumptions, and avoid changing unrelated files."
                />
              </div>
            </div>
          </DialogPanel>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setOpen(false);
                resetEditor();
              }}
            >
              Close
            </Button>
            <Button type="button" onClick={saveInstruction} disabled={!canSaveInstruction}>
              {isEditing ? "Save changes" : "Save instruction"}
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </>
  );
}
