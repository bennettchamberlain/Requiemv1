import { gql } from '@/graphql';

/**
 * Every ask operation this page issues.
 *
 * Kept in one file so the wire surface is auditable at a glance: a consent
 * feature should make it easy to see exactly what the client asks the server
 * for, rather than scattering fragments across components.
 *
 * These are deliberately narrow. Several fields the design calls for do not
 * exist on the schema yet — a display NAME for either party, a trust TIER, an
 * `autoAnswered` discriminator, per-item LABELS, grant expiry — so the page
 * derives what it can and declines to assert the rest. See AsksPage.tsx.
 */

export const ASK_INBOX = gql(`
  query AskInbox {
    askInbox {
      id
      status
      createdAt
      consentBasis
      askerId
      peerHandle
      query {
        queryType
        dataClass
        prompt
      }
    }
  }
`);

export const ASK_OUTBOX = gql(`
  query AskOutbox {
    askOutbox {
      id
      status
      createdAt
      responderId
      peerHandle
      query {
        queryType
        dataClass
        prompt
      }
    }
  }
`);

/**
 * The standing-grant matrix.
 *
 * `revokedAt` is selected AND READ (see groupGrants): the server's
 * `listForOwner` filters revoked and lapsed rows out today, but a client that
 * renders a grant as live because it never looked is one resolver change away
 * from showing withdrawn consent as current.
 *
 * `expiresAt` and the computed `active` flag are NOT selected — not an
 * oversight. `AskGrantType` in the backend source carries both, but the
 * CHECKED-IN `schema.graphql` that codegen reads predates them, so naming
 * either here fails generation outright. The Grant Manager therefore cannot
 * show when a grant lapses, and says so rather than implying every grant is
 * permanent. Regenerating that schema is a backend change; add the fields here
 * the moment it lands.
 */
export const MY_ASK_GRANTS = gql(`
  query MyAskGrants {
    myAskGrants {
      id
      mode
      queryType
      dataClass
      purpose
      granteeId
      granteePeerLinkId
      revokedAt
      createdAt
    }
  }
`);

export const APPROVE_ASK = gql(`
  mutation ApproveAsk($id: ID!) {
    approveAsk(id: $id) {
      success
    }
  }
`);

export const DECLINE_ASK = gql(`
  mutation DeclineAsk($id: ID!) {
    declineAsk(id: $id) {
      success
    }
  }
`);

/**
 * Produce and disclose the answer.
 *
 * `disclosureForm` is the owner's "answer with less" choice and it MUST be on
 * the wire. The backend has accepted it for a while — `runAsk` clamps it with
 * `narrowerForm`, so the owner can cap a retrieval ask down to a yes/no but can
 * never widen one — and this document simply omitted the argument, which left
 * the entire disclosure ladder unreachable from the UI: every ask ran at
 * whatever form `inferAnswerForm` read out of the ASKER's own `queryType`. The
 * owner's only options were approve-in-full or decline.
 *
 * Note the type: `AnswerForm`, not `DisclosureRung`. See OWNER_ANSWER_FORMS in
 * askPresentation.ts for why the two ladders are not interchangeable.
 */
export const RUN_ASK = gql(`
  mutation RunAsk($id: ID!, $redactItemIds: [String!], $disclosureForm: AnswerForm) {
    runAsk(id: $id, redactItemIds: $redactItemIds, disclosureForm: $disclosureForm) {
      success
      disclosedCount
      withheldCount
    }
  }
`);

export const REVOKE_ASK_GRANT = gql(`
  mutation RevokeAskGrant($id: ID!) {
    revokeAskGrant(id: $id) {
      success
    }
  }
`);
