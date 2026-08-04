import { useCallback, useEffect, useRef } from 'react';

import { gql, useMutation, useQuery } from '@apollo/client';

const GET_CANDIDATES = gql(`
  query GetScheduleCandidates($from: DateTime!, $to: DateTime!) {
    scheduleCandidates(from: $from, to: $to) {
      id
      title
      description
      rationale
      rationaleSources { kind id note }
      windowStart
      windowEnd
      timeFlex
      durationMinutes
      l0Class
      fitScore
      status
      generator
      confidence
    }
  }
`);

const SYNC_SUGGESTIONS = gql(`
  mutation SyncScheduleSuggestions {
    syncScheduleSuggestions
  }
`);

const ACCEPT_CANDIDATE = gql(`
  mutation AcceptCandidate($id: ID!, $startTime: DateTime!, $endTime: DateTime) {
    acceptCandidate(id: $id, startTime: $startTime, endTime: $endTime) {
      id
      title
      startTime
      endTime
      status
    }
  }
`);

const DECLINE_CANDIDATE = gql(`
  mutation DeclineCandidate($id: ID!, $reason: String) {
    declineCandidate(id: $id, reason: $reason) { id status }
  }
`);

const SNOOZE_CANDIDATE = gql(`
  mutation SnoozeCandidate($id: ID!, $until: DateTime!) {
    snoozeCandidate(id: $id, until: $until) { id status }
  }
`);

const BREAK_DOWN_TASKS = gql(`
  mutation BreakDownTasks($text: String!) {
    breakDownTasks(text: $text) { id title }
  }
`);

const RETURN_EVENT_TO_SLATE = gql(`
  mutation ReturnEventToSlate($eventId: ID!) {
    returnEventToSlate(eventId: $eventId) { id status }
  }
`);

export interface CandidateSource {
  kind: string;
  id: string;
  note: string | null;
}

export interface ScheduleCandidate {
  id: string;
  title: string;
  description: string | null;
  rationale: string;
  rationaleSources: CandidateSource[];
  windowStart: string;
  windowEnd: string;
  timeFlex: string;
  durationMinutes: number | null;
  l0Class: string | null;
  fitScore: number | null;
  status: string;
  generator: string | null;
  confidence: number | null;
}

export type DeclineReason = 'not_now' | 'wrong_time' | 'not_like_this' | 'never';

interface Result {
  candidates: ScheduleCandidate[];
  loading: boolean;
  accept: (id: string, startTime: Date, endTime?: Date) => Promise<void>;
  decline: (id: string, reason: DeclineReason) => Promise<void>;
  snooze: (id: string, until: Date) => Promise<void>;
  /**
   * Split a free-text note into candidates. Resolves with how many landed, so
   * the caller can say "nothing came back" rather than clearing the box on a
   * generation that produced nothing.
   */
  breakDown: (text: string) => Promise<number>;
  /**
   * Take a placed event off the week and back onto the slate. Only events this
   * system minted from a candidate qualify; the server rejects the rest.
   */
  returnEvent: (eventId: string) => Promise<void>;
}

/**
 * The slate: everything the system thinks is worth doing but that has not been
 * given a time yet.
 *
 * Refreshes itself from actions and insights once per mount — the sync is
 * idempotent by dedupe key, and a slate that only fills after a manual button
 * press is a slate nobody sees. Accept/decline/snooze refetch so the grid and
 * the slate never disagree about what is still open.
 */
export function useScheduleCandidates(from: Date, to: Date, onPlaced?: () => void): Result {
  const variables = { from: from.toISOString(), to: to.toISOString() };

  const { data, loading, refetch } = useQuery<{ scheduleCandidates: ScheduleCandidate[] }>(
    GET_CANDIDATES,
    { variables, fetchPolicy: 'cache-and-network' },
  );

  const [syncSuggestions] = useMutation(SYNC_SUGGESTIONS);
  const [acceptCandidate] = useMutation(ACCEPT_CANDIDATE);
  const [declineCandidate] = useMutation(DECLINE_CANDIDATE);
  const [snoozeCandidate] = useMutation(SNOOZE_CANDIDATE);
  const [breakDownTasks] = useMutation(BREAK_DOWN_TASKS);
  const [returnEventToSlate] = useMutation(RETURN_EVENT_TO_SLATE);

  // Once per mount, not per render or per week-navigation: the projection is
  // cheap but it is still a write, and it does not depend on the window.
  const synced = useRef(false);

  useEffect(() => {
    if (synced.current) {
      return;
    }

    synced.current = true;
    syncSuggestions()
      .then(() => refetch())
      .catch(() => {
        // A failed refresh leaves whatever was already stored; the slate is
        // additive, so this degrades to "slightly stale" rather than empty.
      });
  }, [syncSuggestions, refetch]);

  const accept = useCallback(
    async (id: string, startTime: Date, endTime?: Date) => {
      await acceptCandidate({
        variables: { id, startTime: startTime.toISOString(), endTime: endTime?.toISOString() ?? null },
      });
      await refetch();
      onPlaced?.();
    },
    [acceptCandidate, refetch, onPlaced],
  );

  const decline = useCallback(
    async (id: string, reason: DeclineReason) => {
      await declineCandidate({ variables: { id, reason } });
      await refetch();
    },
    [declineCandidate, refetch],
  );

  const snooze = useCallback(
    async (id: string, until: Date) => {
      await snoozeCandidate({ variables: { id, until: until.toISOString() } });
      await refetch();
    },
    [snoozeCandidate, refetch],
  );

  const breakDown = useCallback(
    async (text: string) => {
      const result = await breakDownTasks({ variables: { text } });
      await refetch();

      return (result.data as { breakDownTasks?: unknown[] } | null)?.breakDownTasks?.length ?? 0;
    },
    [breakDownTasks, refetch],
  );

  // Un-placing deletes the event it minted, so the committed lane has to
  // re-read exactly as it does after a placement.
  const returnEvent = useCallback(
    async (eventId: string) => {
      await returnEventToSlate({ variables: { eventId } });
      await refetch();
      onPlaced?.();
    },
    [returnEventToSlate, refetch, onPlaced],
  );

  return {
    candidates: data?.scheduleCandidates ?? [],
    loading,
    accept,
    decline,
    snooze,
    breakDown,
    returnEvent,
  };
}
