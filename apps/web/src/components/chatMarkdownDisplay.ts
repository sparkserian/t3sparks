import { paragraphizeStreamingMarkdown } from "./chatMarkdownStreaming";

export function formatChatMarkdownDisplayText(text: string, _isStreaming: boolean): string {
  return paragraphizeStreamingMarkdown(text);
}
