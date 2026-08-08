import { useRef, useState } from 'react';

import { fetchJson } from '@ci/common';
import { Button, Card, Dialog, Input, Label } from '@ci/shadcn';
import { Download, Upload } from '@ci/shadcn/icons';

import { useAuth, useCurrentUser } from '@/hooks';

interface ExportResponse {
  filename: string;
  archive: unknown;
}

interface ImportResponse {
  tablesImported: number;
  rowsImported: number;
  filesRestored: number;
}

function authHeaders(authToken: string | null | undefined): HeadersInit {
  return {
    ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
  };
}

function downloadJson(filename: string, payload: unknown): void {
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: 'application/json;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function DataPortabilitySection() {
  const [{ authToken }] = useAuth();
  const { user } = useCurrentUser();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [exporting, setExporting] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [confirmEmail, setConfirmEmail] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const email = user?.email ?? '';
  const matches = email.length > 0 && confirmEmail.trim().toLowerCase() === email.trim().toLowerCase();

  const handleExport = async () => {
    setExporting(true);
    setError(null);
    setSuccess(null);

    try {
      const result = await fetchJson<ExportResponse>('/api/account/export', {
        headers: authHeaders(authToken),
      });

      if (!result?.archive) {
        throw new Error('Export returned no data');
      }

      downloadJson(result.filename ?? 'ci-memory-export.json', result.archive);
      setSuccess('Export downloaded.');
    } catch {
      setError('Could not export your data. Please try again.');
    } finally {
      setExporting(false);
    }
  };

  const handleImport = async () => {
    if (!selectedFile) {
      return;
    }

    setImporting(true);
    setError(null);
    setSuccess(null);

    try {
      const text = await selectedFile.text();
      const archive = JSON.parse(text) as unknown;

      const result = await fetchJson<ImportResponse>('/api/account/import', {
        method: 'POST',
        headers: {
          ...authHeaders(authToken),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          confirmEmail: confirmEmail.trim(),
          archive,
        }),
      });

      if (!result) {
        throw new Error('Import returned no result');
      }

      setSuccess(
        `Import complete — ${result.rowsImported.toLocaleString()} rows across ${result.tablesImported} tables, ${result.filesRestored.toLocaleString()} files restored.`,
      );
      setImportOpen(false);
      setConfirmEmail('');
      setSelectedFile(null);
    } catch {
      setError('Could not import that archive. Check the file and confirmation email, then try again.');
    } finally {
      setImporting(false);
    }
  };

  return (
    <>
      <div className="mb-6">
        <h2 className="text-xl font-semibold">Your data</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Download a portable copy of everything in Memory, or restore from a previous export.
        </p>
      </div>

      <div className="space-y-4">
        <Card>
          <Card.Content className="space-y-4 pt-6">
            <div className="space-y-1">
              <h3 className="text-sm font-medium">Export all data</h3>
              <p className="text-sm text-muted-foreground">
                Downloads a JSON archive of your memories, files, graph, schedule, and settings from this
                server.
              </p>
            </div>
            <Button onClick={() => void handleExport()} disabled={exporting}>
              <Download className="mr-1.5 h-4 w-4" strokeWidth={1.5} />
              {exporting ? 'Preparing export…' : 'Export all my data'}
            </Button>
          </Card.Content>
        </Card>

        <Card>
          <Card.Content className="space-y-4 pt-6">
            <div className="space-y-1">
              <h3 className="text-sm font-medium">Import data</h3>
              <p className="text-sm text-muted-foreground">
                Replaces your current Memory data with the contents of a CI Memory export file. This cannot be
                undone.
              </p>
            </div>
            <Button variant="outline" onClick={() => setImportOpen(true)}>
              <Upload className="mr-1.5 h-4 w-4" strokeWidth={1.5} />
              Import from file
            </Button>
          </Card.Content>
        </Card>

        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        {success ? <p className="text-sm text-muted-foreground">{success}</p> : null}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(event) => {
          setSelectedFile(event.target.files?.[0] ?? null);
        }}
      />

      <Dialog
        open={importOpen}
        onOpenChange={(next) => {
          setImportOpen(next);

          if (!next) {
            setConfirmEmail('');
            setSelectedFile(null);
            setError(null);
          }
        }}
      >
        <Dialog.Content>
          <Dialog.Header>
            <Dialog.Title>Import your data?</Dialog.Title>
            <Dialog.Description>
              This replaces your current memories on this server with the selected export file.
            </Dialog.Description>
          </Dialog.Header>

          <div className="space-y-4 py-2">
            <div className="grid gap-2">
              <Label htmlFor="exportFile">Export file</Label>
              <Button
                type="button"
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
              >
                {selectedFile ? selectedFile.name : 'Choose JSON file'}
              </Button>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="importConfirmEmail">
                Type <span className="font-medium text-foreground">{email}</span> to confirm
              </Label>
              <Input
                id="importConfirmEmail"
                autoComplete="off"
                placeholder={email}
                value={confirmEmail}
                onChange={(event) => setConfirmEmail(event.target.value)}
              />
            </div>
          </div>

          <Dialog.Footer>
            <Button variant="outline" onClick={() => setImportOpen(false)} disabled={importing}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => void handleImport()}
              disabled={!selectedFile || !matches || importing}
            >
              {importing ? 'Importing…' : 'Replace my data'}
            </Button>
          </Dialog.Footer>
        </Dialog.Content>
      </Dialog>
    </>
  );
}
