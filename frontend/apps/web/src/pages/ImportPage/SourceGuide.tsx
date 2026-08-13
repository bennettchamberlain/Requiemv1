import type { ReactNode } from 'react';

import { Badge, Button, Card } from '@ci/shadcn';
import { AlertTriangle, ExternalLink } from '@ci/shadcn/icons';

import { Markdown } from '@/components/Markdown';

import type { ImportSourceGuide } from './useImportApi';
import { shortTitle } from './wizard/sources';

export interface SourceGuideProps {
  guide: ImportSourceGuide;
  /** Extra badges beside the wait class — "files staged ✓", "coming soon". */
  badges?: ReactNode;
  /**
   * Rendered inside the card, after the instructions. The wizard's export card
   * puts its upload area here so the drop target and the steps that lead to it
   * are one surface.
   */
  children?: ReactNode;
}

/** How long the service takes to hand the export over, in words. */
const WAIT_LABELS: Record<string, string> = {
  instant: 'Available immediately',
  minutes: 'Ready in minutes',
  hours: 'Ready in a few hours',
  days: 'Takes a day or more',
  weeks: 'Can take weeks',
};

/**
 * How to get one export out of the service that holds it.
 *
 * Rendered inline, next to the source someone just picked, because that is the
 * moment the question is asked. Sending them to a documentation page to find out
 * where Google keeps the Takeout button is how people give up on an import.
 *
 * The wait class is shown prominently for the same reason: "Spotify can take up
 * to 30 days" is the single most useful thing to know BEFORE starting, and
 * discovering it after clicking through five settings pages is a bad surprise.
 */
export function SourceGuide({ guide, badges, children }: SourceGuideProps) {
  return (
    <Card className="space-y-4 p-4">
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-medium">{guide.title}</h3>
          <Badge variant="outline">{WAIT_LABELS[guide.wait] ?? guide.wait}</Badge>
          {badges}
        </div>
        <p className="text-sm text-muted-foreground">{guide.blurb}</p>
      </div>

      <Steps title={guide.stepsTitle ?? 'How to export'} steps={guide.steps} />

      {guide.url ? (
        // Below the steps, as upstream places it: the instructions explain what
        // the page will ask, so the button is the last thing read, not the
        // first thing clicked.
        <ExportCta url={guide.url} label={`Open the ${shortTitle(guide.title)} export page`} />
      ) : null}

      {guide.altPath ? (
        <div className="space-y-3 rounded-md border border-dashed p-3">
          <Steps title={guide.altPath.title} steps={guide.altPath.steps} />
          {guide.altPath.url ? (
            <ExportCta
              url={guide.altPath.url}
              label={`Open the ${shortTitle(guide.title)} data request page`}
            />
          ) : null}
        </div>
      ) : null}

      {guide.whatImported?.length ? (
        <section className="space-y-1">
          <h4 className="text-sm font-medium">What this brings in</h4>
          <ul className="list-disc space-y-0.5 pl-5 text-sm text-muted-foreground">
            {guide.whatImported.map((entry) => (
              <li key={entry}>{entry}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {guide.caveats?.length ? (
        <section className="space-y-1">
          <h4 className="flex items-center gap-1 text-sm font-medium">
            <AlertTriangle className="h-3 w-3 text-amber-500" aria-hidden />
            Worth knowing first
          </h4>
          <ul className="list-disc space-y-0.5 pl-5 text-sm text-muted-foreground">
            {guide.caveats.map((entry) => (
              <li key={entry}>{entry}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {children}
    </Card>
  );
}

/** The named doorway to the service's own export flow, styled as a real button. */
function ExportCta({ url, label }: { url: string; label: string }) {
  return (
    <Button asChild variant="secondary">
      <a href={url} target="_blank" rel="noreferrer">
        {label}
        <ExternalLink aria-hidden />
      </a>
    </Button>
  );
}

function Steps({ title, steps }: { title: string; steps: readonly string[] }) {
  return (
    <section className="space-y-1">
      <h4 className="text-sm font-medium">{title}</h4>

      <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
        {steps.map((step) => (
          // The steps are AUTHORED as inline markdown — nested per-OS bullets
          // joined with newlines, backticked paths — and rendering them as
          // plain text is how `**Windows:**` reaches someone's screen verbatim.
          <li key={step}>
            <Markdown>{step}</Markdown>
          </li>
        ))}
      </ol>
    </section>
  );
}
