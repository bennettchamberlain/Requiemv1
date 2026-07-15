import { type UserServiceContext } from '@ci/common/context';

import { type Ask } from '../entities/AskEntity';
import type { CreateAskDto } from '../types';

import { AskService } from './AskService';

const CTX: UserServiceContext = { userId: 'asker-1' };

const DTO: CreateAskDto = {
  responderUserId: 'responder-1',
  query: { queryType: 'photos', prompt: 'do you have photos of us?' },
};

function fakeAsk(overrides: Partial<Ask> = {}): Ask {
  return {
    id: 'ask-1',
    askerUserId: 'asker-1',
    responderUserId: 'responder-1',
    query: DTO.query,
    status: 'delivered',
    consentBasis: null,
    createdAt: new Date('2026-07-15T00:00:00Z'),
    updatedAt: new Date('2026-07-15T00:00:00Z'),
    expiresAt: null,
    ...overrides,
  } as Ask;
}

function makeService() {
  const grantService = { evaluate: jest.fn() };
  const auditService = { record: jest.fn().mockResolvedValue(undefined) };
  const logger = { setContext: jest.fn() };
  const service = new AskService(
    {} as never, // repository — create/systemTransition/setConsentBasis are spied
    grantService as never,
    auditService as never,
    logger as never,
  );

  return { service, grantService, auditService };
}

describe('AskService.submit — grant decision wiring', () => {
  it('auto-declines and audits when a block grant denies the ask', async () => {
    const { service, grantService, auditService } = makeService();
    grantService.evaluate.mockResolvedValue({ decision: 'deny', grantId: 'grant-block' });
    jest.spyOn(service, 'create').mockResolvedValue(fakeAsk());
    const declined = fakeAsk({ status: 'declined', consentBasis: 'grant-block' });
    const sysSpy = jest.spyOn(service, 'systemTransition').mockResolvedValue(declined);

    const result = await service.submit(CTX, DTO);

    expect(sysSpy).toHaveBeenCalledWith('ask-1', 'declined', { consentBasis: 'grant-block' });
    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({ askId: 'ask-1', outcome: 'declined', consentBasis: 'grant-block' }),
    );
    expect(result).toEqual({ ask: declined, decision: 'deny' });
  });

  it('records the consent basis and leaves the ask delivered when auto-authorized', async () => {
    const { service, grantService, auditService } = makeService();
    grantService.evaluate.mockResolvedValue({ decision: 'auto', grantId: 'grant-auto' });
    jest.spyOn(service, 'create').mockResolvedValue(fakeAsk());
    const preauth = fakeAsk({ consentBasis: 'grant-auto' });
    const consentSpy = jest.spyOn(service, 'setConsentBasis').mockResolvedValue(preauth);
    const sysSpy = jest.spyOn(service, 'systemTransition');

    const result = await service.submit(CTX, DTO);

    expect(consentSpy).toHaveBeenCalledWith('ask-1', 'grant-auto');
    expect(sysSpy).not.toHaveBeenCalled(); // stays delivered for the executor
    expect(auditService.record).not.toHaveBeenCalled(); // no terminal outcome yet
    expect(result).toEqual({ ask: preauth, decision: 'auto' });
  });

  it('routes to the owner review inbox when no grant matches', async () => {
    const { service, grantService, auditService } = makeService();
    grantService.evaluate.mockResolvedValue({ decision: 'review' });
    jest.spyOn(service, 'create').mockResolvedValue(fakeAsk());
    const inboxed = fakeAsk({ status: 'under_review' });
    const sysSpy = jest.spyOn(service, 'systemTransition').mockResolvedValue(inboxed);

    const result = await service.submit(CTX, DTO);

    expect(sysSpy).toHaveBeenCalledWith('ask-1', 'under_review');
    expect(auditService.record).not.toHaveBeenCalled();
    expect(result).toEqual({ ask: inboxed, decision: 'review' });
  });
});
