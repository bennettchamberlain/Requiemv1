import { sanitizeFilename, sanitizeRelativePath } from '../sanitizeFilename';

/**
 * The name is attacker-controlled text — a browser sends whatever it likes as
 * `originalname` — landing as a REAL filename under the uploads staging
 * directory, which the importer later moves and deletes from. Every case here
 * is a way to make that name reshape a path.
 */
describe('sanitizeFilename', () => {
  it('strips directory traversal to the basename', () => {
    expect(sanitizeFilename('../../etc/passwd')).toBe('passwd');
    expect(sanitizeFilename('..\\..\\windows\\system32')).toBe('system32');
  });

  it('removes control characters', () => {
    expect(sanitizeFilename('ex\x00port\x1f.zip')).toBe('export.zip');
  });

  it('flattens shell-hostile characters to underscores', () => {
    expect(sanitizeFilename('my export (2).zip')).toBe('my_export__2_.zip');
  });

  it('refuses to produce a dotfile', () => {
    expect(sanitizeFilename('...hidden')).toBe('hidden');
  });

  it('bounds the length and never returns an empty name', () => {
    expect(sanitizeFilename('x'.repeat(400)).length).toBe(180);
    expect(sanitizeFilename('///')).toBe('upload.zip');
  });
});

describe('sanitizeRelativePath', () => {
  it('keeps a folder tree and sanitizes each segment', () => {
    expect(sanitizeRelativePath('ChatGPT Data/conversations.json')).toBe('ChatGPT_Data/conversations.json');
  });

  it('wraps a bare filename so the staged source is a directory', () => {
    expect(sanitizeRelativePath('conversations.json')).toBe('export/conversations.json');
  });

  it('refuses a traversal segment', () => {
    expect(() => sanitizeRelativePath('ok/../etc/passwd')).toThrow(/escapes/);
  });
});
