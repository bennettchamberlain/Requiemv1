import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';

import { Context, type RequestContext, toServiceContext } from '@ci/common/context';
import { JwtOrApiKeyAuthGuard } from '@ci/common/guards';
import { ValidationPipe } from '@ci/common/pipes';
import { UserService } from '@ci/domains/user';

const deleteAccountSchema = z.object({
  /**
   * The account's own email address, retyped. Not an authorisation check — the bearer
   * credential is that — but a deliberate speed bump in front of an irreversible
   * action, so a stray client call or a mistapped button cannot end an account.
   */
  confirmEmail: z.string().min(1),
});

/**
 * Account lifecycle: the counterpart to `SignupController`.
 *
 * Exists because both stores require it. Apple Guideline 5.1.1(v) and Google Play's
 * Data Deletion policy say an app offering in-app account creation must offer in-app
 * account deletion, and Companion's signup page is exactly that. Self-hosting is not
 * an exemption: Apple wants the *initiation* path inside the app even though the data
 * lives on the user's own appliance.
 */
@Controller('account')
export class AccountController {
  constructor(private readonly userService: UserService) {}

  /**
   * Delete the authenticated user's account: revoke access now, purge the data later
   * (see `UserService.requestDeletion`).
   *
   * Guarded by `JwtOrApiKeyAuthGuard`, not the `JwtAuthGuard` used by the other
   * sensitive `/keys`-style routes, and that is load-bearing rather than lax. The
   * native app never holds a JWT — it trades one for a durable API key at login and
   * authenticates with `x-api-key` from then on — so a JWT-only route would be
   * unreachable from the App Store build, i.e. unreachable from the only client the
   * requirement is actually about. It does not widen the blast radius either: an
   * attacker holding that key can already read every memory the account has.
   *
   * Password re-authentication is deliberately NOT the confirmation. Accounts created
   * through OIDC are given a random 32-byte password they have never seen
   * (`OidcController`, `PortalTokenService`), so requiring it would make deletion
   * impossible for exactly the users who signed in with CI-Portal. Retyping the email
   * works for every sign-in method.
   */
  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtOrApiKeyAuthGuard)
  async remove(
    @Context() context: RequestContext,
    @Body(new ValidationPipe(deleteAccountSchema)) input: { confirmEmail: string },
  ): Promise<void> {
    // Throws UnauthorizedException on its own if the request carries no user.
    const serviceContext = toServiceContext(context);
    const user = await this.userService.findById(serviceContext, serviceContext.userId);

    // Already soft-deleted accounts stop resolving, so a replayed request lands here
    // rather than re-stamping the deletion.
    if (!user) {
      throw new UnauthorizedException();
    }

    // Case- and whitespace-insensitive: the user is retyping to prove intent, not
    // reproducing a stored string byte for byte.
    if (input.confirmEmail.trim().toLowerCase() !== user.email.trim().toLowerCase()) {
      throw new BadRequestException('Confirmation email does not match this account');
    }

    await this.userService.requestDeletion(serviceContext, user.id);
  }
}
