import { Injectable } from '@nestjs/common';

import { LoggerService } from '@ci/common/logging';
import config from '@ci/configuration';

import { type PeerLink } from '../entities/PeerLinkEntity';
import type { AskerVisiblePeerReply, PeerAskBody, PeerAskResponse } from '../protocol';
import { checkEgressUrl } from '../urlPolicy';

/**
 * Talks to a peer Companion's `/agent/v1` — the only code in this box that
 * calls `fetch` at a peer.
 *
 * The token is a CI-Portal-issued OIDC access token whose audience is the peer
 * box, so the peer can verify who is asking against its own peer links without
 * this box and that box sharing any secret. A peer that is slow, offline, or
 * hostile must not hang the caller, so every call is bounded by a timeout and
 * failures degrade to a non-answer rather than throwing.
 *
 * ═══ THIS IS ALSO WHERE THE PEER'S VOCABULARY STOPS ═══
 *
 * Everything returned here is {@link AskerVisiblePeerReply}, not the wire
 * {@link PeerAskResponse}: `answered` or `delivered`, in the same two words
 * `askerVisibleStatus` folds a LOCAL ask down to. This is the trust boundary —
 * "this path treats the local user as authoritative and the PEER'S RESPONSE as
 * untrusted" — so it is the right and only place to do it. Converting further
 * in would mean every reader had to remember to.
 */
@Injectable()
export class PeerAskClient {
  constructor(private readonly logger: LoggerService) {
    this.logger.setContext(PeerAskClient.name);
  }

  async send(peer: PeerLink, body: PeerAskBody, accessToken: string): Promise<AskerVisiblePeerReply> {
    return this.call(peer, `/ask`, body.askId, accessToken, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  /**
   * Collect the answer to an ask already sent, by the correlation id this box
   * minted for it. The half that makes an owner-approved federated answer
   * reachable at all; see {@link PeerAskService.result}.
   *
   * `encodeURIComponent` is belt-and-braces: `PEER_ASK_ID_PATTERN` already
   * excludes everything that would need escaping, and this box mints the id
   * itself — but the id is read back out of the database, and a path built by
   * concatenation is exactly the shape that stops being safe when the field's
   * bounds are relaxed by someone else later.
   */
  async poll(peer: PeerLink, correlationId: string, accessToken: string): Promise<AskerVisiblePeerReply> {
    return this.call(peer, `/ask/${encodeURIComponent(correlationId)}`, correlationId, accessToken, {
      method: 'GET',
    });
  }

  private async call(
    peer: PeerLink,
    path: string,
    askId: string,
    accessToken: string,
    init: { method: string; body?: string },
  ): Promise<AskerVisiblePeerReply> {
    const url = `${peer.memoryEndpoint.replace(/\/+$/, '')}${path}`;

    // SSRF guard. `memoryEndpoint` originates from a directory descriptor, so it
    // is attacker-influenced; refuse anything pointing at private, loopback, or
    // metadata space before this box makes the request on their behalf. Applied
    // to the collect route as well as the ask route — a second caller that
    // skipped it would reopen the hole for the whole domain.
    const policy = checkEgressUrl(url);
    if (!policy.ok) {
      this.logger.warn(`refusing peer endpoint ${url}: ${policy.reason}`);

      return { askId, status: 'delivered', reason: 'Peer endpoint not permitted' };
    }

    try {
      const response = await fetch(url, {
        method: init.method,
        headers: {
          authorization: `Bearer ${accessToken}`,
          ...(init.body ? { 'content-type': 'application/json' } : {}),
          accept: 'application/json',
        },
        ...(init.body ? { body: init.body } : {}),
        signal: AbortSignal.timeout(config.peers.timeoutMs ?? 10_000),
      });

      if (!response.ok) {
        this.logger.warn(`peer call ${url} → ${response.status}`);

        // A LOCALLY OBSERVED failure, so it keeps its reason: this is a fact
        // about our own request, not about the responder's consent posture.
        // The 403 case is deliberately no longer special-cased — 'Not permitted
        // by peer' restored, one field along, exactly the distinction
        // {@link PEER_ASK_PENDING} removes from the status word.
        return { askId, status: 'delivered', reason: `Peer error ${response.status}` };
      }

      return normalize(askId, (await response.json()) as unknown);
    } catch (error: unknown) {
      this.logger.warn(`peer call ${url} failed: ${String(error)}`);

      return { askId, status: 'delivered', reason: 'Peer unreachable' };
    }
  }
}

/**
 * Normalize a peer's response into what the ASKER'S box may know.
 *
 * The peer is NOT trusted to be well-behaved, so only recognized fields are
 * carried forward and anything that is not `answered` becomes `delivered` —
 * which also folds a legacy peer still sending `pending_review` or `declined`,
 * so an un-upgraded box on the other end degrades to the collapsed vocabulary
 * rather than reintroducing the oracle.
 *
 * THE PEER'S `reason` IS DROPPED, always. It is an attacker-supplied string,
 * and echoing it into the local UI is how a collapsed status gets undone one
 * field along — the precise mistake #2210 made and #2216 had to correct. Only a
 * reason this box wrote itself survives.
 */
function normalize(askId: string, raw: unknown): AskerVisiblePeerReply {
  const body = (raw ?? {}) as Partial<PeerAskResponse>;

  if (body.status !== 'answered' || body.answer == null) {
    return { askId, status: 'delivered' };
  }

  const answer = body.answer;

  return {
    askId,
    status: 'answered',
    answer: {
      form: answer.form,
      summary: typeof answer.summary === 'string' ? answer.summary : '',
      items: Array.isArray(answer.items) ? answer.items.slice(0, 200) : undefined,
      disclosedCount: numeric(answer.disclosedCount),
      withheldCount: numeric(answer.withheldCount),
      busy: Array.isArray(answer.busy) ? answer.busy.slice(0, 500) : undefined,
      free: Array.isArray(answer.free) ? answer.free.slice(0, 500) : undefined,
    },
  };
}

function numeric(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
