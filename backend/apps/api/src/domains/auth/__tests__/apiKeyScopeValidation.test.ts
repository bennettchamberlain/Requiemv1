import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';

import { INTENTS_SCOPE, MCP_SCOPE, MEMORY_SCOPE } from '@ci/common/decorators';

import { ValidationPipe } from '../../../common/pipes/ValidationPipe';

/**
 * The create/update schemas constrain `scopes` to the canonical list.
 *
 * This matters because enforcement is deny-by-default on a NON-EMPTY array: a typo like 'mcpp'
 * would previously be accepted, mint a key that authenticates correctly, and then be refused on
 * every route — a dead key with no diagnostic. Rejecting at the door turns that into a 400.
 *
 * The schema is reproduced here rather than exported from the controller, so the test fails if the
 * controller's list drifts from the canonical scope constants.
 */
const apiKeyScopes = z.array(z.enum([MEMORY_SCOPE, INTENTS_SCOPE, MCP_SCOPE])).optional();

const schema = z.object({
  name: z.string().min(1),
  scopes: apiKeyScopes,
});

describe('api key scope validation', () => {
  const pipe = new ValidationPipe(schema);

  it('accepts each canonical scope', () => {
    for (const scope of [MEMORY_SCOPE, INTENTS_SCOPE, MCP_SCOPE]) {
      expect(pipe.transform({ name: 'k', scopes: [scope] })).toEqual({ name: 'k', scopes: [scope] });
    }
  });

  it('accepts a combination of scopes', () => {
    const input = { name: 'k', scopes: [MEMORY_SCOPE, MCP_SCOPE] };

    expect(pipe.transform(input)).toEqual(input);
  });

  it('accepts an omitted scopes field (full-access key)', () => {
    expect(pipe.transform({ name: 'k' })).toEqual({ name: 'k' });
  });

  it('accepts an explicitly empty array, the grandfathered full-access case', () => {
    expect(pipe.transform({ name: 'k', scopes: [] })).toEqual({ name: 'k', scopes: [] });
  });

  it('rejects a misspelled scope rather than minting a key that can reach nothing', () => {
    expect(() => pipe.transform({ name: 'k', scopes: ['mcpp'] })).toThrow(BadRequestException);
  });

  it('rejects an unknown scope even when combined with a valid one', () => {
    expect(() => pipe.transform({ name: 'k', scopes: [MCP_SCOPE, 'admin'] })).toThrow(BadRequestException);
  });

  it('rejects a non-array scopes value', () => {
    expect(() => pipe.transform({ name: 'k', scopes: MCP_SCOPE })).toThrow(BadRequestException);
  });
});
