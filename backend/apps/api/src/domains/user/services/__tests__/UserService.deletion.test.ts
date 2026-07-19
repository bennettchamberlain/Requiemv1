import { UnauthorizedException } from '@nestjs/common';
import bcryptModule from 'bcrypt';
import { getMetadataArgsStorage } from 'typeorm';

import { SYSTEM_USER } from '@ci/common/context';

import { UserEntity } from '../../entities/UserEntity';
import { UserRemovedEvent } from '../../events';
import { UserService } from '../UserService';

jest.mock('bcrypt', () => ({ hash: jest.fn(), compare: jest.fn() }));

const bcrypt = bcryptModule as unknown as { compare: jest.Mock };

const PURGE_GRACE_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

function makeService() {
  const userRepository = {
    findOne: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    save: jest.fn(),
    create: jest.fn(),
    find: jest.fn(),
  };
  const eventService = { send: jest.fn() };

  const service = new UserService(userRepository as never, eventService as never);

  return { service, userRepository, eventService };
}

// `makeService()` hands out fresh repository mocks per test, but the bcrypt module mock
// is shared across the file — without this its call history leaks between tests.
beforeEach(() => {
  jest.clearAllMocks();
});

const OWN = { userId: 'user-1' } as never;
const OTHER = { userId: 'user-2' } as never;
const SYSTEM = { userId: SYSTEM_USER } as never;

const storedUser = { id: 'user-1', email: 'jsmith@example.com', password: 'hashed' };

describe('UserService — account deletion', () => {
  /**
   * The whole access gate rests on this decorator: TypeORM excludes soft-deleted rows
   * from every read on the repository BECAUSE the entity declares a delete-date
   * column. Delete the decorator and deletion silently stops revoking access while
   * every other test here still passes — so pin the mechanism itself.
   */
  it('declares deleted_at as the entity delete-date column (the access gate)', () => {
    const deleteDateColumn = getMetadataArgsStorage().columns.find(
      (column) => column.target === UserEntity && column.mode === 'deleteDate',
    );

    expect(deleteDateColumn).toBeDefined();
    expect(deleteDateColumn?.options.name).toBe('deleted_at');
  });

  it('never exposes deletion state on the egress type', () => {
    const egress = UserEntity.toEgressType({
      ...storedUser,
      name: 'J',
      onboarded: true,
      timezone: 'UTC',
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: new Date(),
      purgeAfter: new Date(),
    } as UserEntity);

    expect(egress).not.toHaveProperty('deletedAt');
    expect(egress).not.toHaveProperty('purgeAfter');
    expect(egress).not.toHaveProperty('password');
  });

  describe('requestDeletion', () => {
    it('soft-deletes and stamps the purge deadline in a SINGLE write', async () => {
      const { service, userRepository, eventService } = makeService();
      userRepository.findOne.mockResolvedValue(storedUser);

      const before = Date.now();
      const result = await service.requestDeletion(OWN, 'user-1');

      expect(result).toBe(true);
      // One write: the access gate and the retention promise must never exist apart.
      expect(userRepository.update).toHaveBeenCalledTimes(1);

      const [id, patch] = userRepository.update.mock.calls[0];
      expect(id).toBe('user-1');
      expect(patch.deletedAt).toBeInstanceOf(Date);
      expect(patch.purgeAfter).toBeInstanceOf(Date);

      // The deadline is pinned at request time (~30d), so later config changes cannot
      // move a promise already made to someone who has left.
      const expected = before + PURGE_GRACE_DAYS * DAY_MS;
      expect(Math.abs((patch.purgeAfter as Date).getTime() - expected)).toBeLessThan(60_000);

      expect(eventService.send).toHaveBeenCalledWith(UserRemovedEvent, { userId: 'user-1' });
    });

    it('lets a user delete their own account', async () => {
      const { service, userRepository } = makeService();
      userRepository.findOne.mockResolvedValue(storedUser);

      await expect(service.requestDeletion(OWN, 'user-1')).resolves.toBe(true);
    });

    it('refuses to delete someone else’s account', async () => {
      const { service, userRepository } = makeService();

      await expect(service.requestDeletion(OTHER, 'user-1')).rejects.toThrow(UnauthorizedException);
      expect(userRepository.update).not.toHaveBeenCalled();
    });

    it('allows the system user (for the future purge job)', async () => {
      const { service, userRepository } = makeService();
      userRepository.findOne.mockResolvedValue(storedUser);

      await expect(service.requestDeletion(SYSTEM, 'user-1')).resolves.toBe(true);
    });

    it('is idempotent: a second request finds nothing and does not rewrite the deadline', async () => {
      const { service, userRepository, eventService } = makeService();
      // The first request hid the row, so the repository no longer returns it.
      userRepository.findOne.mockResolvedValue(null);

      await expect(service.requestDeletion(OWN, 'user-1')).resolves.toBe(false);
      expect(userRepository.update).not.toHaveBeenCalled();
      expect(eventService.send).not.toHaveBeenCalled();
    });
  });

  /**
   * Auth resolves users through exactly these three methods. If any of them ever opts
   * out of the soft-delete filter with `withDeleted: true`, a deleted account starts
   * authenticating again — the one failure this feature exists to prevent.
   */
  describe('the auth entry points keep the soft-delete filter', () => {
    it('findById (JWT + API key) does not opt out', async () => {
      const { service, userRepository } = makeService();
      userRepository.findOne.mockResolvedValue(storedUser);

      await service.findById(OWN, 'user-1');

      expect(userRepository.findOne).toHaveBeenCalledWith({ where: { id: 'user-1' } });
      expect(userRepository.findOne.mock.calls[0][0]).not.toHaveProperty('withDeleted');
    });

    it('findByEmail (OIDC) does not opt out', async () => {
      const { service, userRepository } = makeService();
      userRepository.findOne.mockResolvedValue(storedUser);

      await service.findByEmail('jsmith@example.com');

      expect(userRepository.findOne.mock.calls[0][0]).not.toHaveProperty('withDeleted');
    });

    it('validatePassword (login) does not opt out', async () => {
      const { service, userRepository } = makeService();
      userRepository.findOne.mockResolvedValue(storedUser);
      bcrypt.compare.mockResolvedValue(true);

      await service.validatePassword('jsmith@example.com', 'pw');

      expect(userRepository.findOne.mock.calls[0][0]).not.toHaveProperty('withDeleted');
    });

    it('a deleted account authenticates nowhere (the repository hides the row)', async () => {
      const { service, userRepository } = makeService();
      // What the filtered repository returns once the row is soft-deleted.
      userRepository.findOne.mockResolvedValue(null);

      await expect(service.findById(OWN, 'user-1')).resolves.toBeNull();
      await expect(service.findByEmail('jsmith@example.com')).resolves.toBeNull();
      await expect(service.validatePassword('jsmith@example.com', 'pw')).resolves.toBeNull();
      // Never reached the password check — there is no row to compare against.
      expect(bcrypt.compare).not.toHaveBeenCalled();
    });
  });
});
