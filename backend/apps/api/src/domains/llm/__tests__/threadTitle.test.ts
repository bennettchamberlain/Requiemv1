import { sidebarTitleFromModel } from '../threadTitle';

describe('sidebarTitleFromModel', () => {
  it('keeps about three title-case words', () => {
    expect(sidebarTitleFromModel('confirm home address')).toBe('Confirm Home Address');
  });

  it('strips thinking traces, quotes, and extra words', () => {
    expect(sidebarTitleFromModel('<think>hmm</think> "Parents vs home airport extra filler words here"')).toBe(
      'Parents Vs Home Airport Extra Filler',
    );
  });

  it('returns empty when the model said nothing usable', () => {
    expect(sidebarTitleFromModel('...')).toBe('');
  });
});
