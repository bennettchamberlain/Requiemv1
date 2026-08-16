import { CommunicationEntity } from '../CommunicationEntity';

/**
 * Locks in the egress preview fallback: importers only send `preview` when
 * clipping shortened the content, so short messages (most chat traffic) land
 * with content but a NULL preview column — readers must fall back to content
 * rather than showing/indexing nothing.
 */
function egress(fields: Partial<CommunicationEntity>) {
  return CommunicationEntity.toEgressType({
    id: 'c1',
    time: new Date('2026-01-01T00:00:00Z'),
    userId: 'u1',
    communicationType: 'chat',
    toEntityIds: [],
    participantsMetadata: {},
    attachments: [],
    preview: null,
    ...fields,
  } as CommunicationEntity);
}

describe('CommunicationEntity.toEgressType preview fallback', () => {
  it('returns a stored preview verbatim', () => {
    const out = egress({ content: 'long content here', preview: 'stored preview' });
    expect(out.preview).toBe('stored preview');
  });

  it('falls back to the content when preview is NULL (short message)', () => {
    const out = egress({ content: 'brb grabbing lunch' });
    expect(out.preview).toBe('brb grabbing lunch');
  });

  it('clips a long content fallback to one line with an ellipsis, matching the importer shape', () => {
    const out = egress({ content: `${'word '.repeat(60)}end\nsecond line` });
    expect(out.preview).toHaveLength(140);
    expect(out.preview!.endsWith('…')).toBe(true);
    expect(out.preview).not.toContain('\n');
  });

  it('keeps preview null when there is no content either', () => {
    expect(egress({ content: '' }).preview).toBeNull();
    expect(egress({ content: '   \n  ' }).preview).toBeNull();
  });
});
