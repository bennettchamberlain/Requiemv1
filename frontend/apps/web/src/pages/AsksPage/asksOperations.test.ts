import type { FieldNode, OperationDefinitionNode } from 'graphql';
import { describe, expect, it } from 'vitest';

import { MY_ASK_GRANTS, RUN_ASK } from './asksOperations';

/**
 * These assert on the DOCUMENTS, not on a rendered component.
 *
 * A field or argument that is missing from the operation is invisible from the
 * page: the control can exist, the handler can fire, the variable can be passed,
 * and the value still never leaves the browser. That is exactly how the
 * disclosure ladder shipped unreachable — the ladder was designed, the backend
 * clamped it, and the mutation document simply did not name the argument.
 */
function operation(document: unknown): OperationDefinitionNode {
  const definitions = (document as { definitions: OperationDefinitionNode[] }).definitions;

  return definitions[0];
}

function selectedFields(document: unknown, rootField = 0): string[] {
  const root = operation(document).selectionSet.selections[rootField] as FieldNode;

  return (root.selectionSet?.selections ?? []).map((selection) => (selection as FieldNode).name.value);
}

describe('RUN_ASK', () => {
  it('carries the owner’s disclosure form all the way onto the wire', () => {
    const op = operation(RUN_ASK);
    const field = op.selectionSet.selections[0] as FieldNode;

    // Both halves matter and they fail differently: without the variable
    // DEFINITION the document will not validate, and without the ARGUMENT the
    // value is accepted by the client and quietly dropped before the request.
    expect(op.variableDefinitions?.map((definition) => definition.variable.name.value)).toContain(
      'disclosureForm',
    );
    expect(field.arguments?.map((argument) => argument.name.value)).toContain('disclosureForm');
  });
});

describe('MY_ASK_GRANTS', () => {
  it('asks for the liveness field the matrix has to read', () => {
    // `revokedAt` is the only liveness fact on `AskGrantType` today. Dropping it
    // from the selection set is how a withdrawn grant renders as live consent.
    expect(selectedFields(MY_ASK_GRANTS)).toContain('revokedAt');
  });
});
