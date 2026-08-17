/** First non-empty trimmed candidate — email, login, or other human account id. */
export function firstAccountLabel(...candidates: Array<string | null | undefined>): string | null {
  for (const candidate of candidates) {
    const value = candidate?.trim();
    if (value) {
      return value;
    }
  }

  return null;
}
