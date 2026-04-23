import type { CustomInstruction } from "@t3sparks/contracts";
import {
  CUSTOM_INSTRUCTION_BODY_MAX_CHARS,
  CUSTOM_INSTRUCTION_ID_MAX_CHARS,
  CUSTOM_INSTRUCTION_MAX_COUNT,
  CUSTOM_INSTRUCTION_TITLE_MAX_CHARS,
} from "@t3sparks/contracts";

function trimToNull(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > maxLength) {
    return null;
  }
  return trimmed;
}

export function normalizeCustomInstructions(
  instructions: Iterable<unknown>,
): CustomInstruction[] {
  const normalized: CustomInstruction[] = [];
  const seenIds = new Set<string>();

  for (const candidate of instructions) {
    if (!candidate || typeof candidate !== "object") {
      continue;
    }
    const instruction = candidate as Record<string, unknown>;
    const id = trimToNull(instruction.id, CUSTOM_INSTRUCTION_ID_MAX_CHARS);
    const title = trimToNull(instruction.title, CUSTOM_INSTRUCTION_TITLE_MAX_CHARS);
    const body = trimToNull(instruction.body, CUSTOM_INSTRUCTION_BODY_MAX_CHARS);
    if (!id || !title || !body || seenIds.has(id)) {
      continue;
    }
    seenIds.add(id);
    normalized.push({ id, title, body });
    if (normalized.length >= CUSTOM_INSTRUCTION_MAX_COUNT) {
      break;
    }
  }

  return normalized;
}

export function normalizeSelectedCustomInstructionIds(ids: Iterable<unknown>): string[] {
  const normalizedIds: string[] = [];
  const seenIds = new Set<string>();

  for (const candidate of ids) {
    const id = trimToNull(candidate, CUSTOM_INSTRUCTION_ID_MAX_CHARS);
    if (!id || seenIds.has(id)) {
      continue;
    }
    seenIds.add(id);
    normalizedIds.push(id);
    if (normalizedIds.length >= CUSTOM_INSTRUCTION_MAX_COUNT) {
      break;
    }
  }

  return normalizedIds;
}

export function resolveSelectedCustomInstructions(
  library: readonly CustomInstruction[],
  selectedIds: Iterable<unknown>,
): CustomInstruction[] {
  const libraryById = new Map(library.map((instruction) => [instruction.id, instruction]));
  const resolved: CustomInstruction[] = [];

  for (const id of normalizeSelectedCustomInstructionIds(selectedIds)) {
    const instruction = libraryById.get(id);
    if (!instruction) {
      continue;
    }
    resolved.push(instruction);
  }

  return resolved;
}

export function summarizeCustomInstructionBody(
  body: string,
  maxChars = 96,
): string {
  const normalized = body.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxChars) {
    return normalized;
  }
  const truncated = normalized.slice(0, Math.max(0, maxChars - 1)).trimEnd();
  const lastWordBoundary = truncated.lastIndexOf(" ");
  const safeTruncated =
    lastWordBoundary > Math.max(0, Math.floor(maxChars / 3))
      ? truncated.slice(0, lastWordBoundary).trimEnd()
      : truncated;
  return `${safeTruncated}…`;
}
