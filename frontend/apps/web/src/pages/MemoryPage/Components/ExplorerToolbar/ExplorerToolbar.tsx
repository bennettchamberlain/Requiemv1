import { useEffect, useMemo, useState } from 'react';

import { useMutation } from '@apollo/client';
import { ENTITY_TYPE_MAP } from '@ci/common/src/constants';
import {
  Badge,
  Button,
  Calendar,
  Dialog,
  Input,
  Label,
  Popover,
  Select,
  Tooltip,
  cn,
  useToast,
} from '@ci/shadcn';
import {
  ArrowUpDown,
  Calendar as CalendarIcon,
  ChevronDown,
  Clock,
  Filter,
  MapPin,
  Save,
  Scan,
  Search,
  Share2,
  Sparkles,
  Tag,
  Users,
  X,
} from '@ci/shadcn/icons';
import { useSearchParams } from 'react-router-dom';

import { useFeatures } from '@/common/feature';
import { ConnectorFilter } from '@/components/SearchBox/ConnectorFilter';
import { EntityTypeFilter } from '@/components/SearchBox/EntityTypeFilter';
import { isFilterDrag, readFilterDrag, type FilterDragKind } from '@/components/SearchBox/filterDrag';
import { DropdownProvider, useDropdown } from '@/components/SearchBox/useDropdown';
import { gql, type FragmentType } from '@/graphql';

import type { SavedSearchGridItemFragment } from '../../../SavedSearchesPage/SavedSearch';
import { ShareSavedSearchModal } from '../../../SavedSearchesPage/ShareSavedSearchModal';
import { buildSavedSearchFilters } from '../../savedSearchFilters';

import { ActiveFilterChips, countActiveFilters } from './ActiveFilterChips';

// Single-select sort presets that map to the backend's sortBy + sortOrder pair.
const SORT_OPTIONS = [
  { value: 'default', label: 'Default', sortBy: '', sortOrder: '' },
  { value: 'relevance', label: 'Relevance', sortBy: 'relevance', sortOrder: 'desc' },
  { value: 'newest', label: 'Newest first', sortBy: 'time', sortOrder: 'desc' },
  { value: 'oldest', label: 'Oldest first', sortBy: 'time', sortOrder: 'asc' },
  { value: 'name-asc', label: 'Name (A–Z)', sortBy: 'name', sortOrder: 'asc' },
  { value: 'name-desc', label: 'Name (Z–A)', sortBy: 'name', sortOrder: 'desc' },
] as const;

const START_OF_DAY_TIME = '00:00';
const END_OF_DAY_TIME = '23:59';

const CREATE_SAVED_SEARCH = gql(`
  mutation CreateSavedSearch($input: CreateSavedSearchInput!) {
    createSavedSearch(input: $input) {
      success
      savedSearch {
        id
        # Full grid fragment (incl. isPublic/shareToken/filters) so the created
        # search can be handed straight to the share modal from "Save & share".
        ...SavedSearchGridItemFragment
      }
    }
  }
`);

function localDateInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

function dateInputValue(value: string): string {
  if (!value) {
    return '';
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return localDateInputValue(date);
}

function timeInputValue(value: string, fallback: string): string {
  if (!value) {
    return fallback;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return fallback;
  }

  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function isCompleteTimeValue(value: string): boolean {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);

  return Boolean(match);
}

function dateTimeIso(dateValue: string, timeValue: string, mode: 'start' | 'end'): string | undefined {
  if (!dateValue) {
    return undefined;
  }

  const [year, month, day] = dateValue.split('-').map(Number);
  const [hours, minutes] = timeValue.split(':').map(Number);

  if ([year, month, day, hours, minutes].some((part) => !Number.isFinite(part))) {
    return undefined;
  }

  const date = new Date(
    year,
    month - 1,
    day,
    hours,
    minutes,
    mode === 'end' ? 59 : 0,
    mode === 'end' ? 999 : 0,
  );

  if (!Number.isFinite(date.getTime())) {
    return undefined;
  }

  return date.toISOString();
}

function rangeHasDetailedTime(dateFrom: string, dateTo: string): boolean {
  const fromHasTime = Boolean(dateFrom) && timeInputValue(dateFrom, START_OF_DAY_TIME) !== START_OF_DAY_TIME;
  const toHasTime = Boolean(dateTo) && timeInputValue(dateTo, END_OF_DAY_TIME) !== END_OF_DAY_TIME;

  return fromHasTime || toHasTime;
}

function formatDateLabel(dateFrom: string, dateTo: string): string {
  const includeTime = rangeHasDetailedTime(dateFrom, dateTo);
  const fmt = (value: string) => {
    const date = new Date(value);
    const dateLabel = date.toLocaleDateString();

    if (!includeTime) {
      return dateLabel;
    }

    return `${dateLabel}, ${date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
  };

  if (dateFrom && dateTo) {
    return `${fmt(dateFrom)} – ${fmt(dateTo)}`;
  }

  if (dateFrom) {
    return `After ${fmt(dateFrom)}`;
  }

  if (dateTo) {
    return `Before ${fmt(dateTo)}`;
  }

  return 'Any time';
}

function normalizeFilterValue(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function filterValueKey(value: string): string {
  return normalizeFilterValue(value).toLocaleLowerCase();
}

function validatePersonFilterValue(value: string): string | null {
  const normalized = normalizeFilterValue(value);

  if (!normalized) {
    return 'Enter a name first.';
  }

  if (normalized.includes(',')) {
    return 'Names cannot include commas.';
  }

  if (normalized.length < 2) {
    return 'Use at least 2 characters.';
  }

  if (normalized.length > 80) {
    return 'Keep names under 80 characters.';
  }

  return null;
}

function validateTagFilterValue(value: string): string | null {
  const normalized = normalizeFilterValue(value);

  if (!normalized) {
    return 'Drop a tag first.';
  }

  if (normalized.includes(',')) {
    return 'Tags cannot include commas.';
  }

  if (normalized.length > 80) {
    return 'Keep tags under 80 characters.';
  }

  return null;
}

function validatePlaceFilterValue(value: string): string | null {
  const normalized = normalizeFilterValue(value);

  if (!normalized) {
    return 'Search for a place first.';
  }

  if (normalized.includes(',')) {
    return 'Place filters cannot include commas.';
  }

  if (normalized.length < 2) {
    return 'Use at least 2 characters.';
  }

  if (normalized.length > 120) {
    return 'Keep place names under 120 characters.';
  }

  return null;
}

function writeCsvFilterParam(params: URLSearchParams, key: string, next: string[]) {
  const normalized = next.map(normalizeFilterValue).filter(Boolean);

  if (normalized.length === 0) {
    params.delete(key);
  } else {
    params.set(key, normalized.join(','));
  }
}

// One filter dimension the drop area can receive: which URL param it writes,
// its chip icon, and the validator for a dropped name.
const DROP_FILTER_KINDS: Record<
  FilterDragKind,
  { param: string; icon: typeof Users; validate: (value: string) => string | null }
> = {
  person: { param: 'people', icon: Users, validate: validatePersonFilterValue },
  place: { param: 'places', icon: MapPin, validate: validatePlaceFilterValue },
  tag: { param: 'tags', icon: Tag, validate: validateTagFilterValue },
};

/**
 * The drag-and-drop filter area. Person, place, and tag rows in the header
 * search box's live results are draggable (see SearchBox/results/*Result);
 * dropping one here adds it to the matching filter (`people` / `places` /
 * `tags` URL param, unchanged). Selections render as removable chips inside
 * the area, joined by the When picker's date range so every applied drawer
 * filter reads from one place.
 */
function FilterDropArea() {
  const [searchParams, setSearchParams] = useSearchParams();
  const selections = useMemo(() => {
    const read = (param: string) =>
      searchParams.get(param)?.split(',').map(normalizeFilterValue).filter(Boolean) ?? [];

    return { person: read('people'), place: read('places'), tag: read('tags') };
  }, [searchParams]);
  // The date range also renders here as a chip — the drop area is the single
  // home for the drawer's applied filters — even though it's set via the When
  // picker rather than dragged in.
  const dateFrom = searchParams.get('from') ?? '';
  const dateTo = searchParams.get('to') ?? '';
  const hasDateRange = Boolean(dateFrom || dateTo);
  const hasSelections = hasDateRange || Object.values(selections).some((values) => values.length > 0);
  const [error, setError] = useState<string | null>(null);
  // Counts nested dragenter/dragleave pairs so the highlight doesn't flicker
  // off while an entity is dragged across the chips inside the drop area.
  const [dragDepth, setDragDepth] = useState(0);
  const isDropTarget = dragDepth > 0;

  const write = (kind: FilterDragKind, next: string[]) => {
    setSearchParams((params) => {
      writeCsvFilterParam(params, DROP_FILTER_KINDS[kind].param, next);

      return params;
    });
  };

  const remove = (kind: FilterDragKind, name: string) => {
    const key = filterValueKey(name);

    write(
      kind,
      selections[kind].filter((value) => filterValueKey(value) !== key),
    );
    setError(null);
  };

  const add = (kind: FilterDragKind, rawName: string) => {
    const validation = DROP_FILTER_KINDS[kind].validate(rawName);

    if (validation) {
      setError(validation);

      return;
    }

    // Tag labels are canonically lowercase (the backend lowercases on create).
    const normalized =
      kind === 'tag' ? normalizeFilterValue(rawName).toLocaleLowerCase() : normalizeFilterValue(rawName);

    if (selections[kind].some((value) => filterValueKey(value) === filterValueKey(normalized))) {
      setError(`${normalized} is already selected.`);

      return;
    }

    write(kind, [...selections[kind], normalized]);
    setError(null);
  };

  const DropIcon = isDropTarget ? Scan : Filter;
  const dropText = isDropTarget
    ? 'Drop to add'
    : 'Drag a person, place, or tag from the search results here to filter';

  return (
    <div className="flex flex-col gap-1.5">
      <div
        aria-label="Filter drop area"
        onDragEnter={(event) => {
          if (isFilterDrag(event)) {
            event.preventDefault();
            setDragDepth((depth) => depth + 1);
          }
        }}
        onDragOver={(event) => {
          if (isFilterDrag(event)) {
            event.preventDefault();
            event.dataTransfer.dropEffect = 'copy';
          }
        }}
        onDragLeave={(event) => {
          if (isFilterDrag(event)) {
            setDragDepth((depth) => Math.max(0, depth - 1));
          }
        }}
        onDrop={(event) => {
          if (!isFilterDrag(event)) {
            return;
          }

          event.preventDefault();
          setDragDepth(0);

          const payload = readFilterDrag(event);

          if (payload) {
            add(payload.kind, payload.name);
          }
        }}
        className={cn(
          'flex min-h-24 select-none rounded-lg border-8 p-2 transition-colors',
          isDropTarget && 'border-primary/40 bg-accent/40',
        )}
      >
        {hasSelections ? (
          <div className="flex flex-wrap content-start gap-1.5">
            {(Object.keys(DROP_FILTER_KINDS) as FilterDragKind[]).flatMap((kind) => {
              const KindIcon = DROP_FILTER_KINDS[kind].icon;

              return selections[kind].map((name) => (
                <Badge key={`${kind}:${name}`} variant="secondary" className="h-fit max-w-full gap-1.5 pl-2">
                  <KindIcon className="h-3 w-3 shrink-0 text-muted-foreground" />
                  <span className="max-w-[180px] truncate">{kind === 'tag' ? `#${name}` : name}</span>
                  <button
                    type="button"
                    onClick={() => remove(kind, name)}
                    aria-label={`Remove ${name}`}
                    className="-mr-1 rounded p-0.5 hover:bg-background/60"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ));
            })}
            {hasDateRange && (
              <Badge variant="secondary" className="h-fit max-w-full gap-1.5 pl-2">
                <CalendarIcon className="h-3 w-3 shrink-0 text-muted-foreground" />
                <span className="max-w-[220px] truncate">{formatDateLabel(dateFrom, dateTo)}</span>
                <button
                  type="button"
                  onClick={() =>
                    setSearchParams((params) => {
                      params.delete('from');
                      params.delete('to');

                      return params;
                    })
                  }
                  aria-label="Remove date range"
                  className="-mr-1 rounded p-0.5 hover:bg-background/60"
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            )}
          </div>
        ) : (
          // pointer-events-none keeps the icon swap from firing its own
          // dragenter/dragleave and corrupting the depth counter mid-drag.
          <div className="pointer-events-none flex flex-1 flex-col items-center justify-center gap-2 text-muted-foreground">
            <DropIcon className="h-6 w-6" strokeWidth={1.5} />
            <div className="text-sm">{dropText}</div>
          </div>
        )}
      </div>
      {error && (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/** A boolean URL flag rendered as a toggle button (used for located-only / semantic). */
function ToggleChip({ param, label, icon }: { param: string; label: string; icon: React.ReactNode }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const active = searchParams.get(param) === '1';

  return (
    <Button
      type="button"
      variant={active ? 'secondary' : 'outline'}
      onClick={() =>
        setSearchParams((params) => {
          if (active) {
            params.delete(param);
          } else {
            params.set(param, '1');
          }

          return params;
        })
      }
    >
      {icon}
      <span className="ml-1">{label}</span>
    </Button>
  );
}

/** Date-range picker bound to the `from`/`to` URL params. */
function DateControl() {
  const [{ dateFrom, dateTo }, { setDateRange }] = useDropdown();
  const [timeExpanded, setTimeExpanded] = useState(() => rangeHasDetailedTime(dateFrom, dateTo));

  const selectedRange =
    dateFrom || dateTo
      ? { from: dateFrom ? new Date(dateFrom) : undefined, to: dateTo ? new Date(dateTo) : undefined }
      : undefined;
  const fromDateValue = dateInputValue(dateFrom);
  const toDateValue = dateInputValue(dateTo);
  const fromTimeValue = timeInputValue(dateFrom, START_OF_DAY_TIME);
  const toTimeValue = timeInputValue(dateTo, END_OF_DAY_TIME);
  const [draftFromTime, setDraftFromTime] = useState(fromTimeValue);
  const [draftToTime, setDraftToTime] = useState(toTimeValue);

  useEffect(() => {
    if (rangeHasDetailedTime(dateFrom, dateTo)) {
      setTimeExpanded(true);
    }
  }, [dateFrom, dateTo]);

  useEffect(() => {
    setDraftFromTime(fromTimeValue);
    setDraftToTime(toTimeValue);
  }, [fromTimeValue, toTimeValue]);

  const applyTime = (part: 'from' | 'to', value: string) => {
    const normalizedValue = value || (part === 'from' ? START_OF_DAY_TIME : END_OF_DAY_TIME);
    const nextFromTime = part === 'from' ? normalizedValue : draftFromTime;
    const nextToTime = part === 'to' ? normalizedValue : draftToTime;
    const nextFrom = fromDateValue ? dateTimeIso(fromDateValue, nextFromTime, 'start') : undefined;
    const nextTo = toDateValue ? dateTimeIso(toDateValue, nextToTime, 'end') : undefined;

    if ((fromDateValue && !nextFrom) || (toDateValue && !nextTo)) {
      return;
    }

    setDateRange(nextFrom, nextTo);
  };

  const handleTimeChange = (part: 'from' | 'to', value: string) => {
    if (part === 'from') {
      setDraftFromTime(value);
    } else {
      setDraftToTime(value);
    }

    if (isCompleteTimeValue(value)) {
      applyTime(part, value);
    }
  };

  const commitTime = (part: 'from' | 'to', value: string) => {
    const fallback = part === 'from' ? START_OF_DAY_TIME : END_OF_DAY_TIME;
    const nextValue = isCompleteTimeValue(value) ? value : fallback;

    if (part === 'from') {
      setDraftFromTime(nextValue);
    } else {
      setDraftToTime(nextValue);
    }

    applyTime(part, nextValue);
  };

  const clearDetailedTime = () => {
    setTimeExpanded(false);
    setDraftFromTime(START_OF_DAY_TIME);
    setDraftToTime(END_OF_DAY_TIME);
    setDateRange(
      fromDateValue ? dateTimeIso(fromDateValue, START_OF_DAY_TIME, 'start') : undefined,
      toDateValue ? dateTimeIso(toDateValue, END_OF_DAY_TIME, 'end') : undefined,
    );
  };

  return (
    <Popover>
      <Popover.Trigger asChild>
        <Button variant="outline">
          <CalendarIcon className="mr-2 h-4 w-4 text-muted-foreground" />
          When: {dateFrom || dateTo ? formatDateLabel(dateFrom, dateTo) : 'all'}
          <ChevronDown className="ml-2 h-4 w-4 opacity-50" />
        </Button>
      </Popover.Trigger>
      <Popover.Content className="w-auto p-0" align="start">
        <Calendar
          mode="range"
          selected={selectedRange}
          onSelect={(range) => {
            const fromDate = range?.from ? localDateInputValue(range.from) : '';
            const toDate = range?.to ? localDateInputValue(range.to) : '';
            const from = fromDate
              ? dateTimeIso(fromDate, timeExpanded ? fromTimeValue : START_OF_DAY_TIME, 'start')
              : undefined;
            let to: string | undefined;

            if (toDate) {
              to = dateTimeIso(toDate, timeExpanded ? toTimeValue : END_OF_DAY_TIME, 'end');
            }

            setDateRange(from, to);
          }}
          numberOfMonths={1}
        />
        <div className="space-y-3 border-t p-3">
          <div className="flex items-center justify-between gap-3">
            <Button
              variant="ghost"
              size="sm"
              className="h-8 px-2 text-xs"
              onClick={() => setTimeExpanded((open) => !open)}
            >
              <Clock className="mr-2 h-3.5 w-3.5" />
              Specific time
              <ChevronDown
                className={`ml-2 h-3.5 w-3.5 opacity-60 transition-transform ${timeExpanded ? 'rotate-180' : ''}`}
              />
            </Button>
            {timeExpanded && (dateFrom || dateTo) && (
              <Button variant="ghost" size="sm" className="h-8 px-2 text-xs" onClick={clearDetailedTime}>
                All day
              </Button>
            )}
          </div>

          {timeExpanded && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="memory-filter-start-time" className="text-xs text-muted-foreground">
                  Start time
                </Label>
                <Input
                  id="memory-filter-start-time"
                  type="time"
                  value={draftFromTime}
                  disabled={!fromDateValue}
                  onChange={(event) => handleTimeChange('from', event.target.value)}
                  onBlur={(event) => commitTime('from', event.currentTarget.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      commitTime('from', event.currentTarget.value);
                      event.currentTarget.blur();
                    }
                  }}
                  className="h-8"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="memory-filter-end-time" className="text-xs text-muted-foreground">
                  End time
                </Label>
                <Input
                  id="memory-filter-end-time"
                  type="time"
                  value={draftToTime}
                  disabled={!toDateValue}
                  onChange={(event) => handleTimeChange('to', event.target.value)}
                  onBlur={(event) => commitTime('to', event.currentTarget.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      commitTime('to', event.currentTarget.value);
                      event.currentTarget.blur();
                    }
                  }}
                  className="h-8"
                />
              </div>
            </div>
          )}

          {(dateFrom || dateTo) && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-full text-xs text-muted-foreground"
              onClick={() => {
                setTimeExpanded(false);
                setDateRange(undefined, undefined);
              }}
            >
              Clear range
            </Button>
          )}
        </div>
      </Popover.Content>
    </Popover>
  );
}

/** Sort preset selector bound to the `sortBy`/`sortOrder` URL params. */
function SortControl() {
  const [{ sortBy, sortOrder }, { setSort }] = useDropdown();

  const currentSort =
    SORT_OPTIONS.find((option) => option.sortBy === sortBy && option.sortOrder === sortOrder)?.value ??
    'default';

  return (
    <Select
      value={currentSort}
      onValueChange={(value) => {
        const option = SORT_OPTIONS.find((item) => item.value === value);

        setSort(option?.sortBy || undefined, option?.sortOrder || undefined);
      }}
    >
      <Select.Trigger className="w-[150px]">
        <ArrowUpDown className="mr-2 h-4 w-4 text-muted-foreground" />
        <Select.Value placeholder="Sort" />
      </Select.Trigger>
      <Select.Content>
        {SORT_OPTIONS.map((option) => (
          <Select.Item key={option.value} value={option.value}>
            {option.label}
          </Select.Item>
        ))}
      </Select.Content>
    </Select>
  );
}

/**
 * The advanced search controls: the What / When / How dropdowns and the
 * located-only toggle followed by semantic and sort, then the drag-and-drop
 * filter area (people, places & tags), with the save action on its own
 * bottom-right line. `modal` is forwarded to the portaled Radix dropdowns so
 * they behave inside a modal Sheet/Dialog.
 */
export function AdvancedFilters({ modal }: { modal: boolean }) {
  return (
    <div className="flex w-full min-w-0 flex-col gap-3">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <EntityTypeFilter modal={modal} label="What" />
        <DateControl />
        {/* Place-name filtering moved to the drag-and-drop filter area; the
            located-only flag keeps its own toggle since no search result
            represents "anything with coordinates". */}
        <ToggleChip param="hasLocation" label="Has a location" icon={<MapPin className="h-4 w-4" />} />
        <ConnectorFilter modal={modal} label="How" />

        <span className="mx-1 h-6 w-px self-center bg-border" />

        <ToggleChip param="semantic" label="Semantic" icon={<Sparkles className="h-4 w-4" />} />

        <span className="mx-1 h-6 w-px self-center bg-border" />

        <SortControl />
      </div>

      <FilterDropArea />

      <div className="flex justify-end">
        <SaveSearchButton />
      </div>
    </div>
  );
}

/**
 * "Save" — captures a name and persists the current query + selected
 * entity types + tags as a SavedSearch (shown on the Saved Searches page).
 */
function SaveSearchButton() {
  const [searchParams] = useSearchParams();
  const [{ selectedEntityTypes }] = useDropdown();
  const { toast } = useToast();
  // Sharing (the "make public" control) is gated while the access model is hardened.
  const { isFeatureEnabled } = useFeatures();
  const sharingEnabled = isFeatureEnabled('shared.search');

  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  // The just-created saved search, handed to the share modal on "Save & share".
  const [savedSearchToShare, setSavedSearchToShare] = useState<FragmentType<
    typeof SavedSearchGridItemFragment
  > | null>(null);

  const [createSavedSearch, { loading }] = useMutation(CREATE_SAVED_SEARCH, {
    // Drop the cached list so the Saved Searches page refetches it with the new entry.
    update(cache, { data }) {
      if (data?.createSavedSearch?.success) {
        cache.evict({ id: 'ROOT_QUERY', fieldName: 'savedSearches' });
        cache.gc();
      }
    },
  });

  const handleSave = async (share: boolean) => {
    const trimmed = name.trim();

    if (!trimmed) {
      return;
    }

    const query = searchParams.get('search')?.trim() || undefined;
    const tags = searchParams.get('tags')?.split(',').filter(Boolean) ?? [];
    const entityTypes = selectedEntityTypes.map(
      (type) => ENTITY_TYPE_MAP[type as keyof typeof ENTITY_TYPE_MAP],
    );
    const filters = buildSavedSearchFilters(searchParams);

    try {
      const result = await createSavedSearch({
        variables: {
          input: {
            name: trimmed,
            query,
            entityTypes,
            tags: tags.length > 0 ? tags : undefined,
            filters,
          },
        },
      });

      const created = result.data?.createSavedSearch?.savedSearch;

      if (created) {
        toast.success(`Saved search “${trimmed}”`);
        setName('');
        setOpen(false);
        // Hand the new search to the share modal so the user can grab a link
        // without a trip to the Saved Searches page.
        if (share) {
          setSavedSearchToShare(created);
        }
      } else {
        toast.error('Failed to save search');
      }
    } catch {
      toast.error('Failed to save search');
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <Button>
          <Save className="mr-2 h-4 w-4" />
          Save
        </Button>
      </Dialog.Trigger>
      <Dialog.Content className="sm:max-w-[420px]">
        <Dialog.Header>
          <Dialog.Title>Save this search</Dialog.Title>
          <Dialog.Description>
            Stores the current query, entity types, tags, and all active filters (who / where / when / how /
            sort) so you can reuse them later.
          </Dialog.Description>
        </Dialog.Header>

        <div className="space-y-2 py-2">
          <Label htmlFor="saved-search-name">Name</Label>
          <Input
            id="saved-search-name"
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                handleSave(false);
              }
            }}
            placeholder="e.g. Work emails this month"
          />
        </div>

        <Dialog.Footer>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={loading}>
            Cancel
          </Button>
          {sharingEnabled && (
            <Button variant="secondary" onClick={() => handleSave(true)} disabled={loading || !name.trim()}>
              <Share2 className="mr-2 h-4 w-4" />
              Save &amp; share
            </Button>
          )}
          <Button onClick={() => handleSave(false)} disabled={loading || !name.trim()}>
            {loading ? 'Saving…' : 'Save'}
          </Button>
        </Dialog.Footer>
      </Dialog.Content>

      {savedSearchToShare && (
        <ShareSavedSearchModal savedSearch={savedSearchToShare} onClose={() => setSavedSearchToShare(null)} />
      )}
    </Dialog>
  );
}

/**
 * The "Advanced" toggle. Lives in the global header (desktop) or above the mobile
 * tabs; it controls the toolbar drawer via the page's lifted `open` state and
 * flips an up/down chevron; the caller surfaces the active-filter count.
 */
export function AdvancedSearchToggle({
  open,
  onToggle,
  className,
}: {
  open: boolean;
  onToggle: () => void;
  className?: string;
}) {
  const label = open ? 'Close advanced search' : 'Open advanced search';

  return (
    <Tooltip.Provider>
      <Tooltip delayDuration={400}>
        <Tooltip.Trigger asChild>
          <Button
            type="button"
            size="icon"
            // Open state is signalled by the rotated chevron alone, and the
            // active-filter count by the caller's adjacent text — a filled
            // button here visually fuses with the clear-X beside it.
            variant="outline"
            onClick={onToggle}
            // Keep focus in the search input (the toggle sits inset in it) so the
            // suggestions panel doesn't blink out between mousedown and the toggle.
            onMouseDown={(e) => e.preventDefault()}
            aria-label={label}
            aria-expanded={open}
            title={label}
            className={cn('h-10 w-10 flex-shrink-0', open && 'rounded-b-none', className)}
          >
            <ChevronDown className={cn('h-4 w-4 transition-transform duration-100', open && 'rotate-180')} />
          </Button>
        </Tooltip.Trigger>
        <Tooltip.Content side="bottom">{label}</Tooltip.Content>
      </Tooltip>
    </Tooltip.Provider>
  );
}

/**
 * Debounced free-text search bound to the `?search` URL param. Used on mobile,
 * where the unified header search bar isn't shown; desktop uses the header
 * GlobalSearchBox instead.
 */
export function MemorySearchField() {
  const [searchParams, setSearchParams] = useSearchParams();
  const urlValue = searchParams.get('search') ?? '';
  const [value, setValue] = useState(urlValue);

  // Keep the input in sync when the URL changes externally (clear, saved search).
  useEffect(() => {
    setValue(urlValue);
  }, [urlValue]);

  useEffect(() => {
    const handle = setTimeout(() => {
      if (value === urlValue) {
        return;
      }

      setSearchParams(
        (params) => {
          if (value) {
            params.set('search', value);
          } else {
            params.delete('search');
          }

          return params;
        },
        { replace: true },
      );
    }, 350);

    return () => clearTimeout(handle);
  }, [value, urlValue, setSearchParams]);

  return (
    <div className="relative w-full">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        type="search"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder="Search your memory…"
        className="pl-8"
      />
    </div>
  );
}

function ExplorerToolbarInner({ open }: { open: boolean }) {
  const [searchParams] = useSearchParams();

  return (
    <div className="flex flex-col gap-2">
      {/* The advanced-search drawer: What / When / How + located-only, semantic,
          and sort, then the drag-and-drop filter area (people, places & tags),
          with save on its own bottom-right line. Opened from the header toggle. */}
      {open && (
        <div className="rounded-lg border border-border/60 bg-muted/20 p-3 shadow-sm">
          <AdvancedFilters modal={false} />
        </div>
      )}

      {countActiveFilters(searchParams) > 0 && (
        <div className="min-w-0">
          {/* While the drawer is open its drop area already shows the who /
              where / tag / date selections; omit them here to avoid doubling up. */}
          <ActiveFilterChips omitDropAreaFilters={open} />
        </div>
      )}
    </div>
  );
}

/**
 * The explorer toolbar body that sits under the unified header bar: the
 * advanced-search drawer (What / When / How + located-only, semantic, sort,
 * then the drag-and-drop filter area and save) plus the active-filter chips.
 * `open` is controlled by the page — the AdvancedSearchToggle that flips it
 * lives in the header. Wrapped in DropdownProvider so the useDropdown
 * URL-param setters work.
 */
export function ExplorerToolbar({ open }: { open: boolean }) {
  return (
    <DropdownProvider args={[{ changeSearchParams: true }]}>
      <ExplorerToolbarInner open={open} />
    </DropdownProvider>
  );
}
