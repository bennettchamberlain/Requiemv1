import { describe, expect, it } from 'vitest';

import {
  composedName,
  emptyAddress,
  emptyContact,
  emptyPersonDraft,
  personDraftFrom,
  personDraftToInput,
} from './personDraft';

describe('personDraftFrom', () => {
  it('seeds every profile field from the person', () => {
    const draft = personDraftFrom({
      name: 'Dana Smith',
      firstName: 'Dana',
      lastName: 'Smith',
      nickname: 'Dee',
      pronouns: 'they/them',
      gender: 'Non-binary',
      birthDate: '1990-04-02',
      jobTitle: 'Engineer',
      organization: 'Lifescope',
      department: 'Platform',
      website: 'https://example.com',
      description: 'Met at the hackathon',
    });

    expect(draft).toMatchObject({
      name: 'Dana Smith',
      nickname: 'Dee',
      pronouns: 'they/them',
      jobTitle: 'Engineer',
      description: 'Met at the hackathon',
    });
  });

  it('turns null fields into empty strings so inputs stay controlled', () => {
    const draft = personDraftFrom({ name: null, nickname: null, addresses: null, identifiers: null });

    expect(draft.name).toBe('');
    expect(draft.nickname).toBe('');
    expect(draft.contacts).toEqual([]);
    expect(draft.addresses).toEqual([]);
  });

  it('keeps the raw contact value rather than the normalized one', () => {
    // Re-submitting the normalized form would overwrite what the user typed.
    const draft = personDraftFrom({
      identifiers: [
        { kind: 'phone', value: '4155550100', rawValue: '+1 (415) 555-0100', label: 'mobile' },
        { kind: 'email', value: 'dana@example.com', rawValue: null, label: 'work' },
      ],
    });

    expect(draft.contacts.map((contact) => [contact.kind, contact.value, contact.label])).toEqual([
      ['phone', '+1 (415) 555-0100', 'mobile'],
      ['email', 'dana@example.com', 'work'],
    ]);
  });

  it('drops name identifiers, which are machine-asserted for duplicate detection', () => {
    const draft = personDraftFrom({
      identifiers: [
        { kind: 'name', value: 'dana smith' },
        { kind: 'email', value: 'dana@example.com' },
      ],
    });

    expect(draft.contacts).toHaveLength(1);
    expect(draft.contacts[0]!.kind).toBe('email');
  });

  it('gives every row a distinct key so edits target one row', () => {
    const draft = personDraftFrom({
      identifiers: [
        { kind: 'email', value: 'a@example.com' },
        { kind: 'email', value: 'b@example.com' },
      ],
      addresses: [{ city: 'Portland' }, { city: 'Lisbon' }],
    });

    const keys = [...draft.contacts, ...draft.addresses].map((row) => row.key);

    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('composedName', () => {
  it('prefers the explicit name', () => {
    expect(composedName({ ...emptyPersonDraft(), name: 'Dana Smith', firstName: 'Ignored' })).toBe(
      'Dana Smith',
    );
  });

  it('builds a name from the parts when the name field is blank', () => {
    expect(
      composedName({ ...emptyPersonDraft(), firstName: 'Dana', middleName: 'R', lastName: 'Smith' }),
    ).toBe('Dana R Smith');
  });

  it('falls back to the nickname', () => {
    expect(composedName({ ...emptyPersonDraft(), nickname: 'Dee' })).toBe('Dee');
  });

  it('is empty when nothing names the person', () => {
    expect(composedName(emptyPersonDraft())).toBe('');
  });
});

describe('personDraftToInput', () => {
  it('sends blanked fields as empty strings so the server clears them', () => {
    const input = personDraftToInput({ ...emptyPersonDraft(), name: 'Dana' });

    expect(input.nickname).toBe('');
    expect(input.jobTitle).toBe('');
  });

  it('drops address rows the user never filled in', () => {
    const input = personDraftToInput({
      ...emptyPersonDraft(),
      name: 'Dana',
      addresses: [{ ...emptyAddress('home'), city: 'Portland' }, emptyAddress('work')],
    });

    expect(input.addresses).toEqual([expect.objectContaining({ label: 'home', city: 'Portland' })]);
  });

  it('marks the first address primary', () => {
    const input = personDraftToInput({
      ...emptyPersonDraft(),
      name: 'Dana',
      addresses: [
        { ...emptyAddress('home'), city: 'Portland' },
        { ...emptyAddress('work'), city: 'Lisbon' },
      ],
    });

    expect(input.addresses.map((address) => address.isPrimary)).toEqual([true, false]);
  });

  it('drops blank contact rows and marks the first of each kind primary', () => {
    const input = personDraftToInput({
      ...emptyPersonDraft(),
      name: 'Dana',
      contacts: [
        { ...emptyContact('email'), value: 'first@example.com' },
        emptyContact('email'),
        { ...emptyContact('email'), value: 'second@example.com' },
        { ...emptyContact('phone'), value: '+1 415 555 0100' },
      ],
    });

    expect(input.contacts.map((contact) => [contact.kind, contact.value, contact.isPrimary])).toEqual([
      ['email', 'first@example.com', true],
      ['email', 'second@example.com', false],
      ['phone', '+1 415 555 0100', true],
    ]);
  });

  it('trims values before sending them', () => {
    const input = personDraftToInput({
      ...emptyPersonDraft(),
      name: '  Dana  ',
      contacts: [{ ...emptyContact('email'), value: '  dana@example.com  ', label: ' work ' }],
    });

    expect(input.name).toBe('Dana');
    expect(input.contacts[0]).toMatchObject({ value: 'dana@example.com', label: 'work' });
  });

  it('round-trips a person through the form without losing anything', () => {
    const person = {
      name: 'Dana Smith',
      firstName: 'Dana',
      lastName: 'Smith',
      nickname: 'Dee',
      gender: 'Non-binary',
      jobTitle: 'Engineer',
      identifiers: [{ kind: 'email', value: 'dana@example.com', label: 'work' }],
      addresses: [{ label: 'home', streetAddress: '1 Elm St', city: 'Portland' }],
    };

    const input = personDraftToInput(personDraftFrom(person));

    expect(input).toMatchObject({
      name: 'Dana Smith',
      nickname: 'Dee',
      gender: 'Non-binary',
      jobTitle: 'Engineer',
    });
    expect(input.contacts).toEqual([
      { kind: 'email', value: 'dana@example.com', label: 'work', isPrimary: true },
    ]);
    expect(input.addresses).toEqual([
      expect.objectContaining({ label: 'home', streetAddress: '1 Elm St', city: 'Portland' }),
    ]);
  });
});
