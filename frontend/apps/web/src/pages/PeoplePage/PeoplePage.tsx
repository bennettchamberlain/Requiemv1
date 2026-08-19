import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useMutation, useQuery } from '@apollo/client';
import { EmptyState, GlobalUID, LoadingPage, usePageTitle } from '@ci/common';
import { AlertDialog, Avatar, Badge, Button, Card, Input } from '@ci/shadcn';
import { Merge } from '@ci/shadcn/icons';
import { Link, useNavigate } from 'react-router-dom';

import { PageContent } from '@/components/layout';
import { MemoryHubShell } from '@/components/MemoryHub';
import { gql } from '@/graphql';
import type { GetMergeCandidatesQuery, GetPeopleQuery, GetPersonDuplicatesQuery } from '@/graphql/graphql';

// Matches MemoryPage's PAGE_SIZE. Keeping it small also keeps the batch handed
// to PersonInteractionStatsLoader small — that resolver aggregates over the
// `ci.communications` hypertable, and its cost scales with the id-array length.
export const PAGE_SIZE = 30;

const GET_PEOPLE = gql(`
  query GetPeople($query: String, $first: Int, $after: String) {
    people(query: $query, first: $first, after: $after) {
      totalCount
      pageInfo {
        hasNextPage
        endCursor
      }
      edges {
        cursor
        node {
          id
          name
          description
          firstName
          lastName
          avatarUrl
          birthDate
          isSelf
          identifiers {
            kind
            value
            rawValue
            label
          }
          interactionStats {
            eventCount
            communicationCount
            lastInteractionAt
          }
        }
      }
    }
  }
`);

const GET_PERSON_DUPLICATES = gql(`
  query GetPersonDuplicates($limit: Int, $offset: Int, $reasons: [String!]) {
    personDuplicates(limit: $limit, offset: $offset, reasons: $reasons) {
      totalCount
      hasMore
      groups {
        reason
        value
        totalPeople
        people {
          id
          name
          description
          avatarUrl
          isSelf
        }
      }
    }
  }
`);

// The duplicate-detection pipeline's own queue: pairs it scored, with the
// evidence behind each one. Separate from GET_PERSON_DUPLICATES, which
// recomputes cruder exact matches on every request.
const GET_MERGE_CANDIDATES = gql(`
  query GetMergeCandidates($first: Int, $after: String) {
    mergeCandidates(first: $first, after: $after) {
      totalCount
      pageInfo {
        hasNextPage
        endCursor
      }
      edges {
        cursor
        node {
          id
          score
          status
          detectedBy
          createdAt
          evidence {
            kind
            value
            score
          }
          people {
            id
            name
            description
            avatarUrl
            isSelf
          }
        }
      }
    }
  }
`);

const MERGE_PEOPLE = gql(`
  mutation MergePeople($input: MergePeopleInput!) {
    mergePeople(input: $input) {
      success
      person {
        id
        name
      }
    }
  }
`);

const REJECT_PERSON_DUPLICATES = gql(`
  mutation RejectPersonDuplicates($personIds: [ID!]!) {
    rejectPersonDuplicates(personIds: $personIds)
  }
`);

type PersonNode = GetPeopleQuery['people']['edges'][number]['node'];
type DuplicateGroup = GetPersonDuplicatesQuery['personDuplicates']['groups'][number];
type MergeCandidate = GetMergeCandidatesQuery['mergeCandidates']['edges'][number]['node'];
type MergablePerson = DuplicateGroup['people'][number];

/** Duplicate groups per page, and candidates per page. Both are "load more"-able. */
export const DUPLICATE_PAGE_SIZE = 25;
export const CANDIDATE_PAGE_SIZE = 20;

const DUPLICATE_REASONS = [
  { value: null, label: 'All' },
  { value: 'email', label: 'Email' },
  { value: 'phone', label: 'Phone' },
  { value: 'name', label: 'Name' },
] as const;

function resolveAvatarUrl(avatarUrl: string | null | undefined): string | undefined {
  if (!avatarUrl) {
    return undefined;
  }

  return /^https?:\/\//.test(avatarUrl) ? avatarUrl : `/static${avatarUrl}`;
}

function initialsFor(name: string | null | undefined): string {
  const trimmed = name?.trim();
  if (!trimmed) {
    return '?';
  }

  const parts = trimmed.split(/\s+/);

  return parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

function formatLastInteraction(value: string | Date | null | undefined): string | null {
  if (value == null) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toLocaleDateString();
}

function PersonRow({ person, onOpen }: { person: PersonNode; onOpen: () => void }) {
  const email = person.identifiers.find((identifier) => identifier.kind === 'email');
  const phone = person.identifiers.find((identifier) => identifier.kind === 'phone');
  // Prefer the raw form: `value` is the matching key (a phone normalizes to bare
  // digits), which reads as a mangled number in a contact list.
  const emailText = email?.rawValue?.trim() || email?.value;
  const phoneText = phone?.rawValue?.trim() || phone?.value;
  const lastSeen = formatLastInteraction(person.interactionStats.lastInteractionAt);

  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center gap-3 rounded-md border bg-card p-3 text-left transition hover:bg-accent"
    >
      <Avatar className="h-10 w-10 shrink-0">
        <Avatar.Image src={resolveAvatarUrl(person.avatarUrl)} alt={person.name ?? ''} />
        <Avatar.Fallback>{initialsFor(person.name)}</Avatar.Fallback>
      </Avatar>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium">{person.name || 'Unnamed'}</span>
          {person.isSelf && <Badge variant="secondary">You</Badge>}
        </div>

        <div className="truncate text-sm text-muted-foreground">
          {[emailText, phoneText, person.description].filter(Boolean).join(' · ') || '—'}
        </div>
      </div>

      <div className="hidden shrink-0 text-right text-sm text-muted-foreground sm:block">
        <div>
          {person.interactionStats.eventCount} events · {person.interactionStats.communicationCount} messages
        </div>
        {lastSeen && <div>Last seen {lastSeen}</div>}
      </div>
    </button>
  );
}

/**
 * One merge suggestion: a set of people, a heading explaining why they were put
 * together, and the two decisions the user can make about them.
 *
 * Shared by both producers of suggestions — the recomputed exact-match groups
 * and the pipeline's scored `ci.merge_candidates` pairs — because the decision
 * is identical either way: merge the set into one target, or record that these
 * are different people so it is never proposed again.
 */
function MergeSuggestionCard({
  people,
  heading,
  note,
  onMerged,
}: {
  people: readonly MergablePerson[];
  heading: ReactNode;
  note?: ReactNode;
  onMerged: () => Promise<unknown>;
}) {
  const [mergePeople, { loading }] = useMutation(MERGE_PEOPLE);
  const [rejectDuplicates, { loading: rejecting }] = useMutation(REJECT_PERSON_DUPLICATES);
  const [pendingTargetId, setPendingTargetId] = useState<string | null>(null);
  const [mergeError, setMergeError] = useState<string | null>(null);

  // The self person (if present) is always the preferred merge target — the
  // backend refuses to merge it away, so when the group contains "You" the
  // other members must not be offered as targets.
  const orderedPeople = useMemo(
    () => [...people].sort((a, b) => Number(b.isSelf) - Number(a.isSelf)),
    [people],
  );
  const hasSelf = orderedPeople.some((person) => person.isSelf);
  const defaultTargetId = orderedPeople.find((person) => person.isSelf)?.id ?? orderedPeople[0]?.id ?? null;

  const merge = async (targetId: string) => {
    const sourceIds = people.map((person) => person.id).filter((id) => id !== targetId);

    try {
      await mergePeople({ variables: { input: { targetId, sourceIds } } });
      setPendingTargetId(null);
      setMergeError(null);
      await onMerged();
    } catch (error) {
      // Keep the dialog open and show what went wrong instead of silently
      // closing on failure.
      setMergeError(error instanceof Error ? error.message : 'The merge failed. Please try again.');
    }
  };

  // Saying "not the same" has to STICK. Duplicate groups are recomputed from
  // identifiers on every load, so without recording the rejection this exact
  // group would be proposed again immediately. The same call also stamps the
  // pipeline's candidate row, so the scored queue shrinks as it is worked.
  const reject = async () => {
    try {
      await rejectDuplicates({ variables: { personIds: people.map((person) => person.id) } });
      setMergeError(null);
      await onMerged();
    } catch (error) {
      setMergeError(error instanceof Error ? error.message : 'Could not record that. Please try again.');
    }
  };

  const pendingTarget = orderedPeople.find((person) => person.id === pendingTargetId);
  const openMerge = (targetId: string) => {
    setMergeError(null);
    setPendingTargetId(targetId);
  };

  return (
    <div className="rounded-md border p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">{heading}</div>

      {note && <div className="mb-2 text-xs text-muted-foreground">{note}</div>}

      <div className="flex flex-col gap-2">
        {orderedPeople.map((person) => (
          <div key={person.id} className="flex items-center gap-3">
            <Avatar className="h-8 w-8 shrink-0">
              <Avatar.Image src={resolveAvatarUrl(person.avatarUrl)} alt={person.name ?? ''} />
              <Avatar.Fallback>{initialsFor(person.name)}</Avatar.Fallback>
            </Avatar>

            <div className="min-w-0 flex-1">
              <Link
                to={`/people/${GlobalUID.parse('person', person.id)}`}
                className="truncate font-medium hover:underline"
              >
                {person.name || 'Unnamed'}
              </Link>
              {person.isSelf && (
                <Badge variant="secondary" className="ml-2">
                  You
                </Badge>
              )}
              {person.description && (
                <div className="truncate text-sm text-muted-foreground">{person.description}</div>
              )}
            </div>

            {(!hasSelf || person.isSelf) && (
              <Button
                size="sm"
                variant="ghost"
                disabled={loading}
                onClick={() => {
                  openMerge(person.id);
                }}
              >
                Use as the kept person
              </Button>
            )}
          </div>
        ))}
      </div>

      {/* The other half of the decision. Without it the only way to clear a
          wrong suggestion is to merge people who are not the same, and the
          group returns on every load. */}
      <div className="mt-3 flex flex-wrap items-center justify-end gap-3 border-t pt-2">
        {mergeError && !pendingTargetId && <span className="text-sm text-destructive">{mergeError}</span>}
        <Button size="sm" variant="ghost" disabled={loading || rejecting} onClick={() => void reject()}>
          {rejecting ? 'Saving…' : 'Not the same person'}
        </Button>
        <Button
          size="sm"
          disabled={loading || defaultTargetId == null}
          onClick={() => {
            if (defaultTargetId != null) {
              openMerge(defaultTargetId);
            }
          }}
        >
          Merge into one person
        </Button>
      </div>

      <AlertDialog
        open={pendingTargetId != null}
        onOpenChange={(open) => {
          if (!open) {
            setPendingTargetId(null);
          }
        }}
      >
        <AlertDialog.Content>
          <AlertDialog.Header>
            <AlertDialog.Title>Merge into one person?</AlertDialog.Title>
            <AlertDialog.Description>
              {`Events, messages, and contact methods from the other ${people.length - 1 === 1 ? 'person' : `${people.length - 1} people`} will move onto "${pendingTarget?.name || 'Unnamed'}"${pendingTarget?.isSelf ? ' (You)' : ''}. This folds multi-platform stubs into one Person and cannot be undone from the UI.`}
            </AlertDialog.Description>
          </AlertDialog.Header>
          {mergeError && <div className="text-sm text-destructive">{mergeError}</div>}
          <AlertDialog.Footer>
            <AlertDialog.Cancel disabled={loading}>Cancel</AlertDialog.Cancel>
            <AlertDialog.Action
              disabled={loading || pendingTargetId == null}
              onClick={(e) => {
                // Radix auto-closes on Action click; keep the dialog open so a
                // failure (or the in-flight state) stays visible.
                e.preventDefault();
                if (pendingTargetId != null) {
                  void merge(pendingTargetId);
                }
              }}
            >
              {loading ? 'Merging…' : 'Merge into one person'}
            </AlertDialog.Action>
          </AlertDialog.Footer>
        </AlertDialog.Content>
      </AlertDialog>
    </div>
  );
}

function DuplicateGroupCard({
  group,
  onMerged,
}: {
  group: DuplicateGroup;
  onMerged: () => Promise<unknown>;
}) {
  // A group can be truncated (six members of a value shared by hundreds); say
  // so rather than implying the merge would cover all of them.
  const truncated = group.totalPeople > group.people.length;

  return (
    <MergeSuggestionCard
      people={group.people}
      onMerged={onMerged}
      heading={
        <>
          <Merge className="h-4 w-4" />
          <span>
            Same {group.reason === 'name' ? 'name' : group.reason}:{' '}
            <span className="font-medium text-foreground">{group.value}</span>
          </span>
        </>
      }
      note={
        truncated
          ? `Showing ${group.people.length} of ${group.totalPeople} people sharing this ${group.reason} — merging affects only the ${group.people.length} shown.`
          : null
      }
    />
  );
}

/** A scored pair from `ci.merge_candidates`, with the evidence behind it. */
function MergeCandidateCard({
  candidate,
  onMerged,
}: {
  candidate: MergeCandidate;
  onMerged: () => Promise<unknown>;
}) {
  return (
    <MergeSuggestionCard
      people={candidate.people}
      onMerged={onMerged}
      heading={
        <>
          <Merge className="h-4 w-4" />
          <Badge variant="secondary">{Math.round(candidate.score * 100)}% match</Badge>
          {candidate.evidence.map((item, index) => (
            <span key={`${item.kind}:${item.value}:${index}`}>
              Same {item.kind}: <span className="font-medium text-foreground">{item.value}</span>
            </span>
          ))}
          {candidate.evidence.length === 0 && <span>Proposed as the same person</span>}
        </>
      }
      note={`Detected by ${candidate.detectedBy}`}
    />
  );
}

export function PeoplePage() {
  usePageTitle('People & communications - Companion Intelligence');

  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');

  const { data, previousData, loading, error, refetch, fetchMore } = useQuery(GET_PEOPLE, {
    variables: { query: searchQuery.trim() === '' ? null : searchQuery.trim(), first: PAGE_SIZE },
    notifyOnNetworkStatusChange: true,
  });
  // Which kind of duplicate group to show. The page used to ask for an
  // unfiltered top 25, ordered so email and phone groups always won — with
  // thousands of name groups behind them, they were unreachable.
  const [duplicateReason, setDuplicateReason] = useState<string | null>(null);
  // Pages fetched, not groups rendered: the server drops rejected pairs from a
  // page AFTER applying OFFSET, so counting the groups on screen would walk the
  // offset backwards and re-request rows already seen.
  const [duplicatePages, setDuplicatePages] = useState(1);
  const {
    data: duplicatesData,
    error: duplicatesError,
    refetch: refetchDuplicates,
    fetchMore: fetchMoreDuplicates,
  } = useQuery(GET_PERSON_DUPLICATES, {
    variables: {
      limit: DUPLICATE_PAGE_SIZE,
      offset: 0,
      reasons: duplicateReason == null ? null : [duplicateReason],
    },
    notifyOnNetworkStatusChange: true,
  });

  // The scored queue the duplicate-detection pipeline has been filling.
  const {
    data: candidatesData,
    error: candidatesError,
    refetch: refetchCandidates,
    fetchMore: fetchMoreCandidates,
  } = useQuery(GET_MERGE_CANDIDATES, {
    variables: { first: CANDIDATE_PAGE_SIZE },
    notifyOnNetworkStatusChange: true,
  });

  // Keep the previous result on screen while a new query variable is in
  // flight — swapping to a full-page loader would unmount the search input and
  // drop focus on the first keystroke of every new query.
  const view = data ?? previousData;
  // Trust PersonService.findAll's order (plausible-name first, then name, then
  // recency — see PERSON_NAME_LOOKS_IMPLAUSIBLE_SQL) rather than re-sorting here.
  // A client-side sort keyed on interaction recency would fight that: the exact
  // rows the server demotes (bare digit-strings, call-log-heading leftovers) are
  // typically call-log stubs, so they carry a *recent*
  // interactionStats.lastInteractionAt, while a freshly-imported real contact
  // may have none at all — a recency sort would put the garbage name right back
  // on top of the list, reintroducing the bug the backend ordering fixed.
  const people = useMemo(() => (view?.people.edges ?? []).map((edge) => edge.node), [view]);
  const duplicates = duplicatesData?.personDuplicates;
  const duplicateGroups = duplicates?.groups ?? [];
  const mergeCandidates = useMemo(
    () => (candidatesData?.mergeCandidates.edges ?? []).map((edge) => edge.node),
    [candidatesData],
  );
  const candidatesPageInfo = candidatesData?.mergeCandidates.pageInfo;

  // Append the next page of duplicate groups. Offset-based: the groups are
  // recomputed per request and have no stable cursor, and the server order is
  // deterministic (reason, then size, then value).
  const loadMoreDuplicates = () => {
    setDuplicatePages((pages) => pages + 1);

    void fetchMoreDuplicates({
      variables: { offset: duplicatePages * DUPLICATE_PAGE_SIZE },
      updateQuery: (prev, { fetchMoreResult }) => {
        if (!fetchMoreResult?.personDuplicates) {
          return prev;
        }

        const seen = new Set(
          (prev.personDuplicates?.groups ?? []).map((group) => `${group.reason}:${group.value}`),
        );

        return {
          personDuplicates: {
            ...fetchMoreResult.personDuplicates,
            groups: [
              ...(prev.personDuplicates?.groups ?? []),
              ...fetchMoreResult.personDuplicates.groups.filter(
                (group) => !seen.has(`${group.reason}:${group.value}`),
              ),
            ],
          },
        };
      },
    });
  };

  const loadMoreCandidates = () =>
    void fetchMoreCandidates({
      variables: { after: candidatesPageInfo?.endCursor },
      updateQuery: (prev, { fetchMoreResult }) => {
        if (!fetchMoreResult?.mergeCandidates) {
          return prev;
        }

        const prevEdges = prev.mergeCandidates?.edges ?? [];
        const seen = new Set(prevEdges.map((edge) => edge.cursor));

        return {
          mergeCandidates: {
            ...fetchMoreResult.mergeCandidates,
            edges: [
              ...prevEdges,
              ...fetchMoreResult.mergeCandidates.edges.filter((edge) => !seen.has(edge.cursor)),
            ],
          },
        };
      },
    });

  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const pageInfo = view?.people.pageInfo;
  const hasNextPage = pageInfo?.hasNextPage ?? false;
  const totalCount = view?.people.totalCount ?? 0;

  // Append the next server page (cursor-based) onto the accumulated results.
  const loadMore = useCallback(() => {
    if (!hasNextPage || loadingMore || loadMoreError != null || !pageInfo?.endCursor) {
      return;
    }

    setLoadingMore(true);

    fetchMore({
      variables: { after: pageInfo.endCursor },
      updateQuery: (prev, { fetchMoreResult }) => {
        if (!fetchMoreResult?.people) {
          return prev;
        }

        const prevEdges = prev.people?.edges ?? [];
        const seen = new Set(prevEdges.map((edge) => edge.cursor));
        const nextEdges = fetchMoreResult.people.edges.filter((edge) => !seen.has(edge.cursor));

        return {
          people: {
            ...fetchMoreResult.people,
            edges: [...prevEdges, ...nextEdges],
          },
        };
      },
    })
      .catch((cause: unknown) => {
        // fetchMore rejects on network/GraphQL errors, and an unhandled rejection
        // is only half the problem: the sentinel is still on screen, so clearing
        // `loadingMore` would rebuild the observer, which re-fires immediately on
        // observe() and spins a request loop (measured at ~220 requests in 300ms
        // against a persistently failing page). Latch the error instead — it
        // unmounts the sentinel and gates `loadMore` until the user retries.
        setLoadMoreError(cause instanceof Error ? cause.message : 'Something went wrong.');
      })
      .finally(() => setLoadingMore(false));
  }, [fetchMore, hasNextPage, loadingMore, loadMoreError, pageInfo?.endCursor]);

  // Fetch the next server page when the sentinel scrolls into view.
  useEffect(() => {
    const sentinel = sentinelRef.current;

    if (!sentinel || !hasNextPage) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          loadMore();
        }
      },
      { root: scrollRef.current, rootMargin: '400px' },
    );

    observer.observe(sentinel);

    return () => observer.disconnect();
  }, [hasNextPage, loadMore]);

  const onMerged = async () => Promise.all([refetch(), refetchDuplicates(), refetchCandidates()]);

  let content: ReactNode | null = null;

  if (loading && view == null) {
    content = <LoadingPage />;
  } else if (error && view == null) {
    content = <EmptyState message={`Couldn't load people: ${error.message}`} />;
  } else {
    content = (
      <PageContent ref={scrollRef} className="gap-4 p-0">
        <MemoryHubShell>
          <div className="flex flex-col gap-4 px-4 pb-4">
            <div className="flex items-center gap-2">
              <Input
                placeholder="Search people and communications..."
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  // New query, new cursor space — a stale failure must not gate it.
                  setLoadMoreError(null);
                }}
                className="max-w-xl flex-1"
              />
              <div className="text-sm text-muted-foreground">{totalCount} people</div>
            </div>

            {candidatesError && (
              <div className="text-sm text-muted-foreground">
                Suggested merges are unavailable right now ({candidatesError.message}).
              </div>
            )}

            {mergeCandidates.length > 0 && (
              <Card>
                <Card.Header>
                  <Card.Title className="flex items-center gap-2 text-base">
                    <Merge className="h-4 w-4" />
                    Suggested merges
                    <Badge variant="secondary">{candidatesData?.mergeCandidates.totalCount ?? 0}</Badge>
                  </Card.Title>
                  <Card.Description>
                    Pairs the duplicate detector scored, strongest match first. Each one shows the evidence
                    behind it.
                  </Card.Description>
                </Card.Header>
                <Card.Content className="flex flex-col gap-3">
                  {mergeCandidates.map((candidate) => (
                    <MergeCandidateCard key={candidate.id} candidate={candidate} onMerged={onMerged} />
                  ))}

                  {candidatesPageInfo?.hasNextPage && (
                    <div className="flex justify-center">
                      <Button variant="outline" size="sm" onClick={loadMoreCandidates}>
                        Load more suggestions
                      </Button>
                    </div>
                  )}

                  <div className="text-center text-xs text-muted-foreground">
                    {mergeCandidates.length} of {candidatesData?.mergeCandidates.totalCount ?? 0} shown
                  </div>
                </Card.Content>
              </Card>
            )}

            {duplicatesError && (
              <div className="text-sm text-muted-foreground">
                Duplicate suggestions are unavailable right now ({duplicatesError.message}).
              </div>
            )}

            {(duplicateGroups.length > 0 || duplicateReason != null) && (
              <Card>
                <Card.Header>
                  <Card.Title className="flex items-center gap-2 text-base">
                    <Merge className="h-4 w-4" />
                    Possible duplicates
                    <Badge variant="secondary">{duplicates?.totalCount ?? 0}</Badge>
                  </Card.Title>
                  <Card.Description>
                    These people share an email, phone number or name. Review and merge the ones that are the
                    same person.
                  </Card.Description>
                  <div className="flex flex-wrap items-center gap-2 pt-2">
                    {DUPLICATE_REASONS.map((option) => (
                      <Button
                        key={option.label}
                        size="sm"
                        variant={duplicateReason === option.value ? 'secondary' : 'ghost'}
                        onClick={() => {
                          // New filter, new offset space — a stale page count
                          // would start the next "load more" mid-list.
                          setDuplicatePages(1);
                          setDuplicateReason(option.value);
                        }}
                      >
                        {option.label}
                      </Button>
                    ))}
                  </div>
                </Card.Header>
                <Card.Content className="flex flex-col gap-3">
                  {duplicateGroups.length === 0 ? (
                    <div className="py-2 text-sm text-muted-foreground">
                      No duplicate groups match this filter.
                    </div>
                  ) : (
                    duplicateGroups.map((group) => (
                      <DuplicateGroupCard
                        key={`${group.reason}:${group.value}`}
                        group={group}
                        onMerged={onMerged}
                      />
                    ))
                  )}

                  {duplicates?.hasMore && (
                    <div className="flex justify-center">
                      <Button variant="outline" size="sm" onClick={loadMoreDuplicates}>
                        Load more duplicate groups
                      </Button>
                    </div>
                  )}

                  <div className="text-center text-xs text-muted-foreground">
                    {duplicateGroups.length} of {duplicates?.totalCount ?? 0} groups shown
                  </div>
                </Card.Content>
              </Card>
            )}

            {people.length === 0 ? (
              <EmptyState message="No people found" />
            ) : (
              <>
                <div className="flex flex-col gap-2">
                  {people.map((person) => (
                    <PersonRow
                      key={person.id}
                      person={person}
                      onOpen={() => navigate(`/people/${GlobalUID.parse('person', person.id)}`)}
                    />
                  ))}
                </div>

                {hasNextPage && loadMoreError == null && <div ref={sentinelRef} className="h-8" />}

                {loadMoreError != null && (
                  <div className="flex flex-col items-center gap-2 py-3">
                    <div className="text-sm text-muted-foreground">
                      Couldn&apos;t load more people: {loadMoreError}
                    </div>
                    <Button variant="outline" size="sm" onClick={() => setLoadMoreError(null)}>
                      Try again
                    </Button>
                  </div>
                )}

                <div className="py-3 text-center text-xs text-muted-foreground">
                  {people.length} of {totalCount} loaded
                  {loadingMore ? ' · loading…' : hasNextPage ? '' : ' · end'}
                </div>
              </>
            )}
          </div>
        </MemoryHubShell>
      </PageContent>
    );
  }

  return <>{content}</>;
}
