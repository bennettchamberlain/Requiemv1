import { PersonalizationService } from '../PersonalizationService';

describe('PersonalizationService.decide for inferred_fact', () => {
  it('cautious always asks before saving inferred answers', () => {
    const profile = PersonalizationService.profileForTrustMode('cautious');

    expect(PersonalizationService.decide(profile, { kind: 'inferred_fact', confidence: 0.95 })).toBe('review');
    expect(PersonalizationService.decide(profile, { kind: 'inferred_fact', confidence: 0.5 })).toBe('review');
  });

  it('balanced auto-accepts high-confidence inferences and asks for the rest', () => {
    const profile = PersonalizationService.profileForTrustMode('balanced');

    expect(PersonalizationService.decide(profile, { kind: 'inferred_fact', confidence: 0.9 })).toBe('auto');
    expect(PersonalizationService.decide(profile, { kind: 'inferred_fact', confidence: 0.75 })).toBe('review');
    expect(PersonalizationService.decide(profile, { kind: 'inferred_fact', confidence: 0.5 })).toBe('review');
  });

  it('hands_off auto-accepts inferred answers', () => {
    const profile = PersonalizationService.profileForTrustMode('hands_off');

    expect(PersonalizationService.decide(profile, { kind: 'inferred_fact', confidence: 0.95 })).toBe('auto');
    expect(PersonalizationService.decide(profile, { kind: 'inferred_fact', confidence: 0.55 })).toBe('auto');
  });
});
