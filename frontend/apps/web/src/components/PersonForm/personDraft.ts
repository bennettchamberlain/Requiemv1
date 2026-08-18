/**
 * The editing shape behind {@link PersonForm}.
 *
 * Every field is a plain string — a form's natural state — and the conversion
 * to/from the GraphQL person shape lives here rather than in each modal, so the
 * add and edit flows can never disagree about what an empty field means (an
 * empty string CLEARS the property server-side; that is what the form intends
 * when the user blanks a field).
 */

export type PersonContactKind = 'email' | 'phone';

export interface PersonContactDraft {
  /** Client-only row key; never sent. Row identity has to survive reordering. */
  key: string;
  kind: PersonContactKind;
  value: string;
  label: string;
}

export interface PersonAddressDraft {
  key: string;
  label: string;
  streetAddress: string;
  streetAddress2: string;
  city: string;
  region: string;
  postalCode: string;
  country: string;
}

export interface PersonDraft {
  name: string;
  firstName: string;
  middleName: string;
  lastName: string;
  nickname: string;
  pronouns: string;
  gender: string;
  birthDate: string;
  jobTitle: string;
  organization: string;
  department: string;
  website: string;
  avatarUrl: string;
  description: string;
  contacts: PersonContactDraft[];
  addresses: PersonAddressDraft[];
}

let rowKeySeed = 0;

/** Monotonic row key. Not `crypto.randomUUID` — this never leaves the client. */
export function nextRowKey(prefix: string): string {
  rowKeySeed += 1;

  return `${prefix}-${rowKeySeed}`;
}

export function emptyContact(kind: PersonContactKind = 'email'): PersonContactDraft {
  return { key: nextRowKey('contact'), kind, value: '', label: '' };
}

export function emptyAddress(label = ''): PersonAddressDraft {
  return {
    key: nextRowKey('address'),
    label,
    streetAddress: '',
    streetAddress2: '',
    city: '',
    region: '',
    postalCode: '',
    country: '',
  };
}

export function emptyPersonDraft(): PersonDraft {
  return {
    name: '',
    firstName: '',
    middleName: '',
    lastName: '',
    nickname: '',
    pronouns: '',
    gender: '',
    birthDate: '',
    jobTitle: '',
    organization: '',
    department: '',
    website: '',
    avatarUrl: '',
    description: '',
    contacts: [],
    addresses: [],
  };
}

/** The person shape the form reads — a structural subset of `PersonType`. */
export interface PersonDraftSource {
  name?: string | null;
  description?: string | null;
  firstName?: string | null;
  middleName?: string | null;
  lastName?: string | null;
  nickname?: string | null;
  pronouns?: string | null;
  gender?: string | null;
  birthDate?: string | null;
  jobTitle?: string | null;
  organization?: string | null;
  department?: string | null;
  website?: string | null;
  avatarUrl?: string | null;
  identifiers?: ReadonlyArray<{
    kind: string;
    value: string;
    rawValue?: string | null;
    label?: string | null;
  }> | null;
  addresses?: ReadonlyArray<{
    label?: string | null;
    streetAddress?: string | null;
    streetAddress2?: string | null;
    city?: string | null;
    region?: string | null;
    postalCode?: string | null;
    country?: string | null;
  }> | null;
}

function text(value: string | null | undefined): string {
  return value ?? '';
}

export function personDraftFrom(person: PersonDraftSource): PersonDraft {
  return {
    name: text(person.name),
    firstName: text(person.firstName),
    middleName: text(person.middleName),
    lastName: text(person.lastName),
    nickname: text(person.nickname),
    pronouns: text(person.pronouns),
    gender: text(person.gender),
    birthDate: text(person.birthDate),
    jobTitle: text(person.jobTitle),
    organization: text(person.organization),
    department: text(person.department),
    website: text(person.website),
    avatarUrl: text(person.avatarUrl),
    description: text(person.description),
    // Only email/phone are editable here — 'name' identifiers are machine
    // asserted for duplicate detection and would be destroyed by a round-trip.
    contacts: (person.identifiers ?? [])
      .filter((identifier) => identifier.kind === 'email' || identifier.kind === 'phone')
      .map((identifier) => ({
        key: nextRowKey('contact'),
        kind: identifier.kind as PersonContactKind,
        // Prefer the raw form: it is what the user typed, and re-submitting the
        // normalized value would overwrite +1 (555) 010-0100 with 5550100100.
        value: identifier.rawValue?.trim() || identifier.value,
        label: text(identifier.label),
      })),
    addresses: (person.addresses ?? []).map((address) => ({
      key: nextRowKey('address'),
      label: text(address.label),
      streetAddress: text(address.streetAddress),
      streetAddress2: text(address.streetAddress2),
      city: text(address.city),
      region: text(address.region),
      postalCode: text(address.postalCode),
      country: text(address.country),
    })),
  };
}

export function isAddressEmpty(address: PersonAddressDraft): boolean {
  return (
    address.streetAddress.trim() === '' &&
    address.streetAddress2.trim() === '' &&
    address.city.trim() === '' &&
    address.region.trim() === '' &&
    address.postalCode.trim() === '' &&
    address.country.trim() === ''
  );
}

/**
 * A display name for people who filled in the name parts but not the full name.
 * Saving a person with a blank `name` would make them unfindable in every list
 * that renders `name`, so the parts stand in for it.
 */
export function composedName(draft: PersonDraft): string {
  const explicit = draft.name.trim();
  if (explicit !== '') {
    return explicit;
  }

  const composed = [draft.firstName, draft.middleName, draft.lastName]
    .map((part) => part.trim())
    .filter((part) => part !== '')
    .join(' ');

  return composed !== '' ? composed : draft.nickname.trim();
}

/**
 * The mutation input for a draft. Blank rows are dropped; blank scalars are
 * sent as empty strings so the server clears the stored property (the whole
 * point of blanking a field in an edit form).
 */
export function personDraftToInput(draft: PersonDraft) {
  return {
    name: composedName(draft),
    description: draft.description.trim(),
    firstName: draft.firstName.trim(),
    middleName: draft.middleName.trim(),
    lastName: draft.lastName.trim(),
    nickname: draft.nickname.trim(),
    pronouns: draft.pronouns.trim(),
    gender: draft.gender.trim(),
    birthDate: draft.birthDate.trim(),
    jobTitle: draft.jobTitle.trim(),
    organization: draft.organization.trim(),
    department: draft.department.trim(),
    website: draft.website.trim(),
    avatarUrl: draft.avatarUrl.trim(),
    addresses: draft.addresses
      .filter((address) => !isAddressEmpty(address))
      .map((address, index) => ({
        label: address.label.trim(),
        streetAddress: address.streetAddress.trim(),
        streetAddress2: address.streetAddress2.trim(),
        city: address.city.trim(),
        region: address.region.trim(),
        postalCode: address.postalCode.trim(),
        country: address.country.trim(),
        isPrimary: index === 0,
      })),
    contacts: draft.contacts
      .filter((contact) => contact.value.trim() !== '')
      .map((contact, index, all) => ({
        kind: contact.kind,
        value: contact.value.trim(),
        label: contact.label.trim(),
        // The first row of each kind is that kind's preferred contact method.
        isPrimary: all.findIndex((other) => other.kind === contact.kind) === index,
      })),
  };
}
