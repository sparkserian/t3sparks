/**
 * Generates a structured context summary of a conversation thread when the
 * user switches models mid-thread. This summary is prepended to the first
 * message sent with the new model so it has full conversation context.
 */

import type { ChatMessage } from "../types";

const MAX_SUMMARY_CHARS = 6000;
const TRUNCATED_MESSAGE_MAX_CHARS = 300;
const RECENT_MESSAGE_COUNT = 6;

function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars).trimEnd() + "...";
}

function formatRole(role: ChatMessage["role"]): string {
  switch (role) {
    case "user":
      return "User";
    case "assistant":
      return "Assistant";
    case "system":
      return "System";
    default:
      return role;
  }
}

/**
 * Generate a context summary from a thread's message history, suitable for
 * prepending to the next message when the model has been switched.
 *
 * Returns an empty string if there are no messages to summarize.
 */
export function generateModelSwitchContextSummary(
  messages: ReadonlyArray<ChatMessage>,
  previousModel: string,
  newModel: string,
): string {
  if (messages.length === 0) return "";

  const lines: string[] = [];
  lines.push("---");
  lines.push(
    `[Context summary: This thread was previously using model "${previousModel}". ` +
      `You are now responding as "${newModel}". Below is a summary of the conversation so far.]`,
  );
  lines.push("");

  // Split messages into older (condensed) and recent (detailed)
  const splitIndex = Math.max(0, messages.length - RECENT_MESSAGE_COUNT);
  const olderMessages = messages.slice(0, splitIndex);
  const recentMessages = messages.slice(splitIndex);

  let currentLength = lines.join("\n").length;

  // Older messages: condensed (first ~300 chars)
  if (olderMessages.length > 0) {
    lines.push(`### Earlier messages (${olderMessages.length} messages, condensed):`);
    lines.push("");
    for (const msg of olderMessages) {
      const entry = `**${formatRole(msg.role)}:** ${truncateText(msg.text.trim(), TRUNCATED_MESSAGE_MAX_CHARS)}`;
      if (currentLength + entry.length + 2 > MAX_SUMMARY_CHARS) {
        lines.push(
          `... (${olderMessages.length - olderMessages.indexOf(msg)} earlier messages omitted for brevity)`,
        );
        break;
      }
      lines.push(entry);
      lines.push("");
      currentLength += entry.length + 2;
    }
  }

  // Recent messages: more detailed
  if (recentMessages.length > 0) {
    lines.push(`### Recent messages:`);
    lines.push("");
    for (const msg of recentMessages) {
      const maxForRecent = Math.min(
        1500,
        Math.max(500, Math.floor((MAX_SUMMARY_CHARS - currentLength) / recentMessages.length)),
      );
      const entry = `**${formatRole(msg.role)}:** ${truncateText(msg.text.trim(), maxForRecent)}`;
      lines.push(entry);
      lines.push("");
      currentLength += entry.length + 2;
    }
  }

  lines.push("---");
  lines.push("");

  return lines.join("\n");
}
