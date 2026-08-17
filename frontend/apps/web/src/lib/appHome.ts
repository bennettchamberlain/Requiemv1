/**
 * Where an onboarded user lands. Plan is the spine; Brief is the fallback
 * when `planning.page` is off.
 */
export function appHomePath(planningPageEnabled: boolean): '/plan' | '/brief' {
  return planningPageEnabled ? '/plan' : '/brief';
}
