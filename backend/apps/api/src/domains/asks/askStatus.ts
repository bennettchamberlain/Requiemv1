import type { AskStatus } from './types';

/**
 * Legal forward transitions for an Ask's lifecycle (ARCHITECTURE.md §6).
 *
 * ```
 * sent → delivered → under_review → answering → answered
 *                  ↘ answering (standing pre-auth)      ↘ (terminal)
 *                  ↘ expired          ↘ declined | expired
 * ```
 */
export const ASK_TRANSITIONS: Readonly<Record<AskStatus, readonly AskStatus[]>> = {
  sent: ['delivered'],
  // `delivered → declined` is the auto-deny edge: a matching `block` grant
  // refuses the ask on delivery without owner review.
  delivered: ['under_review', 'answering', 'declined', 'expired'],
  under_review: ['answering', 'declined', 'expired'],
  answering: ['answered'],
  answered: [],
  declined: [],
  expired: [],
};

export const TERMINAL_ASK_STATUSES: readonly AskStatus[] = ['answered', 'declined', 'expired'];

export function isTerminalAskStatus(status: AskStatus): boolean {
  return TERMINAL_ASK_STATUSES.includes(status);
}

export function canTransitionAsk(from: AskStatus, to: AskStatus): boolean {
  return ASK_TRANSITIONS[from].includes(to);
}

/** Thrown when an ask is moved along an illegal edge of the lifecycle. */
export class IllegalAskTransitionError extends Error {
  constructor(
    public readonly from: AskStatus,
    public readonly to: AskStatus,
  ) {
    super(`Illegal ask transition: ${from} → ${to}`);
    this.name = 'IllegalAskTransitionError';
  }
}

/** Returns `to` if the transition is legal, otherwise throws. Pure. */
export function assertAskTransition(from: AskStatus, to: AskStatus): AskStatus {
  if (!canTransitionAsk(from, to)) {
    throw new IllegalAskTransitionError(from, to);
  }

  return to;
}
