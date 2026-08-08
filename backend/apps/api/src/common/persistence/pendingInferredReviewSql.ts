/**
 * SQL fragments for excluding questions that already have a pending inferred-answer review.
 * Keeps the inference cron from re-queuing the same question while the user decides.
 */

/** Use when the user id is bound as query param `$1` and the question alias is `q`. */
export const EXCLUDE_QUESTIONS_WITH_PENDING_INFERRED_REVIEW = `
  AND NOT EXISTS (
    SELECT 1
    FROM ci.promotion_candidates pc
    WHERE pc.user_id = $1
      AND pc.status = 'pending'
      AND pc.kind = 'inferred_fact'
      AND pc.payload->>'questionId' = q.question_id::text
  )
`;

/** Use inside findUnansweredByUserId where the user id column is `u.user_id`. */
export const EXCLUDE_QUESTIONS_WITH_PENDING_INFERRED_REVIEW_FOR_USER_COLUMN = `
  AND NOT EXISTS (
    SELECT 1
    FROM ci.promotion_candidates pc
    WHERE pc.user_id = u.user_id
      AND pc.status = 'pending'
      AND pc.kind = 'inferred_fact'
      AND pc.payload->>'questionId' = q.question_id::text
  )
`;
