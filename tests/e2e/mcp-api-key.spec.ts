import path from 'node:path';

import { expect, test } from '@playwright/test';

/**
 * Guards the connect recipe an external MCP client follows: mint an API key in the UI, point a
 * standard MCP client at `/api/mcp`, list tools.
 *
 * Nothing covered this before, which is how the published docs drifted to a URL the server does not
 * route. The spec deliberately exercises the transport the way a third-party client does — raw
 * JSON-RPC over Streamable HTTP — rather than through any internal helper.
 *
 * Both credential headers are asserted: `x-api-key` (long-standing) and `Authorization: Bearer`
 * (most MCP clients expose only a bearer field and cannot send a custom header).
 */

const INITIALIZE = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'ci-e2e', version: '1.0' } },
};

/**
 * The same file `global-setup.ts` writes. Resolved absolutely: `playwright.request.newContext`
 * resolves a relative `storageState` against `process.cwd()`, unlike the identical string in
 * `playwright.e2e.config.ts`, which the runner resolves against the config directory.
 */
const AUTH_FILE = path.resolve(__dirname, '../../playwright/.auth/user.json');

/** Streamable HTTP replies as plain JSON or as an SSE `data:` line — accept either. */
function parseMcpBody(contentType: string, text: string): Record<string, unknown> {
  if (contentType.includes('application/json')) {
    return JSON.parse(text) as Record<string, unknown>;
  }

  const data = text
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trim())
    .join('');

  return JSON.parse(data) as Record<string, unknown>;
}

test.describe('MCP endpoint accepts an operator API key', () => {
  let rawKey: string;
  let keyId: string;

  test.beforeAll(async ({ playwright, baseURL }) => {
    // Authenticated via storageState from global-setup; POST /keys is session-guarded and returns
    // the raw key exactly once — the same path a user follows in Settings → API Keys.
    const ctx = await playwright.request.newContext({ baseURL, storageState: AUTH_FILE });
    const res = await ctx.post('/api/keys', { data: { name: 'e2e-mcp' } });

    expect(res.ok(), `Key creation failed: ${res.status()} ${await res.text()}`).toBeTruthy();

    const body = (await res.json()) as { key: string; id: string };

    rawKey = body.key;
    keyId = body.id;
    expect(rawKey).toBeTruthy();

    await ctx.dispose();
  });

  test.afterAll(async ({ playwright, baseURL }) => {
    // beforeAll may have failed before minting anything; a DELETE on `undefined` just adds a 400 to
    // the failure trace of a run that already has a real error to read.
    if (!keyId) {
      return;
    }

    const ctx = await playwright.request.newContext({ baseURL, storageState: AUTH_FILE });

    await ctx.delete(`/api/keys/${keyId}`);
    await ctx.dispose();
  });

  for (const [label, headerFor] of [
    ['x-api-key', (key: string) => ({ 'x-api-key': key })],
    ['Authorization: Bearer', (key: string) => ({ Authorization: `Bearer ${key}` })],
  ] as const) {
    test(`initialize and tools/list succeed with ${label}`, async ({ playwright, baseURL }) => {
      const ctx = await playwright.request.newContext({ baseURL });

      const initRes = await ctx.post('/api/mcp', {
        headers: {
          ...headerFor(rawKey),
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
        },
        data: INITIALIZE,
      });

      expect(initRes.status(), `initialize rejected with ${label}`).toBe(200);

      const sessionId = initRes.headers()['mcp-session-id'];
      expect(sessionId, 'initialize must issue an Mcp-Session-Id').toBeTruthy();

      const initBody = parseMcpBody(initRes.headers()['content-type'] ?? '', await initRes.text());
      expect((initBody.result as { serverInfo: { name: string } }).serverInfo.name).toBe('companion-memory');

      const listRes = await ctx.post('/api/mcp', {
        headers: {
          ...headerFor(rawKey),
          'Mcp-Session-Id': sessionId,
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
        },
        data: { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
      });

      expect(listRes.status()).toBe(200);

      const listBody = parseMcpBody(listRes.headers()['content-type'] ?? '', await listRes.text());
      const { tools } = listBody.result as { tools: Array<{ name: string }> };

      expect(tools.length).toBeGreaterThan(0);

      await ctx.dispose();
    });
  }

  test('rejects a request with no credential', async ({ playwright, baseURL }) => {
    const ctx = await playwright.request.newContext({ baseURL });
    const res = await ctx.post('/api/mcp', {
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      data: INITIALIZE,
    });

    expect(res.status()).toBe(401);

    await ctx.dispose();
  });
});
