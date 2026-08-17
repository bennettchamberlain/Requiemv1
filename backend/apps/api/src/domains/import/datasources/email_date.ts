/*
 * Fallback timestamps for messages with no (or unparseable) Date: header.
 *
 * RFC 5322 requires Date:, but transactional senders omit it in practice
 * (Staples' Trustwave gateway, Workable's mailer, Yahoo Calendar's JavaMail
 * notices — 11 of ~6,300 messages in a real Yahoo mailbox had none). Without a
 * fallback those messages persist timestamp-less and surface dated at import
 * wall-clock, which reads as a real date on the timeline.
 *
 * Order of trust: Date: is the author's send time; the topmost Received: stamp
 * is final delivery (minutes later at worst); the mbox `From ` separator line
 * is the delivery date too and exists on every mbox record by definition.
 */

/**
 * The timestamp of the FIRST Received: header that carries one — the topmost
 * is the final-delivery hop, stamped by the user's own provider. Expects the
 * UNFOLDED header block (continuation lines already joined), since the `; date`
 * clause usually sits on a folded line.
 */
export function receivedDate(headersRaw: string): Date | undefined {
  for (const line of headersRaw.split('\n')) {
    if (!/^received:/i.test(line)) {
      continue;
    }

    // The date clause follows the LAST ';' of the header (earlier ';' can
    // appear inside comments/via clauses).
    const semi = line.lastIndexOf(';');
    if (semi === -1) {
      continue;
    }

    const d = new Date(line.slice(semi + 1).trim());
    if (!isNaN(d.getTime())) {
      return d;
    }
  }

  return undefined;
}

/**
 * The delivery date on an mbox record's `From ` separator line, e.g.
 * `From support@orders.staples.com Tue Mar 30 04:10:33 2021`. The asctime
 * form carries no zone; it is read as UTC — Thunderbird's separator stamps
 * match the message's own `X-Apparently-To` UTC time, and a deterministic
 * read beats one that shifts with the importing machine's timezone.
 * Returns undefined for non-mbox input (an .eml has no separator line).
 */
export function mboxFromLineDate(chunk: string): Date | undefined {
  if (!chunk.startsWith('From ')) {
    return undefined;
  }

  const nl = chunk.indexOf('\n');
  const line = nl === -1 ? chunk : chunk.slice(0, nl);
  const m = line.match(/([A-Z][a-z]{2}) {1,2}(\d{1,2}) (\d{2}:\d{2}:\d{2}) (\d{4})\s*$/);
  if (!m) {
    return undefined;
  }

  const [, mon, day, time, year] = m;
  const d = new Date(`${day} ${mon} ${year} ${time} +0000`);

  return isNaN(d.getTime()) ? undefined : d;
}
