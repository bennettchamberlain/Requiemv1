import { describe, expect, it } from 'vitest';

import {
  askStatusLabel,
  grantModeBadge,
  grantModeLabel,
  needsOwnerReview,
  provenanceLine,
  rungLabel,
  withheldNote,
} from './askPresentation';

describe('grant mode presentation', () => {
  it('states the mode in words, never colour alone (WCAG 1.4.1)', () => {
    // Every badge carries a text label as well as a variant.
    for (const mode of ['auto', 'review', 'block'] as const) {
      const badge = grantModeBadge(mode);
      expect(badge.label.trim().length).toBeGreaterThan(0);
      expect(grantModeLabel(mode).trim().length).toBeGreaterThan(0);
    }
  });

  it('distinguishes blocked from ask-first in the label itself', () => {
    expect(grantModeBadge('block').label).not.toBe(grantModeBadge('review').label);
    expect(grantModeLabel('auto')).not.toBe(grantModeLabel('review'));
  });
});

describe('askStatusLabel', () => {
  it('names each lifecycle state in owner-facing words', () => {
    expect(askStatusLabel('under_review')).toMatch(/review/i);
    expect(askStatusLabel('declined')).toMatch(/declined/i);
    expect(askStatusLabel('answered')).toMatch(/answered/i);
  });

  it('flags only under_review as needing the owner', () => {
    expect(needsOwnerReview('under_review')).toBe(true);
    for (const status of ['sent', 'delivered', 'answered', 'declined', 'expired'] as const) {
      expect(needsOwnerReview(status)).toBe(false);
    }
  });
});

describe('provenanceLine', () => {
  it('says a human reviewed it only when one actually did', () => {
    const reviewed = provenanceLine({ responderName: 'Sam', autoAnswered: false });
    expect(reviewed).toContain('reviewed by Sam');

    const auto = provenanceLine({ responderName: 'Sam', autoAnswered: true });
    expect(auto).not.toContain('reviewed by Sam');
    expect(auto).toMatch(/automatically/i);
  });

  it('always attributes the answer to the responder', () => {
    expect(provenanceLine({ responderName: 'Devon', autoAnswered: true })).toContain("Devon's Companion");
  });

  it('includes the consent basis when there is one', () => {
    expect(
      provenanceLine({ responderName: 'Sam', autoAnswered: false, consentBasis: 'family grant' }),
    ).toContain('family grant');
  });
});

describe('withheldNote', () => {
  it('stays quiet when nothing was withheld', () => {
    expect(withheldNote(0)).toBeNull();
    expect(withheldNote(-1)).toBeNull();
  });

  it('discloses the count but never which items', () => {
    expect(withheldNote(1)).toBe('1 item withheld');
    expect(withheldNote(4)).toBe('4 items withheld');
  });
});

describe('rungLabel', () => {
  it('describes every rung of the disclosure ladder distinctly', () => {
    const labels = (['none', 'boolean', 'count', 'summary', 'redacted', 'full'] as const).map(rungLabel);
    expect(new Set(labels).size).toBe(labels.length);
  });
});
