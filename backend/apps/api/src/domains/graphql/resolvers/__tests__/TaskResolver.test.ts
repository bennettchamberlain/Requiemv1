import { ForbiddenException } from '@nestjs/common';

import { type RequestContext } from '@ci/common/context';

import { TaskResolver } from '../TaskResolver';

const ownerCtx = { userId: 'owner-1' } as unknown as RequestContext;

function makeResolver(enabled = true) {
  const taskService = {
    create: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
    complete: jest.fn(),
    reopen: jest.fn(),
    defer: jest.fn(),
    findAll: jest.fn().mockResolvedValue([]),
    findById: jest.fn(),
  };
  const featureService = { isFeatureEnabled: jest.fn().mockResolvedValue(enabled) };

  return {
    resolver: new TaskResolver(taskService as never, featureService as never),
    taskService,
    featureService,
  };
}

describe('TaskResolver feature gating', () => {
  it('gates reads on planning.enabled', async () => {
    const { resolver, featureService } = makeResolver();

    await resolver.tasks(ownerCtx, {});

    expect(featureService.isFeatureEnabled).toHaveBeenCalledWith('planning.enabled');
  });

  it('returns an empty connection without reading when the flag is off', async () => {
    const { resolver, taskService } = makeResolver(false);

    await expect(resolver.tasks(ownerCtx, {})).resolves.toEqual({
      edges: [],
      pageInfo: { hasNextPage: false, hasPreviousPage: false, startCursor: null, endCursor: null },
      totalCount: 0,
    });
    expect(taskService.findAll).not.toHaveBeenCalled();
  });

  it('refuses writes when the flag is off', async () => {
    const { resolver, taskService } = makeResolver(false);

    await expect(resolver.createTask(ownerCtx, { title: 'Call the dentist' })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(taskService.create).not.toHaveBeenCalled();
  });
});
