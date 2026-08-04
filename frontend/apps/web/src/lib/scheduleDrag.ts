/**
 * Drag payload keys for the schedule surface.
 *
 * They live here rather than beside either component because the drags run in
 * BOTH directions: HorizonGrid accepts candidates from TaskSlate, and TaskSlate
 * accepts committed events back from HorizonGrid. Declaring each key on the
 * component that emits it would make the two import each other.
 */

/** A suggestion being dragged out of Possibilities. Payload: the candidate id. */
export const CANDIDATE_DRAG_TYPE = 'application/x-ci-candidate';

/** A committed event being dragged. Payload: {@link EventDragPayload} as JSON. */
export const EVENT_DRAG_TYPE = 'application/x-ci-event';

/**
 * Present on the drag when the event mirrors a row an external calendar owns.
 *
 * It exists as a KEY rather than a field because the DnD protection mode blanks
 * `getData` during `dragover` — only `types` is legible mid-drag. Without it the
 * rail would light up and promise "drop to take it off the week" for a Google
 * event it is going to refuse, which is a worse way to learn than never
 * offering.
 */
export const EVENT_EXTERNAL_DRAG_TYPE = 'application/x-ci-event-external';

/** True when this drag carries an event no candidate stands behind. */
export function isExternallyOwnedDrag(types: readonly string[]): boolean {
  return types.includes(EVENT_EXTERNAL_DRAG_TYPE);
}

export interface EventDragPayload {
  id: string;
  /** Milliseconds between the event's real start and where the user grabbed it. */
  grabOffsetMs: number;
  /**
   * Set when the event mirrors a row an external calendar owns. Returning such
   * an event to the slate is refused server-side (there is no candidate behind
   * it), so the rail uses this to decline the drop up front rather than let the
   * user complete a gesture that will fail.
   */
  externallyOwned?: boolean;
}

/** Read an event drag payload back, tolerating anything that is not ours. */
export function parseEventDrag(raw: string): EventDragPayload | null {
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<EventDragPayload>;

    if (typeof parsed.id !== 'string' || !Number.isFinite(parsed.grabOffsetMs)) {
      return null;
    }

    return {
      id: parsed.id,
      grabOffsetMs: parsed.grabOffsetMs as number,
      externallyOwned: parsed.externallyOwned === true,
    };
  } catch {
    return null;
  }
}
