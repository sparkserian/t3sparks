import {
  getSharedHighlighter,
  type DiffsHighlighter,
  type SupportedLanguages,
} from "@pierre/diffs";
import { CheckIcon, CopyIcon } from "lucide-react";
import {
  Children,
  Suspense,
  isValidElement,
  use,
  useCallback,
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import { resolveDiffThemeName, type DiffThemeName } from "../lib/diffRendering";
import { fnv1a32 } from "../lib/diffRendering";
import { LRUCache } from "../lib/lruCache";
import { useTheme } from "../hooks/useTheme";
import { resolveCodeFenceLanguage } from "../codeFenceLanguage";
import { paragraphizeStreamingMarkdown } from "./chatMarkdownStreaming";

interface ChatMarkdownProps {
  text: string;
  cwd: string | undefined;
  isStreaming?: boolean;
}

const MAX_HIGHLIGHT_CACHE_ENTRIES = 500;
const MAX_HIGHLIGHT_CACHE_MEMORY_BYTES = 50 * 1024 * 1024;
const highlightedCodeCache = new LRUCache<string>(
  MAX_HIGHLIGHT_CACHE_ENTRIES,
  MAX_HIGHLIGHT_CACHE_MEMORY_BYTES,
);
const highlighterPromiseCache = new Map<string, Promise<DiffsHighlighter>>();

function nodeToPlainText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map((child) => nodeToPlainText(child)).join("");
  }
  if (isValidElement<{ children?: ReactNode }>(node)) {
    return nodeToPlainText(node.props.children);
  }
  return "";
}

function extractCodeBlock(
  children: ReactNode,
): { className: string | undefined; code: string } | null {
  const childNodes = Children.toArray(children);
  if (childNodes.length !== 1) {
    return null;
  }

  const onlyChild = childNodes[0];
  if (
    !isValidElement<{ className?: string; children?: ReactNode }>(onlyChild) ||
    onlyChild.type !== "code"
  ) {
    return null;
  }

  return {
    className: onlyChild.props.className,
    code: nodeToPlainText(onlyChild.props.children),
  };
}

function createHighlightCacheKey(code: string, language: string, themeName: DiffThemeName): string {
  return `${fnv1a32(code).toString(36)}:${code.length}:${language}:${themeName}`;
}

function estimateHighlightedSize(html: string, code: string): number {
  return Math.max(html.length * 2, code.length * 3);
}

function getHighlighterPromise(language: string): Promise<DiffsHighlighter> {
  const cached = highlighterPromiseCache.get(language);
  if (cached) return cached;

  const promise = getSharedHighlighter({
    themes: [resolveDiffThemeName("dark"), resolveDiffThemeName("light")],
    langs: [language as SupportedLanguages],
    preferredHighlighter: "shiki-js",
  }).catch(() =>
    getSharedHighlighter({
      themes: [resolveDiffThemeName("dark"), resolveDiffThemeName("light")],
      langs: ["text" as SupportedLanguages],
      preferredHighlighter: "shiki-js",
    }),
  );
  highlighterPromiseCache.set(language, promise);
  return promise;
}

function MarkdownCodeBlock({ code, children }: { code: string; children: ReactNode }) {
  const [copied, setCopied] = useState(false);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleCopy = useCallback(() => {
    if (typeof navigator === "undefined" || navigator.clipboard == null) {
      return;
    }
    void navigator.clipboard
      .writeText(code)
      .then(() => {
        if (copiedTimerRef.current != null) {
          clearTimeout(copiedTimerRef.current);
        }
        setCopied(true);
        copiedTimerRef.current = setTimeout(() => {
          setCopied(false);
          copiedTimerRef.current = null;
        }, 1200);
      })
      .catch(() => undefined);
  }, [code]);

  useEffect(
    () => () => {
      if (copiedTimerRef.current != null) {
        clearTimeout(copiedTimerRef.current);
        copiedTimerRef.current = null;
      }
    },
    [],
  );

  return (
    <div className="chat-markdown-codeblock">
      <button
        type="button"
        className="chat-markdown-copy-button"
        onClick={handleCopy}
        title={copied ? "Copied" : "Copy code"}
        aria-label={copied ? "Copied" : "Copy code"}
      >
        {copied ? <CheckIcon className="size-3" /> : <CopyIcon className="size-3" />}
      </button>
      {children}
    </div>
  );
}

interface SuspenseShikiCodeBlockProps {
  className: string | undefined;
  code: string;
  themeName: DiffThemeName;
  isStreaming: boolean;
}

function SuspenseShikiCodeBlock({
  className,
  code,
  themeName,
  isStreaming,
}: SuspenseShikiCodeBlockProps) {
  const language = resolveCodeFenceLanguage(className);
  const cacheKey = createHighlightCacheKey(code, language, themeName);
  const cachedHighlightedHtml = !isStreaming ? highlightedCodeCache.get(cacheKey) : null;

  if (cachedHighlightedHtml != null) {
    return (
      <div
        className="chat-markdown-shiki"
        dangerouslySetInnerHTML={{ __html: cachedHighlightedHtml }}
      />
    );
  }

  const highlighter = use(getHighlighterPromise(language));
  const highlightedHtml = useMemo(() => {
    try {
      return highlighter.codeToHtml(code, { lang: language, theme: themeName });
    } catch {
      return highlighter.codeToHtml(code, { lang: "text", theme: themeName });
    }
  }, [code, highlighter, language, themeName]);

  useEffect(() => {
    if (!isStreaming) {
      highlightedCodeCache.set(
        cacheKey,
        highlightedHtml,
        estimateHighlightedSize(highlightedHtml, code),
      );
    }
  }, [cacheKey, code, highlightedHtml, isStreaming]);

  return (
    <div className="chat-markdown-shiki" dangerouslySetInnerHTML={{ __html: highlightedHtml }} />
  );
}

function ChatMarkdown({ text, cwd, isStreaming = false }: ChatMarkdownProps) {
  const { resolvedTheme } = useTheme();
  const diffThemeName = resolveDiffThemeName(resolvedTheme);
  const displayText = useMemo(
    () => (isStreaming ? paragraphizeStreamingMarkdown(text) : text),
    [isStreaming, text],
  );
  const markdownComponents = useMemo<Components>(
    () => ({
      a({ node: _node, href, ...props }) {
        return (
          <a
            {...props}
            href={href}
            data-t3sparks-cwd={cwd}
            rel="noreferrer"
            className="font-medium text-foreground underline decoration-border underline-offset-4 transition-colors hover:text-foreground"
          />
        );
      },
      p({ node: _node, className, ...props }) {
        return <p {...props} className={`max-w-[78ch] text-[15px] leading-7 text-foreground/92 ${className ?? ""}`.trim()} />;
      },
      ul({ node: _node, className, ...props }) {
        return (
          <ul
            {...props}
            className={`max-w-[78ch] list-disc space-y-2 pl-5 text-[15px] leading-7 text-foreground/90 ${className ?? ""}`.trim()}
          />
        );
      },
      ol({ node: _node, className, ...props }) {
        return (
          <ol
            {...props}
            className={`max-w-[78ch] list-decimal space-y-2 pl-5 text-[15px] leading-7 text-foreground/90 ${className ?? ""}`.trim()}
          />
        );
      },
      li({ node: _node, className, ...props }) {
        return <li {...props} className={`pl-1 ${className ?? ""}`.trim()} />;
      },
      blockquote({ node: _node, className, ...props }) {
        return (
          <blockquote
            {...props}
            className={`max-w-[78ch] border-l-2 border-border/80 pl-4 text-foreground/78 italic ${className ?? ""}`.trim()}
          />
        );
      },
      h1({ node: _node, className, ...props }) {
        return <h1 {...props} className={`max-w-[78ch] text-xl font-semibold tracking-tight text-foreground ${className ?? ""}`.trim()} />;
      },
      h2({ node: _node, className, ...props }) {
        return <h2 {...props} className={`max-w-[78ch] text-lg font-semibold tracking-tight text-foreground ${className ?? ""}`.trim()} />;
      },
      h3({ node: _node, className, ...props }) {
        return <h3 {...props} className={`max-w-[78ch] text-base font-semibold text-foreground ${className ?? ""}`.trim()} />;
      },
      h4({ node: _node, className, ...props }) {
        return <h4 {...props} className={`max-w-[78ch] text-sm font-semibold uppercase tracking-[0.08em] text-foreground/88 ${className ?? ""}`.trim()} />;
      },
      br() {
        // Many providers emit paragraph-ish single line breaks while streaming.
        // Render them with visible separation instead of collapsing into one dense block.
        return (
          <>
            <br />
            <br />
          </>
        );
      },
      hr({ node: _node, className, ...props }) {
        return <hr {...props} className={`border-border/80 ${className ?? ""}`.trim()} />;
      },
      pre({ node: _node, children, ...props }) {
        const codeBlock = extractCodeBlock(children);
        if (!codeBlock) {
          return <pre {...props}>{children}</pre>;
        }

        return (
          <MarkdownCodeBlock code={codeBlock.code}>
            <Suspense fallback={<pre {...props}>{children}</pre>}>
              <SuspenseShikiCodeBlock
                className={codeBlock.className}
                code={codeBlock.code}
                themeName={diffThemeName}
                isStreaming={isStreaming}
              />
            </Suspense>
          </MarkdownCodeBlock>
        );
      },
    }),
    [cwd, diffThemeName, isStreaming],
  );

  return (
    <div className="chat-markdown w-full min-w-0 text-sm text-foreground/92 [&>*+*]:mt-4">
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} components={markdownComponents}>
        {displayText}
      </ReactMarkdown>
    </div>
  );
}

export default memo(ChatMarkdown);
