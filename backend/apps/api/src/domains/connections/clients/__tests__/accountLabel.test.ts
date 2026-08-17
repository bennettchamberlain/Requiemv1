import { firstAccountLabel } from '../accountLabel';

describe('firstAccountLabel', () => {
  it('returns the first non-empty trimmed value', () => {
    expect(firstAccountLabel('  a@b.com  ', 'backup')).toBe('a@b.com');
  });

  it('skips empty and whitespace candidates', () => {
    expect(firstAccountLabel('', '   ', null, undefined, 'kept')).toBe('kept');
  });

  it('returns null when nothing usable is present', () => {
    expect(firstAccountLabel('', null, undefined, '  ')).toBeNull();
  });
});
