import {
  ASK_TRANSITIONS,
  IllegalAskTransitionError,
  assertAskTransition,
  canTransitionAsk,
  isAnswerable,
  isTerminalAskStatus,
} from './askStatus';
import type { AskStatus } from './types';

const ALL: AskStatus[] = [
  'sent',
  'delivered',
  'under_review',
  'answering',
  'answered',
  'declined',
  'expired',
];

describe('ask state machine', () => {
  it('permits exactly the documented forward edges', () => {
    expect(canTransitionAsk('sent', 'delivered')).toBe(true);
    expect(canTransitionAsk('delivered', 'under_review')).toBe(true);
    expect(canTransitionAsk('delivered', 'answering')).toBe(true); // standing pre-auth
    expect(canTransitionAsk('under_review', 'answering')).toBe(true); // owner approves
    expect(canTransitionAsk('under_review', 'declined')).toBe(true);
    expect(canTransitionAsk('delivered', 'declined')).toBe(true); // auto-deny (block grant)
    expect(canTransitionAsk('answering', 'answered')).toBe(true);
    expect(canTransitionAsk('delivered', 'expired')).toBe(true);
    expect(canTransitionAsk('under_review', 'expired')).toBe(true);
  });

  it('rejects skipping the review/answering gate', () => {
    expect(canTransitionAsk('sent', 'answered')).toBe(false);
    expect(canTransitionAsk('delivered', 'answered')).toBe(false);
    expect(canTransitionAsk('under_review', 'answered')).toBe(false);
    expect(canTransitionAsk('sent', 'answering')).toBe(false);
  });

  it('treats answered / declined / expired as terminal (no outgoing edges)', () => {
    for (const status of ['answered', 'declined', 'expired'] as AskStatus[]) {
      expect(isTerminalAskStatus(status)).toBe(true);
      expect(ASK_TRANSITIONS[status]).toHaveLength(0);
      for (const to of ALL) {
        expect(canTransitionAsk(status, to)).toBe(false);
      }
    }
  });

  it('never allows a self-loop', () => {
    for (const status of ALL) {
      expect(canTransitionAsk(status, status)).toBe(false);
    }
  });

  it('assertAskTransition returns the target on a legal edge', () => {
    expect(assertAskTransition('sent', 'delivered')).toBe('delivered');
    expect(assertAskTransition('under_review', 'answering')).toBe('answering');
  });

  it('assertAskTransition throws IllegalAskTransitionError on an illegal edge', () => {
    expect(() => assertAskTransition('delivered', 'answered')).toThrow(IllegalAskTransitionError);
    try {
      assertAskTransition('answered', 'answering');
      throw new Error('expected throw');
    } catch (error) {
      expect(error).toBeInstanceOf(IllegalAskTransitionError);
      expect((error as IllegalAskTransitionError).from).toBe('answered');
      expect((error as IllegalAskTransitionError).to).toBe('answering');
    }
  });
});

// `isAnswerable` gates AskResolver's answer-write mutation (its own docstring:
// extracted so the check runs BEFORE any side effect, because `AskService.complete`
// used to run it only AFTER the answer row was already written — a declined ask
// reaching `complete` threw correctly, but by then the disclosure was persisted
// and readable). Zero coverage anywhere before this file.
describe('isAnswerable', () => {
  it('an owner-approved ask ("answering") is answerable regardless of consent basis', () => {
    expect(isAnswerable('answering', null)).toBe(true);
    expect(isAnswerable('answering', undefined)).toBe(true);
    expect(isAnswerable('answering', 'grant-1')).toBe(true);
  });

  it('an auto-authorized ask ("delivered" + a consent basis) is answerable — the standing-grant shape', () => {
    expect(isAnswerable('delivered', 'grant-auto')).toBe(true);
  });

  it('"delivered" with NO consent basis is NOT answerable — review has not happened yet', () => {
    expect(isAnswerable('delivered', null)).toBe(false);
    expect(isAnswerable('delivered', undefined)).toBe(false);
  });

  it('a declined ask is never answerable, consent basis or not — the exact regression this guards', () => {
    // The historical bug: a declined ask reaching the answer-write step after
    // the disclosure was already persisted. `consentBasis` is set on a declined
    // ask too (the deny grant that caused the decline), so the check must gate
    // on STATUS, not merely on consentBasis being present.
    expect(isAnswerable('declined', null)).toBe(false);
    expect(isAnswerable('declined', 'grant-block')).toBe(false);
  });

  it('an expired ask is never answerable', () => {
    expect(isAnswerable('expired', null)).toBe(false);
    expect(isAnswerable('expired', 'grant-1')).toBe(false);
  });

  it('a not-yet-reviewed ask ("sent" / "under_review") is not answerable', () => {
    expect(isAnswerable('sent', null)).toBe(false);
    expect(isAnswerable('under_review', null)).toBe(false);
    expect(isAnswerable('under_review', 'grant-1')).toBe(false);
  });

  it('an already-terminal "answered" ask is not re-answerable', () => {
    expect(isAnswerable('answered', null)).toBe(false);
    expect(isAnswerable('answered', 'grant-1')).toBe(false);
  });
});
