import { Injectable } from '@nestjs/common';

import { LoggerService } from '@ci/common/logging';
import config from '@ci/configuration';

import { type PeerLink } from '../entities/PeerLinkEntity';
import type { PeerAskBody, PeerAskResponse } from '../protocol';

/**
 * Sends an OUTBOUND ask to a peer Companion's `/agent/v1/ask`.
 *
 * The token is a CI-Portal-issued OIDC access token whose audience is the peer
 * box, so the peer can verify who is asking against its own peer links without
 * this box and that box sharing any secret. A peer that is slow, offline, or
 * hostile must not hang the caller, so every call is bounded by a timeout and
 * failures degrade to a `declined` response rather than throwing.
 */
@Injectable()
export class PeerAskClient {
  constructor(private readonly logger: LoggerService) {
    this.logger.setContext(PeerAskClient.name);
  }

  async send(peer: PeerLink, body: PeerAskBody, accessToken: string): Promise<PeerAskResponse> {
    const url = `${peer.memoryEndpoint.replace(/\/+$/, '')}/ask`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${accessToken}`,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(config.peers.timeoutMs ?? 10_000),
      });

      if (!response.ok) {
        this.logger.warn(`peer ask ${url} → ${response.status}`);

        return {
          askId: body.askId,
          status: 'declined',
          reason: response.status === 403 ? 'Not permitted by peer' : `Peer error ${response.status}`,
        };
      }

      return normalize(body.askId, (await response.json()) as unknown);
    } catch (error: unknown) {
      this.logger.warn(`peer ask ${url} failed: ${String(error)}`);

      return { askId: body.askId, status: 'declined', reason: 'Peer unreachable' };
    }
  }
}

/**
 * Normalize a peer's response. The peer is NOT trusted to be well-behaved, so
 * only recognized fields are carried forward and an unknown status degrades to
 * `declined` rather than being echoed into our own audit trail.
 */
function normalize(askId: string, raw: unknown): PeerAskResponse {
  const body = (raw ?? {}) as Partial<PeerAskResponse>;
  const status =
    body.status === 'answered' || body.status === 'pending_review' || body.status === 'declined'
      ? body.status
      : 'declined';

  if (status !== 'answered' || body.answer == null) {
    return { askId, status, reason: typeof body.reason === 'string' ? body.reason : undefined };
  }

  const answer = body.answer;

  return {
    askId,
    status,
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
