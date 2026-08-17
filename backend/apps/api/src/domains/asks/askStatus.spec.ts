import {
  ASK_TRANSITIONS,
  IllegalAskTransitionError,
  assertAskTransition,
  canTransitionAsk,
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
