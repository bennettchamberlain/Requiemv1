import { useState } from 'react';

import { fetchJson } from '@ci/common';
import { Button, Card, Dialog, Input, Label } from '@ci/shadcn';
import { TriangleAlert } from '@ci/shadcn/icons';

import { useAuth, useCurrentUser } from '@/hooks';

/**
 * Account settings — currently just deletion, which exists because both stores
 * require it: an app offering in-app signup must offer in-app account deletion
 * (Apple Guideline 5.1.1(v), Google Play Data Deletion). Self-hosting is not an
 * exemption; the initiation path has to live in the app even though the data sits on
 * the user's own appliance.
 *
 * The copy below states 30 days because that is `accountDeletion.graceDays` on the
 * server, which stamps `purge_after` at request time. If that default changes, this
 * text has to change with it — it is a promise made to the person clicking the
 * button, and the store disclosures repeat it. See
 * `docs/architecture/account-deletion.md`.
 */
const PURGE_GRACE_DESCRIPTION = '30 days';
export function AccountSection() {
  const [{ authToken }, { logout }] = useAuth();
  const { user } = useCurrentUser();

  const [open, setOpen] = useState(false);
  const [confirmEmail, setConfirmEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const email = user?.email ?? '';
  // Mirrors the server's comparison so the button is only live when the request would
  // actually be accepted — the user should never meet the 400.
  const matches = email.length > 0 && confirmEmail.trim().toLowerCase() === email.trim().toLowerCase();

  const handleDelete = async () => {
    setLoading(true);
    setError(null);

    try {
      await fetchJson('/api/account', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          // Native holds no JWT — it authenticates with a durable API key, which
          // fetchJson attaches as `x-api-key` on its own. Sending `Bearer null` here
          // would break the very client this feature exists for.
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
        body: JSON.stringify({ confirmEmail: confirmEmail.trim() }),
      });

      // The account stops authenticating immediately, so there is nothing left to
      // stay signed in to: drop the local credential and return to a logged-out app.
      await logout();
    } catch {
      setError('Could not delete the account. Please try again.');
      setLoading(false);
    }
  };

  return (
    <>
      <div className="mb-6">
        <h2 className="text-xl font-semibold">Account</h2>
        <p className="text-sm text-muted-foreground mt-1">
          {email ? <>Signed in as {email}.</> : 'Manage your account.'}
        </p>
      </div>

      <Card className="border-destructive/40">
        <Card.Content className="space-y-4 pt-6">
          <div className="flex items-start gap-3">
            <TriangleAlert className="h-5 w-5 shrink-0 text-destructive" strokeWidth={1.5} />
            <div className="space-y-1">
              <h3 className="text-sm font-medium">Delete account</h3>
              <p className="text-sm text-muted-foreground">
                Signs you out everywhere immediately. This account, its memories and any files you uploaded
                are then permanently deleted from this server after {PURGE_GRACE_DESCRIPTION}. This cannot be
                undone.
              </p>
            </div>
          </div>

          <Button variant="destructive" disabled={!email} onClick={() => setOpen(true)}>
            Delete account
          </Button>
        </Card.Content>
      </Card>

      <Dialog
        open={open}
        onOpenChange={(next: boolean) => {
          setOpen(next);

          if (!next) {
            setConfirmEmail('');
            setError(null);
          }
        }}
      >
        <Dialog.Content>
          <Dialog.Header>
            <Dialog.Title>Delete your account?</Dialog.Title>
            <Dialog.Description>
              Your access is revoked right away. After {PURGE_GRACE_DESCRIPTION} this account, its memories
              and any files you uploaded are permanently deleted from this server. This cannot be undone.
            </Dialog.Description>
          </Dialog.Header>

          <div className="space-y-4 py-2">
            <div className="grid gap-2">
              <Label htmlFor="confirmEmail">
                Type <span className="font-medium text-foreground">{email}</span> to confirm
              </Label>
              <Input
                id="confirmEmail"
                autoComplete="off"
                placeholder={email}
                value={confirmEmail}
                onChange={(e) => setConfirmEmail(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && matches && !loading && handleDelete()}
              />
            </div>

            {error ? <p className="text-sm text-destructive">{error}</p> : null}
          </div>

          <Dialog.Footer>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={loading}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={!matches || loading}>
              {loading ? 'Deleting…' : 'Delete account'}
            </Button>
          </Dialog.Footer>
        </Dialog.Content>
      </Dialog>
    </>
  );
}
