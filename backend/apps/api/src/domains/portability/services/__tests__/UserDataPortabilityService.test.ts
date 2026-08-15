import { BadRequestException } from '@nestjs/common';
import type { DataSource, QueryRunner } from 'typeorm';

import type { LoggerService } from '@ci/common/logging';
import type { FileService } from '@ci/domains/files';
import type { UserService } from '@ci/domains/user';

import { UserDataPortabilityService } from '../UserDataPortabilityService';

describe('UserDataPortabilityService', () => {
  const queryRunner = {
    connect: jest.fn(),
    startTransaction: jest.fn(),
    commitTransaction: jest.fn(),
    rollbackTransaction: jest.fn(),
    release: jest.fn(),
    query: jest.fn(),
  } as unknown as QueryRunner;

  const dataSource = {
    query: jest.fn(),
    createQueryRunner: jest.fn(() => queryRunner),
  } as unknown as DataSource;

  const fileService = {
    getFileContent: jest.fn(),
    putObject: jest.fn(),
  } as unknown as FileService;

  const userService = {
    findById: jest.fn(),
  } as unknown as UserService;

  const logger = {
    setContext: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  } as unknown as LoggerService;

  let service: UserDataPortabilityService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new UserDataPortabilityService(dataSource, fileService, userService, logger);
  });

  it('exports discovered user tables and profile metadata', async () => {
    dataSource.query = jest
      .fn()
      .mockResolvedValueOnce([{ schema: 'ci', table: 'notes', user_column: 'user_id' }])
      .mockResolvedValueOnce([{ id: 'n1', title: 'Hello', user_id: 'user-1' }]);

    userService.findById = jest.fn().mockResolvedValue({
      id: 'user-1',
      name: 'Jane',
      email: 'jane@example.com',
      entityId: null,
      onboarded: true,
      onboardedAt: null,
      timezone: 'UTC',
      onboardingProgress: null,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    });

    const archive = await service.exportArchive({ userId: 'user-1' } as never);

    expect(archive.version).toBe(1);
    expect(archive.userId).toBe('user-1');
    expect(archive.profile?.email).toBe('jane@example.com');
    expect(archive.tables['ci.notes']).toEqual([{ id: 'n1', title: 'Hello', user_id: 'user-1' }]);
    expect(archive.fileBlobs).toEqual([]);
  });

  it('rejects archives exported for a different account', async () => {
    await expect(
      service.importArchive({ userId: 'user-1' } as never, {
        version: 1,
        exportedAt: new Date().toISOString(),
        userId: 'other-user',
        profile: null,
        tables: {},
        fileBlobs: [],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
