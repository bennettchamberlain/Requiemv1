import { PersonEntity } from './entities/PersonEntity';
import {
  type PersonAddress,
  ensureSinglePrimary,
  formatPersonAddress,
  isPersonAddressEmpty,
  readPersonAddresses,
  serializePersonAddress,
} from './types';

function address(overrides: Partial<PersonAddress> = {}): PersonAddress {
  return {
    label: null,
    streetAddress: null,
    streetAddress2: null,
    city: null,
    region: null,
    postalCode: null,
    country: null,
    isPrimary: false,
    ...overrides,
  };
}

describe('readPersonAddresses', () => {
  it('reads the stored list, dropping blank entries', () => {
    const addresses = readPersonAddresses({
      addresses: [
        { label: 'home', street_address: '1 Elm St', city: 'Portland', is_primary: true },
        { label: 'work', street_address: '2 Market St', city: 'Portland' },
        { label: 'ghost' },
      ],
    });

    expect(addresses).toEqual([
      expect.objectContaining({ label: 'home', streetAddress: '1 Elm St', isPrimary: true }),
      expect.objectContaining({ label: 'work', streetAddress: '2 Market St', isPrimary: false }),
    ]);
  });

  it('surfaces the flat legacy keys as a single un-labelled primary address', () => {
    // Rows written before the list existed must still resolve to one address,
    // so every reader sees one shape regardless of when the row was written.
    const addresses = readPersonAddresses({
      street_address: '1 Elm St',
      city: 'Portland',
      region: 'OR',
      postal_code: '97201',
      country: 'US',
    });

    expect(addresses).toEqual([
      {
        label: null,
        streetAddress: '1 Elm St',
        streetAddress2: null,
        city: 'Portland',
        region: 'OR',
        postalCode: '97201',
        country: 'US',
        isPrimary: true,
      },
    ]);
  });

  it('prefers the list over the flat keys when both are present', () => {
    const addresses = readPersonAddresses({
      addresses: [{ label: 'work', city: 'Lisbon' }],
      city: 'Portland',
    });

    expect(addresses).toEqual([expect.objectContaining({ label: 'work', city: 'Lisbon' })]);
  });

  it('returns nothing for a person with no address at all', () => {
    expect(readPersonAddresses({})).toEqual([]);
    expect(readPersonAddresses(null)).toEqual([]);
    expect(readPersonAddresses({ addresses: 'not an array' })).toEqual([]);
  });

  it('ignores whitespace-only values', () => {
    expect(readPersonAddresses({ addresses: [{ city: '   ' }] })).toEqual([]);
  });
});

describe('ensureSinglePrimary', () => {
  it('hoists the flagged address to the front and clears the rest', () => {
    const ordered = ensureSinglePrimary([
      address({ label: 'work', city: 'Lisbon' }),
      address({ label: 'home', city: 'Portland', isPrimary: true }),
    ]);

    expect(ordered.map((entry) => [entry.label, entry.isPrimary])).toEqual([
      ['home', true],
      ['work', false],
    ]);
  });

  it('promotes the first address when none is flagged', () => {
    const ordered = ensureSinglePrimary([address({ label: 'work' }), address({ label: 'home' })]);

    expect(ordered.map((entry) => entry.isPrimary)).toEqual([true, false]);
  });

  it('leaves an empty list alone', () => {
    expect(ensureSinglePrimary([])).toEqual([]);
  });
});

describe('formatPersonAddress', () => {
  it('joins the populated parts in postal order', () => {
    expect(
      formatPersonAddress(
        address({
          streetAddress: '1 Elm St',
          streetAddress2: 'Apt 4',
          city: 'Portland',
          region: 'OR',
          postalCode: '97201',
          country: 'US',
        }),
      ),
    ).toBe('1 Elm St, Apt 4, Portland, OR, 97201, US');
  });

  it('returns null when there is nothing to render', () => {
    expect(formatPersonAddress(address())).toBeNull();
  });
});

describe('serializePersonAddress', () => {
  it('round-trips through the jsonb storage shape', () => {
    const original = address({ label: 'home', streetAddress: '1 Elm St', isPrimary: true });

    expect(readPersonAddresses({ addresses: [serializePersonAddress(original)] })).toEqual([original]);
  });
});

describe('isPersonAddressEmpty', () => {
  it('ignores the label and primary flag when deciding emptiness', () => {
    expect(isPersonAddressEmpty(address({ label: 'home', isPrimary: true }))).toBe(true);
    expect(isPersonAddressEmpty(address({ country: 'US' }))).toBe(false);
  });
});

describe('PersonEntity normalized profile fields', () => {
  it('projects the profile keys out of the properties bag and strips them from egress', () => {
    const entity = new PersonEntity();
    entity.id = '00000000-0000-0000-0000-0000000000aa';
    entity.properties = {
      nickname: 'Dee',
      pronouns: 'they/them',
      gender: 'Non-binary',
      job_title: 'Engineer',
      organization: 'Lifescope',
      department: 'Platform',
      website: 'https://example.com',
      addresses: [{ label: 'home', city: 'Portland' }],
      // Source-specific data, which must survive on the egress bag.
      linkedin: 'dee',
    };

    entity.loadPropertiesFromJsonb();

    expect(entity.nickname).toBe('Dee');
    expect(entity.pronouns).toBe('they/them');
    expect(entity.jobTitle).toBe('Engineer');
    expect(entity.organization).toBe('Lifescope');
    expect(entity.department).toBe('Platform');
    expect(entity.website).toBe('https://example.com');
    expect(entity.addresses).toEqual([expect.objectContaining({ label: 'home', city: 'Portland' })]);

    const egress = PersonEntity.toEgressType(entity);

    expect(egress.nickname).toBe('Dee');
    expect(egress.addresses).toHaveLength(1);
    expect(egress.properties).toEqual({ linkedin: 'dee' });
  });
});
