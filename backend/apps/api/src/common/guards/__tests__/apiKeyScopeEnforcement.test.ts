import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';

import type { ApiKeyCapability } from '@ci/common/decorators';

import { enforceApiKeyCapability, enforceApiKeyScopes } from '../apiKeyScopeEnforcement';
import type { ApiKeyScopedRequest } from '../apiKeyScopeEnforcement';

/**
 * Unit tests for the deny-by-default scope enforcement run inside the api-key
 * guards. Unlike the old opt-in model (allow unless a required scope is
 * missing), this DENIES a scope-limited key on any route that doesn't grant one
 * of its scopes.
 */
function setup(required: string[] | undefined, apiKeyScopes: string[] | undefined) {
  const reflector = {
    getAllAndOverride: jest.fn().mockReturnValue(required),
  } as unknown as Reflector;

  const context = {
    getHandler: () => () => undefined,
    getClass: () => class {},
  } as unknown as ExecutionContext;

  const request = { apiKeyScopes } as ApiKeyScopedRequest;

  return () => enforceApiKeyScopes(reflector, context, request);
}

describe('enforceApiKeyScopes', () => {
  it('allows a non-api-key principal (apiKeyScopes undefined = full authority)', () => {
    expect(setup(['memory'], undefined)).not.toThrow();
  });

  it('allows an empty-scope key (legacy / bulk importer) everywhere', () => {
    expect(setup(undefined, [])).not.toThrow();
    expect(setup(['memory'], [])).not.toThrow();
  });

  it('allows a scoped key on a route that grants a scope it holds', () => {
    expect(setup(['memory'], ['memory', 'intents'])).not.toThrow();
  });

  it('DENIES a scoped key on a route with no @RequireScopes (deny-by-default)', () => {
    // This is the crux: a memory-scoped chat-agent key hitting /graphql, /files,
    // /v1, … (none of which declare a scope) is rejected.
    expect(setup(undefined, ['memory'])).toThrow(ForbiddenException);
    expect(setup([], ['memory'])).toThrow(ForbiddenException);
  });

  it('DENIES a scoped key missing a required scope', () => {
    expect(setup(['mcp'], ['memory', 'intents'])).toThrow(ForbiddenException);
  });

  it('requires EVERY listed scope', () => {
    expect(setup(['memory', 'mcp'], ['memory'])).toThrow(/mcp/);
  });
});

/**
 * Capability enforcement — the second axis, run from the same guards.
 *
 * Without it the two axes only met on the MCP tool surface, so a read-only key carrying `memory`
 * could still POST /api/memory/write. That is worse than not offering read-only at all: the
 * settings UI has already told the user the key cannot record anything.
 */
function setupCapability(required: ApiKeyCapability | undefined, request: Partial<ApiKeyScopedRequest>) {
  const reflector = {
    getAllAndOverride: jest.fn().mockReturnValue(required),
  } as unknown as Reflector;

  const context = {
    getHandler: () => () => undefined,
    getClass: () => class {},
  } as unknown as ExecutionContext;

  return () => enforceApiKeyCapability(reflector, context, request as ApiKeyScopedRequest);
}

describe('enforceApiKeyCapability', () => {
  it('allows a non-api-key principal (a session IS the user)', () => {
    expect(setupCapability('full', { apiKeyScopes: undefined })).not.toThrow();
  });

  it('allows a route that declares no capability, leaving current behaviour unchanged', () => {
    // Opt-in rather than deny-by-default: this applies to empty-scope keys too, and those reach
    // the whole API, so denying un-annotated routes would 403 every legacy key everywhere.
    expect(setupCapability(undefined, { apiKeyScopes: ['memory'], apiKeyCapability: 'read' })).not.toThrow();
  });

  it('lets a key act at or above the level a route requires', () => {
    expect(setupCapability('read', { apiKeyScopes: ['memory'], apiKeyCapability: 'read' })).not.toThrow();
    expect(setupCapability('read', { apiKeyScopes: ['memory'], apiKeyCapability: 'full' })).not.toThrow();
    expect(setupCapability('write', { apiKeyScopes: ['memory'], apiKeyCapability: 'write' })).not.toThrow();
  });

  it('DENIES a read-only key on a route that writes', () => {
    expect(setupCapability('write', { apiKeyScopes: ['memory'], apiKeyCapability: 'read' })).toThrow(
      ForbiddenException,
    );
  });

  it('names both levels in the refusal, so the fix is obvious from the error', () => {
    expect(setupCapability('write', { apiKeyScopes: ['memory'], apiKeyCapability: 'read' })).toThrow(
      /is "read".*requires "write"/,
    );
  });

  it('applies to an empty-scope (full-surface) key too', () => {
    // "Reaches every surface" and "may write on it" are separate grants — the bulk importer is
    // exactly the credential that should be able to write without being able to delete.
    expect(setupCapability('write', { apiKeyScopes: [], apiKeyCapability: 'read' })).toThrow(
      ForbiddenException,
    );
    expect(setupCapability('full', { apiKeyScopes: [], apiKeyCapability: 'write' })).toThrow(
      ForbiddenException,
    );
  });

  it('treats an api-key request carrying no capability as read-only', () => {
    // ApiKeyStrategy always sets it, so its absence means the request did not come through the
    // strategy — and an unknown caller gets the least authority, not the most.
    expect(setupCapability('write', { apiKeyScopes: ['memory'] })).toThrow(ForbiddenException);
    expect(setupCapability('read', { apiKeyScopes: ['memory'] })).not.toThrow();
  });
});
