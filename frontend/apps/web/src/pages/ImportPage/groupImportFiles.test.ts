import { describe, expect, it } from 'vitest';

import { groupImportFiles } from './groupImportFiles';

function file(name: string, relativePath = ''): File {
  const blob = new File(['x'], name);

  if (relativePath) {
    Object.defineProperty(blob, 'webkitRelativePath', { value: relativePath });
  }

  return blob;
}

describe('groupImportFiles', () => {
  it('keeps loose zips as one file batch', () => {
    const zip = file('export.zip');

    expect(groupImportFiles([zip])).toEqual([{ kind: 'file', files: [zip] }]);
  });

  it('groups a folder tree by its first path segment', () => {
    const conversations = file('conversations.json', 'chatgpt-export/conversations.json');
    const html = file('chat.html', 'chatgpt-export/chat.html');

    expect(groupImportFiles([conversations, html])).toEqual([
      { kind: 'directory', name: 'chatgpt-export', files: [conversations, html] },
    ]);
  });

  it('keeps two dropped folders as two directory batches', () => {
    const a = file('a.json', 'one/a.json');
    const b = file('b.json', 'two/b.json');
    const batches = groupImportFiles([a, b]);

    expect(batches).toHaveLength(2);
    expect(batches.map((batch) => (batch.kind === 'directory' ? batch.name : ''))).toEqual(['one', 'two']);
  });

  it('splits a folder drop that also includes a loose zip', () => {
    const tree = file('conversations.json', 'chatgpt-export/conversations.json');
    const zip = file('photos.zip');
    const batches = groupImportFiles([tree, zip]);

    expect(batches).toEqual([
      { kind: 'directory', name: 'chatgpt-export', files: [tree] },
      { kind: 'file', files: [zip] },
    ]);
  });
});
