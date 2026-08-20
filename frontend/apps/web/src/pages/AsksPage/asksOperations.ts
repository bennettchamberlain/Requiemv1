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

export const RUN_ASK = gql(`
  mutation RunAsk($id: ID!, $redactItemIds: [String!]) {
    runAsk(id: $id, redactItemIds: $redactItemIds) {
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
