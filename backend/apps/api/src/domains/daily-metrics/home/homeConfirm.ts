/** Seeded `ci.questions` row: "Which of these places is home?" */
export const HOME_QUESTION_ID = 'a1b0c0de-1111-4111-8111-000000000051';

/** `ci.actions.metadata.key` for the single undismissed home-identity ask. */
export const CONFIRM_HOME_ACTION_KEY = 'confirm_home';

/** Selector / metric-surprise ids that persist through {@link HomeConfirmService}. */
export const HOME_CONFIRM_SOURCE_IDS = ['confirm_home', 'one_place'] as const;

export type HomeConfirmSourceId = (typeof HOME_CONFIRM_SOURCE_IDS)[number];

export function isHomeConfirmSourceId(id: string | undefined): id is HomeConfirmSourceId {
  return id === 'confirm_home' || id === 'one_place';
}
