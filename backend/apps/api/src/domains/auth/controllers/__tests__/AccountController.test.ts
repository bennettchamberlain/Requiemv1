import { BadRequestException, UnauthorizedException } from '@nestjs/common';

import { AccountController } from '../AccountController';

/**
 * `DELETE /account` is the in-app account deletion both stores require (Apple
 * 5.1.1(v), Google Play Data Deletion). It is irreversible from the user's side, so
 * these tests pin the two things that matter: a matching confirmation deletes, and
 * ANYTHING else deletes nothing.
 */
function makeController(
  user: { id: string; email: string } | null = { id: 'u1', email: 'jsmith@example.com' },
) {
  const userService = {
    findById: jest.fn().mockResolvedValue(user),
    requestDeletion: jest.fn().mockResolvedValue(true),
  };

  const controller = new AccountController(userService as never);

  return { controller, userService };
}

// A fresh object per test: toServiceContext caches on the RequestContext identity.
const requestContext = () => ({ userId: 'u1' });

describe('AccountController — delete account', () => {
  it('requests deletion when the confirmation email matches the account', async () => {
    const { controller, userService } = makeController();

    await controller.remove(requestContext(), { confirmEmail: 'jsmith@example.com' });

    expect(userService.requestDeletion).toHaveBeenCalledWith({ userId: 'u1' }, 'u1');
  });

  it('accepts a confirmation that differs only by case or surrounding space', async () => {
    const { controller, userService } = makeController();

    // The user is retyping to prove intent, not reproducing a stored string byte-for-byte.
    await controller.remove(requestContext(), { confirmEmail: '  JSmith@Example.COM  ' });

    expect(userService.requestDeletion).toHaveBeenCalledTimes(1);
  });

  it('rejects a mismatched confirmation and deletes NOTHING', async () => {
    const { controller, userService } = makeController();

    await expect(controller.remove(requestContext(), { confirmEmail: 'someone@else.com' })).rejects.toThrow(
      BadRequestException,
    );

    expect(userService.requestDeletion).not.toHaveBeenCalled();
  });

  it('rejects when the account no longer resolves (replayed request after deletion)', async () => {
    // Soft-deleted users stop resolving through findById, so a replay lands here.
    const { controller, userService } = makeController(null);

    await expect(controller.remove(requestContext(), { confirmEmail: 'jsmith@example.com' })).rejects.toThrow(
      UnauthorizedException,
    );

    expect(userService.requestDeletion).not.toHaveBeenCalled();
  });
});
