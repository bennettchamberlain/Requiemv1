import { Badge, Button, Card } from '@ci/shadcn';

import { provenanceLine, withheldNote } from './askPresentation';

interface Props {
  responderName: string;
  /** The templated, non-leaking summary the responder's box produced. */
  summary: string;
  /** Disclosed item references (retrieval form only). */
  items?: { id: string; type: string; label: string }[];
  disclosedCount: number;
  withheldCount: number;
  autoAnswered: boolean;
  consentBasis?: string | null;
  onSave?: () => void;
  onThank?: () => void;
}

/**
 * An answer as received by the asker.
 *
 * The provenance line is mandatory and written as prose rather than iconography:
 * it is how the asker knows who stood behind the answer and on what basis. The
 * withheld count is shown; WHICH items were withheld never is — that asymmetry
 * is the disclosure contract made visible.
 */
export function AnswerCard({
  responderName,
  summary,
  items = [],
  disclosedCount,
  withheldCount,
  autoAnswered,
  consentBasis,
  onSave,
  onThank,
}: Props) {
  const withheld = withheldNote(withheldCount);

  return (
    <Card className="flex flex-col gap-3 p-4">
      <p className="font-medium">{summary}</p>

      {items.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {items.map((item) => (
            <li key={item.id} className="flex items-center gap-2 text-sm">
              <span className="truncate">{item.label}</span>
              <Badge variant="outline" className="ml-auto shrink-0 text-xs">
                {item.type}
              </Badge>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="text-muted-foreground border-t pt-2 text-xs">
        <p>{provenanceLine({ responderName, autoAnswered, consentBasis })}</p>
        {withheld ? <p className="mt-0.5">{withheld}</p> : null}
        {items.length === 0 && disclosedCount > 0 ? (
          <p className="mt-0.5">Shared as a summary — no individual items were sent.</p>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-2">
        {onSave ? (
          <Button size="sm" onClick={onSave}>
            Save to my memory
          </Button>
        ) : null}
        {onThank ? (
          <Button size="sm" variant="ghost" onClick={onThank}>
            Say thanks
          </Button>
        ) : null}
      </div>
    </Card>
  );
}
