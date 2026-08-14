import { shouldSkipHydrationCandidate } from '../hydrationCandidateFilter';

describe('shouldSkipHydrationCandidate', () => {
  it('skips bare times', () => {
    expect(shouldSkipHydrationCandidate('07:00')).toBe(true);
    expect(shouldSkipHydrationCandidate('21:00', 'What time do you usually go to bed?')).toBe(true);
  });

  it('skips autonomy setting answers', () => {
    expect(
      shouldSkipHydrationCandidate(
        'Balanced — high-confidence items auto-promote',
        'How much should your companion do on its own?',
      ),
    ).toBe(true);
  });

  it('skips schedule questions even when answer is not a bare time', () => {
    expect(shouldSkipHydrationCandidate('Early morning', 'What time do you usually wake up?')).toBe(true);
  });

  it('allows free-text interests', () => {
    expect(shouldSkipHydrationCandidate('Hiking on weekends', 'What do you like to do for fun?')).toBe(false);
  });

  describe('prose answers are not concept labels', () => {
    // Verbatim from ci.promotion_candidates on a real appliance. The extractor
    // named a Concept node with the first 120 characters of each and asserted
    // `self INTERESTED_IN <fragment>`; five reached ci.entities before this
    // filter existed.
    const REAL_PROSE_ANSWERS = [
      'I fundamentally rely on logic and detailed analysis because my goal is always to create optimal structure around complex variables. I view feelings and intuition not as replacements for data, but as vital input.',
      'I am most proud of my capacity to be the proactive architect who establishes structure for the people who depend on me.',
      "Being a parent and spouse defines my life's purpose through my commitment to the people I love.",
      'I hope my legacy is the establishment of structured systems for human flourishing.',
    ];

    it.each(REAL_PROSE_ANSWERS)('skips %s', (answer) => {
      expect(shouldSkipHydrationCandidate(answer)).toBe(true);
    });

    it('skips anything long enough that the 64-char key window would truncate it', () => {
      // 65 single characters: under the word cap and with no sentence break, so
      // length alone must carry this. One char shorter and it is a valid label.
      const justOver = 'a'.repeat(65);
      const justUnder = 'a'.repeat(64);

      expect(shouldSkipHydrationCandidate(justOver)).toBe(true);
      expect(shouldSkipHydrationCandidate(justUnder)).toBe(false);
    });

    it('still allows the short labels this path was built for', () => {
      for (const label of ['Hiking', 'Documentaries', 'Ice skating', 'Science fiction novels']) {
        expect(shouldSkipHydrationCandidate(label)).toBe(false);
      }
    });

    // Guards the deliberate absence of a sentence-punctuation rule: the obvious
    // version of it rejects these, and losing a real interest is worse than
    // admitting the occasional two-word oddity.
    it('keeps short labels that contain a period', () => {
      for (const label of ['Dr. Who', 'Mt. Fuji', 'St. Louis']) {
        expect(shouldSkipHydrationCandidate(label)).toBe(false);
      }
    });
  });
});
