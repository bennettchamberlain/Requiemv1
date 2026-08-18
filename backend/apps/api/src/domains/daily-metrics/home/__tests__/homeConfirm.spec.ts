import { isHomeConfirmSourceId } from '../homeConfirm';
import { HomeConfirmService } from '../HomeConfirmService';

describe('isHomeConfirmSourceId', () => {
  it('matches the selector and one-place surprise ids', () => {
    expect(isHomeConfirmSourceId('confirm_home')).toBe(true);
    expect(isHomeConfirmSourceId('one_place')).toBe(true);
    expect(isHomeConfirmSourceId('conversations_low')).toBe(false);
  });
});

describe('HomeConfirmService.candidateOptions / topHomeCandidate', () => {
  const service = new HomeConfirmService(
    {} as never,
    {} as never,
    {} as never,
    { setContext: jest.fn() } as never,
  );

  it('keeps only located candidates as selector options', () => {
    const options = service.candidateOptions([
      {
        locationId: 'loc-1',
        label: 'Oak St',
        kind: 'home',
        lat: 1,
        lng: 2,
        eventCount: 9,
        confidence: 0.7,
      },
      {
        locationId: null,
        label: 'Grid cell',
        kind: 'other',
        lat: 3,
        lng: 4,
        eventCount: 2,
        confidence: 0.4,
      },
    ]);

    expect(options).toEqual([{ id: 'loc-1', label: 'Oak St' }]);
  });

  it('prefers the night-ranked home candidate', () => {
    const top = service.topHomeCandidate([
      {
        locationId: 'work',
        label: 'Office',
        kind: 'work',
        lat: 0,
        lng: 0,
        eventCount: 20,
        confidence: 0.8,
      },
      {
        locationId: 'home',
        label: 'Oak St',
        kind: 'home',
        lat: 1,
        lng: 2,
        eventCount: 9,
        confidence: 0.7,
      },
    ]);

    expect(top?.locationId).toBe('home');
  });
});
