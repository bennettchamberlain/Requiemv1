/**
 * Where an onboarded user lands. Plan is the spine; Today is the fallback when
 * `planning.page` is off — it is the page that absorbed the brief, so this is
 * the same destination it always was, under the name it goes by now.
 */
export function appHomePath(planningPageEnabled: boolean): '/plan' | '/today' {
  return planningPageEnabled ? '/plan' : '/today';
}
