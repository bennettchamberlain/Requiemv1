import type { ChangeEvent } from 'react';
import { useEffect, useId, useMemo, useState } from 'react';

import { fetchJson } from '@ci/common';
import { Badge, Input, Label } from '@ci/shadcn';

export type EntitySearchResult = {
  entityId: string;
  entityType: string;
  name: string | null;
  description: string | null;
  isLocal?: boolean;
};

export interface GraphSearchResponse {
  success: boolean;
  nodes: Array<{
    id: string;
    entity_id: string;
    entity_type: string;
    name: string | null;
    description: string | null;
    properties?: Record<string, unknown>;
  }>;
  links?: Array<{
    id: string;
    relationship_id: string;
    source: string;
    target: string;
    relationship_type: string;
    strength: number;
    properties: Record<string, unknown>;
  }>;
}

interface EntitySearchInputProps {
  label: string;
  placeholder?: string;
  authToken?: string | null;
  selected: EntitySearchResult | null;
  onSelect(value: EntitySearchResult): void;
  onClear(): void;
  disabled?: boolean;
  minQueryLength?: number;
  localOptions?: EntitySearchResult[];
  onRemoteResponse?(response: GraphSearchResponse | null): void;
}

const DEFAULT_MIN_QUERY = 1;

export function EntitySearchInput({
  label,
  placeholder = 'Search nodes…',
  authToken,
  selected,
  onSelect,
  onClear,
  disabled,
  minQueryLength = DEFAULT_MIN_QUERY,
  localOptions,
  onRemoteResponse,
}: EntitySearchInputProps) {
  const inputId = useId();
  const [query, setQuery] = useState('');
  const [remoteResults, setRemoteResults] = useState<EntitySearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);

  const displayLabel = useMemo(() => formatEntityLabel(selected), [selected?.entityId]);
  const trimmedQuery = query.trim();
  const meetsLength = trimmedQuery.length >= minQueryLength;

  useEffect(() => {
    setQuery(displayLabel);
  }, [displayLabel]);

  useEffect(() => {
    if (!meetsLength) {
      return undefined;
    }

    let cancelled = false;
    const controller = new AbortController();

    async function search() {
      try {
        setSearching(true);
        setError(null);
        setDropdownOpen(true);

        const headers = authToken ? { Authorization: `Bearer ${authToken}` } : undefined;
        const response = await fetchJson<GraphSearchResponse>(
          `/api/graph/search?query=${encodeURIComponent(trimmedQuery)}`,
          {
            method: 'GET',
            headers,
            credentials: 'include',
            signal: controller.signal,
          },
        );

        if (!response.success) {
          throw new Error('Search failed');
        }

        if (!cancelled) {
          setRemoteResults(
            response.nodes.map((node) => ({
              entityId: node.id ?? node.entity_id,
              entityType: node.entity_type,
              name: node.name,
              description: node.description,
            })),
          );
          setDropdownOpen(true);
          onRemoteResponse?.(response);
        }
      } catch (searchError) {
        if (cancelled) {
          return;
        }

        if (searchError instanceof DOMException && searchError.name === 'AbortError') {
          return;
        }

        setRemoteResults([]);
        setError(searchError instanceof Error ? searchError.message : 'Search failed');
        onRemoteResponse?.(null);
      } finally {
        if (!cancelled) {
          setSearching(false);
        }
      }
    }

    search();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [trimmedQuery, meetsLength, authToken, minQueryLength]);

  useEffect(() => {
    if (!meetsLength) {
      setRemoteResults([]);
      setError(null);
      setSearching(false);
      setDropdownOpen(false);
      onRemoteResponse?.(null);
    }
  }, [meetsLength, onRemoteResponse]);

  const localMatches = useMemo(() => {
    if (!localOptions?.length || !meetsLength) {
      return [];
    }

    const search = trimmedQuery.toLowerCase();

    return localOptions.filter((option) => {
      const name = option.name?.toLowerCase() ?? '';
      const type = option.entityType.toLowerCase();
      const id = option.entityId.toLowerCase();

      return name.includes(search) || type.includes(search) || id.includes(search);
    });
  }, [localOptions, trimmedQuery, meetsLength]);

  const combinedResults = useMemo(() => {
    const seen = new Set<string>();
    const merged: EntitySearchResult[] = [];

    for (const local of localMatches) {
      if (!seen.has(local.entityId)) {
        seen.add(local.entityId);
        merged.push({ ...local, isLocal: true });
      }
    }

    for (const remote of remoteResults) {
      if (!seen.has(remote.entityId)) {
        seen.add(remote.entityId);
        merged.push(remote);
      }
    }

    return merged;
  }, [localMatches, remoteResults]);

  const showDropdown = dropdownOpen && !disabled;

  const handleResultSelect = (result: EntitySearchResult) => {
    onSelect(result);
    setDropdownOpen(false);
    setRemoteResults([]);
  };

  const handleInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    setQuery(value);

    if (value.trim().length >= minQueryLength && !dropdownOpen) {
      setDropdownOpen(true);
    }

    if (selected) {
      onClear();
    }
  };

  const handleClearSelection = () => {
    setQuery('');
    onClear();
    setRemoteResults([]);
    setDropdownOpen(false);
  };

  return (
    <div className="space-y-1">
      <Label htmlFor={inputId}>{label}</Label>
      <div className="relative">
        <Input
          id={inputId}
          placeholder={placeholder}
          value={query}
          disabled={disabled}
          autoComplete="off"
          onFocus={() => {
            if (meetsLength) {
              setDropdownOpen(true);
            }
          }}
          onBlur={() => {
            setDropdownOpen(false);
          }}
          onChange={handleInputChange}
        />
        {selected && !disabled && (
          <button
            type="button"
            className="absolute inset-y-0 right-2 text-muted-foreground hover:text-foreground"
            onClick={handleClearSelection}
          >
            ×
          </button>
        )}
        {showDropdown && (
          <div className="absolute left-0 right-0 top-full z-30 mt-1 max-h-60 overflow-auto rounded-md border bg-popover p-2 text-sm shadow-lg">
            {searching && <p className="py-1 text-muted-foreground">Searching…</p>}
            {!searching && error && <p className="py-1 text-red-600">{error}</p>}
            {!searching && !error && combinedResults.length === 0 && (
              <p className="py-1 text-muted-foreground">No matches yet</p>
            )}
            {!searching &&
              !error &&
              combinedResults.map((result) => (
                <button
                  key={result.entityId}
                  type="button"
                  className="flex w-full flex-col rounded-md px-2 py-1 text-left hover:bg-muted"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => handleResultSelect(result)}
                >
                  <span className="font-medium text-foreground">
                    {result.name ?? result.entityType ?? result.entityId}
                  </span>
                  <span className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{result.entityType}</span>
                    {result.isLocal && <Badge variant="outline">Pending</Badge>}
                  </span>
                </button>
              ))}
          </div>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        {selected
          ? `Selected: ${displayLabel}`
          : `Type at least ${minQueryLength} character${minQueryLength === 1 ? '' : 's'} to search your nodes.`}
      </p>
    </div>
  );
}

export function formatEntityLabel(entity: EntitySearchResult | null): string {
  if (!entity) {
    return '';
  }

  return entity.name ?? `${entity.entityType} (${entity.entityId.slice(0, 8)})`;
}
