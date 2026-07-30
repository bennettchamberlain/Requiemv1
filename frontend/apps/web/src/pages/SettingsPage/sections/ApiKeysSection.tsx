import { useCallback, useEffect, useState } from 'react';

import { fetchJson } from '@ci/common';
import {
  API_KEY_PROVENANCE_CONNECT,
  API_KEY_SCOPE_INTENTS,
  API_KEY_SCOPE_MCP,
  API_KEY_SCOPE_MEMORY,
} from '@ci/common/src/constants';
import { Badge, Button, Calendar, Card, Checkbox, Dialog, Input, Label, Popover } from '@ci/shadcn';
import { CalendarIcon, Check, ClipboardCopy, KeyRound, Lock, Pencil, Plus, Trash, X } from '@ci/shadcn/icons';

import { useAuth } from '@/hooks';

interface ApiKeyResponse {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  expires_at: string | null;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
  /** Who owns the key's lifecycle: null = the user's own; 'connect' = CI-Hub's. */
  managed_by: string | null;
}

interface CreateApiKeyResponse extends ApiKeyResponse {
  key: string;
}

/**
 * Scopes a user-created key can carry, labelled for the create dialog.
 *
 * Enforcement is deny-by-default on a NON-EMPTY selection: a scoped key may only reach routes that
 * declare one of its scopes. Leaving every box unchecked omits `scopes` from the request, which the
 * API reads as the grandfathered "full access" case — and stays the default, because endpoints
 * without a declared scope (bulk ingest, GraphQL) refuse scoped keys outright.
 */
const SCOPE_OPTIONS = [
  { value: API_KEY_SCOPE_MEMORY, label: 'Memory', description: 'Read and write memories (/memory)' },
  {
    value: API_KEY_SCOPE_INTENTS,
    label: 'Intents',
    description: 'The agent intent catalog (/api/intents), and the tools an MCP client sees',
  },
  {
    value: API_KEY_SCOPE_MCP,
    label: 'MCP',
    description: 'Reach the Model Context Protocol endpoint (/api/mcp) — pair with Intents to see any tools',
  },
] as const;

// Companion Hub mints one key per connected app when you "Connect Memory" from
// the Hub. These are lifecycle-owned by the Hub — it rotates and revokes them —
// so the UI badges them and blocks renaming (a rename would orphan the Hub's
// revoke and strand the key).
//
// Read the server's recorded provenance rather than re-deriving it from the name
// and scopes. Those drift from the truth in both directions: a connect key can
// hold an EMPTY scope set (the bulk importer's does), which the old scope check
// missed — so the UI offered an Edit button the API then rejected — and a user's
// own key named `app:...` was wrongly badged as the Hub's.
function isHubManagedKey(key: { managed_by?: string | null }): boolean {
  return key.managed_by === API_KEY_PROVENANCE_CONNECT;
}

export function ApiKeysSection() {
  const [{ authToken }] = useAuth();

  const [keys, setKeys] = useState<ApiKeyResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Create dialog
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createExpiresAt, setCreateExpiresAt] = useState<Date | undefined>(undefined);
  const [createScopes, setCreateScopes] = useState<string[]>([]);
  const [createLoading, setCreateLoading] = useState(false);

  // Newly created key (shown once)
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Edit dialog
  const [editOpen, setEditOpen] = useState(false);
  const [editKey, setEditKey] = useState<ApiKeyResponse | null>(null);
  const [editName, setEditName] = useState('');
  const [editLoading, setEditLoading] = useState(false);

  // Delete dialog
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteKey, setDeleteKey] = useState<ApiKeyResponse | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const headers = useCallback(
    () => ({
      Authorization: `Bearer ${authToken}`,
      'Content-Type': 'application/json',
    }),
    [authToken],
  );

  const fetchKeys = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await fetchJson<ApiKeyResponse[]>('/api/keys', { headers: headers() });
      setKeys(data ?? []);
    } catch {
      setError('Failed to load API keys');
    } finally {
      setLoading(false);
    }
  }, [headers]);

  useEffect(() => {
    fetchKeys();
  }, [fetchKeys]);

  /**
   * Reset the form whenever the dialog closes. Without this a cancelled dialog reopens holding the
   * previous selection, so a user who once picked scopes could mint a scope-limited key believing
   * it has full access.
   */
  const handleCreateOpenChange = (open: boolean) => {
    setCreateOpen(open);

    if (!open) {
      setCreateName('');
      setCreateExpiresAt(undefined);
      setCreateScopes([]);
    }
  };

  const toggleCreateScope = (scope: string) => {
    setCreateScopes((current) =>
      current.includes(scope) ? current.filter((s) => s !== scope) : [...current, scope],
    );
  };

  // The one scope combination that looks valid and is not: the server confines a scope-limited key
  // off the GraphQL data plane, and gates the native intent tools behind `intents`. So `mcp` on its
  // own leaves the tool list empty. An unscoped key is unaffected — it is not scope-limited.
  const mcpWithoutIntents =
    createScopes.includes(API_KEY_SCOPE_MCP) && !createScopes.includes(API_KEY_SCOPE_INTENTS);

  const handleCreate = async () => {
    if (!createName.trim()) {
      return;
    }

    try {
      setCreateLoading(true);
      const body: Record<string, unknown> = { name: createName.trim() };
      if (createExpiresAt) {
        body.expires_at = createExpiresAt.toISOString();
      }

      // Omitted when empty so the key keeps the grandfathered full-access meaning.
      if (createScopes.length > 0) {
        body.scopes = createScopes;
      }

      const data = await fetchJson<CreateApiKeyResponse>('/api/keys', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify(body),
      });

      setRevealedKey(data?.key ?? null);
      // Closing programmatically does not fire the dialog's onOpenChange, so route through the same
      // handler rather than repeating the field resets, which would otherwise have to stay in sync.
      handleCreateOpenChange(false);
      await fetchKeys();
    } catch {
      setError('Failed to create API key');
    } finally {
      setCreateLoading(false);
    }
  };

  const handleUpdate = async () => {
    if (!editKey || !editName.trim()) {
      return;
    }

    try {
      setEditLoading(true);
      await fetchJson<ApiKeyResponse>(`/api/keys/${editKey.id}`, {
        method: 'PATCH',
        headers: headers(),
        body: JSON.stringify({ name: editName.trim() }),
      });
      setEditOpen(false);
      setEditKey(null);
      setEditName('');
      await fetchKeys();
    } catch {
      setError('Failed to update API key');
    } finally {
      setEditLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteKey) {
      return;
    }

    try {
      setDeleteLoading(true);
      await fetchJson(`/api/keys/${deleteKey.id}`, {
        method: 'DELETE',
        headers: headers(),
      });
      setDeleteOpen(false);
      setDeleteKey(null);
      await fetchKeys();
    } catch {
      setError('Failed to delete API key');
    } finally {
      setDeleteLoading(false);
    }
  };

  const openEdit = (key: ApiKeyResponse) => {
    setEditKey(key);
    setEditName(key.name);
    setEditOpen(true);
  };

  const openDelete = (key: ApiKeyResponse) => {
    setDeleteKey(key);
    setDeleteOpen(true);
  };

  const copyToClipboard = async (text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const formatDate = (date: string | null) => {
    if (!date) {
      return null;
    }

    return new Date(date).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const isExpired = (expiresAt: string | null) => {
    if (!expiresAt) {
      return false;
    }

    return new Date(expiresAt) < new Date();
  };

  return (
    <>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">API Keys</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Create keys to grant other applications access to your account.
          </p>
        </div>
        {/* Icon-only trigger: without an explicit label it reaches assistive tech as an unnamed button. */}
        <Button variant="outline" size="icon" aria-label="Create API key" onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      {error && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-400">
          {error}
        </div>
      )}

      {/* Revealed key banner */}
      {revealedKey && (
        <Card className="mb-4 border-green-200 dark:border-green-800 relative">
          <Button
            variant="ghost"
            size="icon"
            className="absolute top-3 right-3 h-6 w-6"
            onClick={() => {
              setRevealedKey(null);
              setCopied(false);
            }}
          >
            <X className="h-3 w-3" />
          </Button>
          <Card.Content className="space-y-4">
            <p className="text-sm font-medium text-green-700 dark:text-green-400 pr-8">
              Your new API key has been created.
            </p>
            <div className="flex items-center gap-1.5 p-1.5 border shadow-xs rounded-md bg-background">
              <Input
                readOnly
                value={revealedKey}
                className="!flex-1 !border-0 !ring-0 !shadow-none !bg-transparent !p-0 !ml-1 !h-auto !rounded-none font-mono text-sm focus-visible:!ring-0 focus-visible:!border-transparent"
              />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => copyToClipboard(revealedKey)}
                className="cursor-pointer h-8 w-8 p-0 active:scale-90 transition-transform duration-200 ease-out will-change-transform"
              >
                {copied ? (
                  <Check className="h-4 w-4 text-green-600" />
                ) : (
                  <ClipboardCopy className="h-4 w-4" />
                )}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">The key value won't be shown again.</p>
          </Card.Content>
        </Card>
      )}

      {/* Key list */}
      {loading ? (
        <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">Loading…</div>
      ) : keys.length === 0 ? (
        <Card>
          <Card.Content className="flex flex-col items-center justify-center py-12 text-center">
            <p className="text-sm text-muted-foreground">No API keys created yet.</p>
          </Card.Content>
        </Card>
      ) : (
        <div className="space-y-3">
          {keys.map((key) => (
            <Card key={key.id}>
              <Card.Content className="flex items-center justify-between">
                <div className="min-w-0 flex-1 space-y-4">
                  <div className="flex items-center gap-2">
                    <span className="font-medium truncate">{key.name}</span>
                    {isExpired(key.expires_at) && (
                      <Badge variant="destructive" className="text-xs">
                        Expired
                      </Badge>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {isHubManagedKey(key) ? (
                      <Badge
                        variant="outline"
                        className="border-emerald-500/30 bg-emerald-500/10 text-xs text-emerald-600 dark:text-emerald-400"
                      >
                        <Lock />
                        Managed by Companion Hub
                      </Badge>
                    ) : key.scopes.length === 0 ? (
                      <Badge variant="outline" className="text-xs">
                        <KeyRound />
                        Full access
                      </Badge>
                    ) : (
                      key.scopes.map((scope) => (
                        <Badge key={scope} variant="outline" className="text-xs">
                          {scope}
                        </Badge>
                      ))
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <span>
                      Key: <code className="font-mono">{key.prefix}…</code>
                    </span>
                    <span>Created {formatDate(key.created_at)}</span>
                    {key.expires_at && <span>Expires {formatDate(key.expires_at)}</span>}
                    {key.last_used_at && <span>Last used {formatDate(key.last_used_at)}</span>}
                  </div>
                </div>
                <div className="ml-4 flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => openEdit(key)}
                    disabled={isHubManagedKey(key)}
                    title={
                      isHubManagedKey(key)
                        ? 'Managed by Companion Hub — renaming would break the connection'
                        : undefined
                    }
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-red-600 hover:text-red-700"
                    onClick={() => openDelete(key)}
                  >
                    <Trash className="h-4 w-4" />
                  </Button>
                </div>
              </Card.Content>
            </Card>
          ))}
        </div>
      )}

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={handleCreateOpenChange}>
        <Dialog.Content>
          <Dialog.Header>
            <Dialog.Title>Create API Key</Dialog.Title>
          </Dialog.Header>
          <div className="space-y-4 py-2">
            <div className="grid gap-2">
              <Label htmlFor="apiKeyName">Name</Label>
              <Input
                id="apiKeyName"
                placeholder="e.g. OpenClaw access key"
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
              />
            </div>
            <div className="grid gap-2">
              <Label>Expiration (optional)</Label>
              <Popover>
                <Popover.Trigger asChild>
                  <Button
                    variant="outline"
                    className={`w-full justify-start text-left font-normal ${
                      !createExpiresAt ? 'text-muted-foreground' : ''
                    }`}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {createExpiresAt
                      ? createExpiresAt.toLocaleDateString(undefined, {
                          year: 'numeric',
                          month: 'long',
                          day: 'numeric',
                        })
                      : 'Pick a date'}
                  </Button>
                </Popover.Trigger>
                <Popover.Content className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={createExpiresAt}
                    onSelect={setCreateExpiresAt}
                    disabled={{ before: new Date() }}
                    autoFocus
                  />
                </Popover.Content>
              </Popover>
            </div>
            <div className="grid gap-2">
              <Label>Access</Label>
              <div className="space-y-2 rounded-md border p-3">
                {SCOPE_OPTIONS.map((scope) => (
                  // The description is wired up with aria-describedby rather than folded into the
                  // label: an aria-label naming the checkbox would suppress it entirely, leaving
                  // assistive tech with "MCP" and no statement of what it unlocks.
                  <div key={scope.value} className="flex items-start gap-3">
                    <Checkbox
                      id={`apiKeyScope-${scope.value}`}
                      aria-describedby={`apiKeyScope-${scope.value}-description`}
                      checked={createScopes.includes(scope.value)}
                      onCheckedChange={() => toggleCreateScope(scope.value)}
                    />
                    <div className="grid gap-0.5 text-sm leading-none">
                      <Label htmlFor={`apiKeyScope-${scope.value}`} className="cursor-pointer font-medium">
                        {scope.label}
                      </Label>
                      <span
                        id={`apiKeyScope-${scope.value}-description`}
                        className="text-muted-foreground text-xs"
                      >
                        {scope.description}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
              {/* Both lines below restate the consequence of the current selection and change as
                  boxes are ticked, so they have to be a live region: otherwise the amber warning is
                  visible-only, and a screen-reader user picks the broken combination in silence —
                  the exact outcome the warning exists to prevent. */}
              <div role="status" className="grid gap-2">
                <p className="text-muted-foreground text-xs">
                  {createScopes.length === 0
                    ? 'No selection grants full access — the key can reach every endpoint your account can.'
                    : 'The key is limited to the selected areas and is refused everywhere else, including bulk ingest and GraphQL.'}
                </p>
                {/* MCP without Intents authenticates and opens a session, then advertises zero tools
                    — which agents report as "this server has no tools" rather than as a permissions
                    problem. Say so here, at the point of choice, rather than leaving the user to
                    debug an empty tool list. */}
                {mcpWithoutIntents ? (
                  <p className="text-xs font-medium text-amber-600 dark:text-amber-500">
                    MCP alone advertises no tools. Add Intents, or leave every box unchecked for full access.
                  </p>
                ) : null}
              </div>
            </div>
          </div>
          <Dialog.Footer>
            <Button variant="outline" onClick={() => handleCreateOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={!createName.trim() || createLoading}>
              {createLoading ? 'Creating…' : 'Create'}
            </Button>
          </Dialog.Footer>
        </Dialog.Content>
      </Dialog>

      {/* Edit dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <Dialog.Content>
          <Dialog.Header>
            <Dialog.Title>Edit API Key</Dialog.Title>
            <Dialog.Description>Update the name of your API key.</Dialog.Description>
          </Dialog.Header>
          <div className="space-y-4 py-2">
            <div className="grid gap-2">
              <Label htmlFor="editApiKeyName">Name</Label>
              <Input
                id="editApiKeyName"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleUpdate()}
              />
            </div>
          </div>
          <Dialog.Footer>
            <Button variant="outline" onClick={() => setEditOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleUpdate} disabled={!editName.trim() || editLoading}>
              {editLoading ? 'Saving…' : 'Save'}
            </Button>
          </Dialog.Footer>
        </Dialog.Content>
      </Dialog>

      {/* Delete confirmation dialog */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <Dialog.Content>
          <Dialog.Header>
            <Dialog.Title>Delete API Key</Dialog.Title>
            <Dialog.Description>
              Are you sure you want to delete the <strong>{deleteKey?.name}</strong> key? Any integrations
              using this key will stop working. This action cannot be undone.
            </Dialog.Description>
          </Dialog.Header>
          {deleteKey && isHubManagedKey(deleteKey) && (
            <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
              This key is managed by Companion Hub for a connected app. Deleting it here will break that app's
              memory connection — to disconnect cleanly, use <strong>Disconnect Memory</strong> on the app's
              page in Hub instead.
            </div>
          )}
          <Dialog.Footer>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleteLoading}>
              {deleteLoading ? 'Deleting…' : 'Delete'}
            </Button>
          </Dialog.Footer>
        </Dialog.Content>
      </Dialog>
    </>
  );
}
