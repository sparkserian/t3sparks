const MARKDOWN_BLOCK_PREFIX =
  /^(?:#{1,6}\s|>\s|[-*+]\s|\d+\.\s|\|.*\|| {4,}|\t|---+$|\*\*\*+$|___+$)/;

function isFenceLine(line: string): boolean {
  const trimmed = line.trimStart();
  return trimmed.startsWith("```") || trimmed.startsWith("~~~");
}

function isStructuredMarkdownLine(line: string): boolean {
  return MARKDOWN_BLOCK_PREFIX.test(line);
}

function splitSentences(text: string): string[] {
  const matches = text.match(/[^.!?\n]+(?:[.!?]+(?:["')\]]+)?)?|[^.!?\n]+$/g);
  return (matches ?? []).map((entry) => entry.trim()).filter((entry) => entry.length > 0);
}

function splitLongStreamingClause(text: string): string[] {
  const clauses: string[] = [];
  let remaining = text.trim();

  while (remaining.length > 180) {
    const slice = remaining.slice(0, 180);
    const breakIndex = Math.max(slice.lastIndexOf(", "), slice.lastIndexOf(" "));
    if (breakIndex < 80) {
      break;
    }
    clauses.push(remaining.slice(0, breakIndex).trim());
    remaining = remaining.slice(breakIndex + 1).trim();
  }

  if (remaining.length > 0) {
    clauses.push(remaining);
  }

  return clauses;
}

function paragraphizePlainStreamingText(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length === 0) {
    return "";
  }

  const sentences = splitSentences(normalized);
  if (sentences.length === 0) {
    return normalized;
  }

  if (sentences.length === 1 && normalized.length <= 180) {
    return normalized;
  }

  const paragraphs: string[] = [];
  let current = "";
  let currentSentenceCount = 0;

  const commitParagraph = () => {
    const trimmed = current.trim();
    if (trimmed.length > 0) {
      paragraphs.push(trimmed);
    }
    current = "";
    currentSentenceCount = 0;
  };

  for (let index = 0; index < sentences.length; index += 1) {
    const sentence = sentences[index]!;
    const next = current.length > 0 ? `${current} ${sentence}` : sentence;
    current = next;
    currentSentenceCount += 1;

    const isLast = index === sentences.length - 1;
    const endsWithColon = /:\s*$/.test(sentence);
    const shouldBreak =
      !isLast &&
      (endsWithColon ||
        (currentSentenceCount >= 2 && current.length >= 140) ||
        currentSentenceCount >= 3 ||
        current.length >= 240);

    if (shouldBreak) {
      commitParagraph();
    }
  }

  commitParagraph();

  if (paragraphs.length === 1 && !/[.!?]/.test(normalized) && normalized.length > 180) {
    return splitLongStreamingClause(normalized).join("\n\n");
  }

  return paragraphs.join("\n\n");
}

export function paragraphizeStreamingMarkdown(text: string): string {
  const normalized = text.replace(/\r\n/g, "\n");
  if (normalized.trim().length === 0) {
    return normalized;
  }

  const lines = normalized.split("\n");
  const output: string[] = [];
  const proseLines: string[] = [];
  let inFence = false;

  const flushProse = () => {
    if (proseLines.length === 0) {
      return;
    }
    output.push(paragraphizePlainStreamingText(proseLines.join(" ")));
    proseLines.length = 0;
  };

  for (const originalLine of lines) {
    const line = originalLine.trimEnd();
    const trimmed = line.trim();

    if (isFenceLine(line)) {
      flushProse();
      output.push(line);
      inFence = !inFence;
      continue;
    }

    if (inFence) {
      output.push(line);
      continue;
    }

    if (trimmed.length === 0) {
      flushProse();
      output.push("");
      continue;
    }

    if (isStructuredMarkdownLine(trimmed)) {
      flushProse();
      output.push(line);
      continue;
    }

    proseLines.push(trimmed);
  }

  flushProse();

  return output.join("\n");
}
