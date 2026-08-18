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

  it('decodes a declared us-ascii charset as ascii, not utf8', () => {
    const encoded = '=?us-ascii?Q?Hello_World?=';
    expect(decodeHeaderField(encoded)).toBe('Hello World');
  });

  // Known limitation, not yet fixed: decodeHeaderField treats every declared
  // charset OTHER than us-ascii as UTF-8 (`charset.toLowerCase() ===
  // 'us-ascii' ? 'ascii' : 'utf8'`). A real ISO-8859-1/windows-1252 header —
  // common from older or non-US mail clients — therefore decodes as mojibake
  // instead of the correct text. This test pins the CURRENT (wrong) behavior
  // so a silent regression elsewhere in the tokenizer doesn't hide behind "we
  // never test non-UTF-8 charsets anyway"; if/when charset-aware decoding is
  // added, this assertion should change to expect 'café', not '�'.
  it('currently mis-decodes an ISO-8859-1 (Latin-1) encoded-word as mojibake', () => {
    // "café" in ISO-8859-1/Latin-1: 'é' is the single byte 0xE9, Q-encoded as "=E9".
    const encoded = '=?ISO-8859-1?Q?caf=E9?=';
    const decoded = decodeHeaderField(encoded);
    // What SHOULD happen (correct Latin-1 decode) — currently NOT what we get:
    expect(decoded).not.toBe('café');
    // What ACTUALLY happens: the lone 0xE9 byte is an invalid UTF-8 lead byte,
    // so Node's utf8 decoder substitutes the replacement character.
    expect(decoded).toBe('caf�');
  });
});
