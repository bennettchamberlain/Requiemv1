import assert from 'node:assert/strict';
import { test } from 'node:test';

import { findStaleContainers, parseInspectLines } from './stale-containers';

const OLD = 'e5ce4c8f45b0050a06dbc4290068e7f341d14a8a6a53b2be2cd8a80f440b7492';
const NEW = '17143f27b62a20849caf8f0fdf15b4647af841936ae002e438e1615ade3c603b';

test('parseInspectLines: id, name without the leading slash, then every network id', () => {
  const out = `abc /ci-server-database-1 ${OLD} \n def /ci-server-hbpe-service-1 ${OLD} ${NEW} \n`;
  assert.deepEqual(parseInspectLines(out), [
    { id: 'abc', name: 'ci-server-database-1', networkIds: [OLD] },
    { id: 'def', name: 'ci-server-hbpe-service-1', networkIds: [OLD, NEW] },
  ]);
});

test('parseInspectLines: a container on no network has an empty list, not a phantom id', () => {
  assert.deepEqual(parseInspectLines('abc /host-mode-1 \n'), [
    { id: 'abc', name: 'host-mode-1', networkIds: [] },
  ]);
});

test('findStaleContainers: a container whose network was pruned is stale', () => {
  const stale = findStaleContainers([{ id: 'abc', name: 'db', networkIds: [OLD] }], [NEW]);
  assert.deepEqual(
    stale.map((c) => c.name),
    ['db'],
  );
});

test('findStaleContainers: a container on a live network is left alone', () => {
  assert.deepEqual(findStaleContainers([{ id: 'abc', name: 'db', networkIds: [NEW] }], [NEW]), []);
});

test('findStaleContainers: one dead network among several is enough — start would fail on it', () => {
  const stale = findStaleContainers([{ id: 'abc', name: 'db', networkIds: [NEW, OLD] }], [NEW]);
  assert.equal(stale.length, 1);
});

test('findStaleContainers: a container on no network is never stale', () => {
  assert.deepEqual(findStaleContainers([{ id: 'abc', name: 'host', networkIds: [] }], []), []);
});
