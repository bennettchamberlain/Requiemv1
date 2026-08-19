const TIME_ONLY = /^\d{1,2}:\d{2}$/;

const SCHEDULE_QUESTION =
  /\b(wake|waking|bed|sleep|workday|work day|start work|end work|go to bed|usual time)\b/i;

const AUTONOMY_QUESTION = /\b(companion do on its own|trust mode|autonom|auto-promote)\b/i;

const SETTING_ANSWER = /\b(auto-promote|high-confidence|hands.?off|cautious|balanced)\b/i;

/** Skip answer text that should not become a graph "interest" promotion. */
export function shouldSkipHydrationCandidate(text: string, questionText?: string | null): boolean {
  const trimmed = text.trim();
  if (!trimmed) {
    return true;
  }

  if (TIME_ONLY.test(trimmed)) {
    return true;
  }

  if (SETTING_ANSWER.test(trimmed)) {
    return true;
  }

  if (questionText) {
    if (SCHEDULE_QUESTION.test(questionText) || AUTONOMY_QUESTION.test(questionText)) {
      return true;
    }
  }

  return false;
}
