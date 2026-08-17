import { describe, expect, it } from 'vitest';

import { zipFilesStore } from './zipStore';

describe('zipFilesStore', () => {
  it('builds a zip whose local header names the first file', async () => {
    const conversations = new File(['{"mapping":{}}'], 'conversations.json');

    Object.defineProperty(conversations, 'webkitRelativePath', {
      value: 'chatgpt-export/conversations.json',
    });

    const zip = await zipFilesStore([conversations]);
    const bytes = new Uint8Array(
      await new Promise<ArrayBuffer>((resolve, reject) => {
        const reader = new FileReader();

        reader.onload = () => resolve(reader.result as ArrayBuffer);
        reader.onerror = () => reject(reader.error);
        reader.readAsArrayBuffer(zip);
      }),
    );

    expect(zip.name).toBe('chatgpt-export.zip');
    expect(zip.type).toBe('application/zip');
    expect(String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3])).toBe('PK\u0003\u0004');
    expect(new TextDecoder().decode(bytes)).toContain('chatgpt-export/conversations.json');
    expect(new TextDecoder().decode(bytes)).toContain('{"mapping":{}}');
  });
});
