/**
 * Sidebar labels for chat threads. The model is asked for ~three words; this
 * strips thinking traces, quotes, and extra punctuation so the list stays short.
 */
export function sidebarTitleFromModel(raw: string): string {
  const withoutThink = raw.replace(/<think>[\s\S]*?<\/think>/gi, ' ');
  const cleaned = withoutThink
    .replace(/["'`]/g, '')
    .replace(/[^A-Za-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned) {
    return '';
  }

  const words = cleaned.split(' ').slice(0, 6);

  return words.map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(' ');
}

export const THREAD_TITLE_SYSTEM_PROMPT =
  'Name this conversation for a sidebar label. Reply with three words, plus or minus a few. No punctuation, no quotes, no explanation.';
