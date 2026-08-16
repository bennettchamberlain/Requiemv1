import { decodeHeaderField } from '../email_mime';

describe('RFC 2047 encoded-word decoding', () => {
  it('passes plain ASCII through unchanged', () => {
    expect(decodeHeaderField('Hello World')).toBe('Hello World');
  });

  it('decodes a single base64-encoded UTF-8 subject', () => {
    // "Привет, мир!" in UTF-8 → base64
    const encoded = '=?UTF-8?B?0J/RgNC40LLQtdGCLCDQvNC40YAh?=';
    expect(decodeHeaderField(encoded)).toBe('Привет, мир!');
  });

  it('decodes Q-encoding with underscore-as-space', () => {
    // "Olá Mundo" in Q-encoding (á = =C3=A1 in UTF-8)
    const encoded = '=?UTF-8?Q?Ol=C3=A1_Mundo?=';
    expect(decodeHeaderField(encoded)).toBe('Olá Mundo');
  });

  it('collapses whitespace between adjacent encoded words', () => {
    // Two halves of "café" split across encoded words.
    const encoded = '=?UTF-8?Q?caf?= =?UTF-8?Q?=C3=A9?=';
    expect(decodeHeaderField(encoded)).toBe('café');
  });

  it('keeps whitespace between encoded word and ascii run', () => {
    const encoded = '=?UTF-8?Q?caf=C3=A9?= au lait';
    expect(decodeHeaderField(encoded)).toBe('café au lait');
  });

  it('leaves malformed encoded-words alone', () => {
    expect(decodeHeaderField('=?BOGUS?')).toBe('=?BOGUS?');
  });
});
