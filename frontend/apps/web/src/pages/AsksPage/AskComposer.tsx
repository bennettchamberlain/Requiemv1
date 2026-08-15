import { useState } from 'react';

import { Badge, Button, Card, Input } from '@ci/shadcn';
import { Zap } from '@ci/shadcn/icons';

interface Props {
  recipientName: string;
  tier: string;
  /**
   * Whether a standing grant would answer this without interrupting them.
   * Shown up front so the asker knows whether to expect a wait.
   */
  autoAnswers?: boolean;
  /** The structured ask, already rendered legibly. */
  preview: { label: string; value: string }[];
  initialPrompt?: string;
  onSend: (prompt: string) => void;
  busy?: boolean;
}

/**
 * Compose an ask.
 *
 * The composer's job is honesty: the asker types a question, and the structured
 * request that will actually be sent is shown back to them before they send it.
 * That preview IS the wire format rendered — there is no hidden widening between
 * what the asker sees here and what the responder is asked to consent to.
 */
export function AskComposer({
  recipientName,
  tier,
  autoAnswers = false,
  preview,
  initialPrompt = '',
  onSend,
  busy = false,
}: Props) {
  const [prompt, setPrompt] = useState(initialPrompt);
  const canSend = prompt.trim().length > 0 && !busy;

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-muted-foreground text-sm">To</span>
        <span className="font-medium">{recipientName}</span>
        <Badge variant="secondary" className="text-xs">
          {tier}
        </Badge>
        {autoAnswers ? (
          <span className="text-muted-foreground flex items-center gap-1 text-xs">
            <Zap aria-hidden className="size-3.5" />
            Answers instantly under a standing grant
          </span>
        ) : null}
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-sm">Your question</span>
        <Input
          value={prompt}
          placeholder="Do you have photos of us from the lake trip?"
          disabled={busy}
          onChange={(event) => setPrompt(event.target.value)}
        />
      </label>

      <div className="flex flex-col gap-1">
        <span className="text-muted-foreground text-xs">{recipientName} will see exactly this</span>
        <dl className="bg-muted flex flex-col gap-1 rounded-md px-3 py-2 text-xs">
          {preview.map((row) => (
            <div key={row.label} className="flex gap-2">
              <dt className="text-muted-foreground w-20 shrink-0">{row.label}</dt>
              <dd className="min-w-0 flex-1 break-words">{row.value}</dd>
            </div>
          ))}
        </dl>
      </div>

      <p className="text-muted-foreground text-xs">
        Their Companion answers only what {recipientName} allows.
      </p>

      <div>
        <Button onClick={() => onSend(prompt.trim())} disabled={!canSend}>
          Send ask
        </Button>
      </div>
    </Card>
  );
}
