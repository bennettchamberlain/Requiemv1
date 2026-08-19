/**
 * True when the inference backend rejected the call because the served model
 * cannot accept image inputs (e.g. vLLM: "Qwen3-8B is not a multimodal model").
 * Those failures should complete the job without retry/DLQ spam.
 */
export function isNonMultimodalModelError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();

  return (
    lower.includes('not a multimodal model') ||
    lower.includes('does not support images') ||
    lower.includes('image input is not supported') ||
    lower.includes('vision is not supported') ||
    (lower.includes('multimodal') && lower.includes('not support'))
  );
}
