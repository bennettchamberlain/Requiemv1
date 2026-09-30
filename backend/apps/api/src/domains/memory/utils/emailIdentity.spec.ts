import { EMAIL_EVIDENCE, EMAIL_HELD_SCORE, emailHoldReason, holdEmailEvidence } from './emailIdentity';

/*
 * Every name and address here is invented. The shape is a real export's: a
 * card named for a friend that lists the friend's address AND the owner's.
 */

const owner = { name: 'Ada Quill', isSelf: true };

describe('emailHoldReason', () => {
  it('holds a differently named person against the owner', () => {
    expect(emailHoldReason(owner, { name: 'Bo Brightwater', isSelf: false })).toBe('self_endpoint');
    // Either argument order.
    expect(emailHoldReason({ name: 'Bo Brightwater', isSelf: false }, owner)).toBe('self_endpoint');
  });

  it('holds a same-given-name stranger with another surname, and a relational name', () => {
    expect(emailHoldReason(owner, { name: 'Ada Brightwater', isSelf: false })).toBe('self_endpoint');
    expect(emailHoldReason(owner, { name: "Ada's brother", isSelf: false })).toBe('self_endpoint');
  });

  it("folds the owner's own mail stub, named by the address or by nothing", () => {
    expect(emailHoldReason(owner, { name: 'ada@quill.example', isSelf: false })).toBeNull();
    expect(emailHoldReason(owner, { name: null, isSelf: false })).toBeNull();
    expect(emailHoldReason(owner, { name: '+1 (202) 555-0142', isSelf: false })).toBeNull();
  });

  it("folds a name that fits the owner's: the same, an initial, a nickname prefix", () => {
    expect(emailHoldReason(owner, { name: 'Ada Quill', isSelf: false })).toBeNull();
    expect(emailHoldReason(owner, { name: 'A. Quill', isSelf: false })).toBeNull();
    expect(
      emailHoldReason({ name: 'Adaline Quill', isSelf: true }, { name: 'Ada Quill', isSelf: false }),
    ).toBeNull();
  });

  it('leaves two contacts, and two self endpoints, to the ordinary rule', () => {
    expect(
      emailHoldReason({ name: 'Bo Brightwater', isSelf: false }, { name: 'Cy Quill', isSelf: false }),
    ).toBeNull();
    expect(emailHoldReason(owner, { name: 'Bo Brightwater', isSelf: true })).toBeNull();
  });
});

describe('holdEmailEvidence', () => {
  const email = { kind: EMAIL_EVIDENCE.match, value: 'ada@quill.example', score: 0.95 };
  const name = { kind: 'name_overlap', value: 'quill', score: 0.5 };

  it('caps the email below the auto-merge tier and says why', () => {
    expect(holdEmailEvidence({ score: 0.95, evidence: [email, name] }, 'self_endpoint')).toEqual({
      score: EMAIL_HELD_SCORE,
      evidence: [
        { ...email, score: EMAIL_HELD_SCORE },
        name,
        { kind: EMAIL_EVIDENCE.check, value: 'self_endpoint', score: 0 },
      ],
    });
  });

  it('is idempotent', () => {
    const once = holdEmailEvidence({ score: 0.95, evidence: [email] }, 'self_endpoint');

    expect(holdEmailEvidence(once, 'self_endpoint')).toEqual(once);
  });

  it('marks a pair whose shared mailbox the drain found outside its evidence', () => {
    // No email ITEM — the drain also folds on claims and properties — so the
    // marker alone is what must stop the fold.
    expect(holdEmailEvidence({ score: 0.5, evidence: [name] }, 'self_endpoint')).toEqual({
      score: 0.5,
      evidence: [name, { kind: EMAIL_EVIDENCE.check, value: 'self_endpoint', score: 0 }],
    });
  });

  it('never raises the stored score', () => {
    expect(holdEmailEvidence({ score: 0.8, evidence: [email] }, 'self_endpoint').score).toBe(0.8);
  });
});
