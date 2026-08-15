import en from '@ci/common/i18n/translations/en.json';
import { describe, expect, it } from 'vitest';

// CI-Common is the org-wide source of truth for what the product says
// (CI-Common/content/brand-voice.md). Its own `lint:voice` script is still a TODO
// stub, and CI-Server does not consume @companionintelligence/content, so nothing
// enforces the rules here. These tests do, for the strings we own.
//
// Scope is deliberately narrow: only the rules brand-voice.md states as absolutes.
// Tone ("plain, confident, never corporate") is a review judgement, not a regex.
const entries = Object.entries(en as Record<string, string>);

describe('i18n copy follows CI-Common brand voice', () => {
  it('has strings to check', () => {
    expect(entries.length).toBeGreaterThan(0);
  });

  it('uses no em or en dashes in user-facing copy', () => {
    // "Never use em dashes (—) or en dashes (–) in user-facing copy. Use commas for
    // light pauses and semicolons for independent clauses."
    const offenders = entries.filter(([, v]) => /[—–]/.test(v)).map(([k, v]) => `${k}: ${v}`);

    expect(offenders).toEqual([]);
  });

  it('capitalizes product nouns rather than genericizing them', () => {
    // "Product nouns are Title Case (Companion Hub, Companion Memory)." The lowercase
    // forms below are the ones brand-voice.md lists under Avoid.
    const banned = [
      /\byour memory\b/,
      /\bknowledge base\b/i,
      /\bmemory system\b/i,
      /\bapp store\b/i,
      /\bhome server\b/i,
      /\bon-premise\b/i,
    ];
    const offenders = entries
      .filter(([, v]) => banned.some((re) => re.test(v)))
      .map(([k, v]) => `${k}: ${v}`);

    expect(offenders).toEqual([]);
  });

  it('avoids the buzzwords the voice guide bans outright', () => {
    const banned = /\b(leverage|seamless|best-in-class|revolutionary|AI-powered solution)\b/i;
    const offenders = entries.filter(([, v]) => banned.test(v)).map(([k, v]) => `${k}: ${v}`);

    expect(offenders).toEqual([]);
  });
});
