import { extractRenderableOutput } from "../../lib/renderable-output";

// Extract the first renderable HTML document and ignore any trailing prose/logs.
export function extractHtml(code: string): string {
  return extractRenderableOutput(code);
}
