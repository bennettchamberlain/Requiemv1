/**
 * Visibility of `ci.questions` rows, shared by every user-scoped selector.
 *
 * The catalogue is two things in one table: ~1.3k shared rows every user on the
 * appliance is asked from (`is_private_to IS NULL`), and each person's own
 * reflections (`is_private_to = <them>`). A shared row is read-only — editing
 * one mints a private copy that records its origin in
 * `forked_from_question_id` — so every place that lists questions FOR a user
 * has to hide the origin a fork replaced, or that user sees both.
 */

/**
 * `AND NOT EXISTS (…)` fragment dropping shared rows the caller has forked.
 *
 * Only the forking user is affected: the origin is untouched and still selected
 * for everybody else. Rides the `questions_fork_owner_uniq` partial index.
 *
 * Both arguments are interpolated into SQL, so they must be literals from this
 * codebase (a table alias, a bind-parameter reference) and never user input.
 *
 * @param questionAlias Alias of the `ci.questions` row being filtered, e.g. `q`.
 * @param userExpr SQL expression for the caller's id, e.g. `$1::uuid` or `u.user_id`.
 */
export function excludeForkedOriginsSql(questionAlias: string, userExpr: string): string {
  return `
    AND NOT EXISTS (
      SELECT 1
      FROM ci.questions fork
      WHERE fork.forked_from_question_id = ${questionAlias}.question_id
        AND fork.is_private_to = ${userExpr}
    )
  `;
}
