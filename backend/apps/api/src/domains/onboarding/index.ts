/**
 * This module orchestrates the user onboarding process. It provides the necessary
 * endpoints to guide a new user through the initial setup steps of the application.
 *
 * ### Key Components:
 * - **OnboardingController**: Exposes REST API endpoints that coordinate the various
 *   stages of onboarding, such as creating initial user data or setting up
 *   introductory conversations.
 *
 * ### Module Integration:
 * - **`UserModule`**: To create and configure the user's account.
 * - **`ConversationModule`**: To initialize welcome messages or introductory threads.
 * - **`IntelligenceModule`**: To potentially trigger initial data processing or
 *   intelligence-gathering tasks for the new user.
 *
 * @module OnboardingModule
 */

import { Module } from '@nestjs/common';

import { ConversationModule } from '@ci/domains/conversations';
import { IntelligenceModule } from '@ci/domains/intelligence';
import { UserModule } from '@ci/domains/user';

import { OnboardingController } from './controllers/OnboardingController';

/**
 * @internal
 */
@Module({
  imports: [ConversationModule, IntelligenceModule, UserModule],
  providers: [],
  controllers: [OnboardingController],
  exports: [],
})
export class OnboardingModule {}
