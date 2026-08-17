import { ImportSurface } from '@/pages/ImportPage/ImportPage';

import { StepHeader } from './StepHeader';

/**
 * Bring in an export you already have — an optional step of its own.
 *
 * Importing used to be one card among ten on the connect step, opening a
 * dialog. That put the single richest source of memory a new user has behind a
 * control most people never noticed: connecting Gmail seeds the last weeks,
 * while a Google Takeout seeds the last decade. Giving it a step is what makes
 * it a choice someone actually makes.
 *
 * A step, not a gate. Onboarding's footer already renders Skip on every step
 * and says so, and this one leans on that rather than inventing a second escape
 * hatch — an export is a download that can take Google days to produce, so most
 * people will pass through here with nothing to give it, and the copy says that
 * plainly instead of implying they are behind.
 *
 * The surface is the same {@link ImportSurface} the /import page hosts, in its
 * `onboarding` variant: same wizard, same inbox, History hidden because a
 * first-run user has no runs to revisit. Runs started here keep going after
 * onboarding finishes — nothing about leaving the step cancels them — so the
 * copy promises exactly that and no more.
 */
export function ImportArchivesStep() {
  return (
    <div className="mx-auto w-full space-y-6">
      {/* Deliberately terse. Every line here is taken straight out of the
          surface below it: the description ran three lines at this width and
          left the ~100-entry service list 290px to scroll in. The one thing a
          first-run user needs that the surface cannot tell them — that having
          no export yet is fine — is the second sentence, and nothing more. */}
      <StepHeader
        title="Bring in an export"
        description="Already downloaded your data from Google, Apple or anywhere else? Add it now. No export yet? Skip — you can import any time."
      />

      {/* Bounded height: the wizard pins its stepper and its Continue, and
          scrolls only the list between them — which needs a real ceiling to
          scroll against. Generous, because that list is long. */}
      <div className="flex h-[68vh] min-h-[26rem] flex-col overflow-hidden rounded-lg border">
        <ImportSurface variant="onboarding" />
      </div>

      <p className="text-center text-sm text-muted-foreground">
        Imports keep running after setup finishes — you don&rsquo;t have to wait here.
      </p>
    </div>
  );
}
