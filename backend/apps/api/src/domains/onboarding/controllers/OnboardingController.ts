import { Body, Controller, UseGuards, NotFoundException, Post } from '@nestjs/common';

import { Context } from '@ci/common/decorators';
import { JwtAuthGuard } from '@ci/common/guards';
import { ValidationPipe } from '@ci/common/pipes';
import { RequestContext } from '@ci/common/types';
import { MessageService, ThreadService } from '@ci/domains/conversations';
import { ActionService, AnswerService, QuestionService } from '@ci/domains/intelligence';
import { UserService } from '@ci/domains/user';

import { type OnboardingInput, OnboardingInputSchema } from '../types';

@Controller('onboarding')
export class OnboardingController {
  constructor(
    private readonly userService: UserService,
    private readonly threadService: ThreadService,
    private readonly messageService: MessageService,
    private readonly actionService: ActionService,
    private readonly questionService: QuestionService,
    private readonly answerService: AnswerService,
  ) {}

  @UseGuards(JwtAuthGuard)
  @Post('onboard')
  async onboard(
    @Context() context: RequestContext,
    @Body(new ValidationPipe(OnboardingInputSchema)) input: OnboardingInput,
  ) {
    const userId = context.userId;

    if (userId == null) {
      throw new NotFoundException();
    }

    const user = await this.userService.findOne(context.userId!);

    if (!user) {
      throw new NotFoundException();
    }

    if (!user.onboarded) {
      const [mealThread, movieThread, activityThread] = await Promise.all([
        this.threadService.create(context, {
          name: 'Plan a meal',
        }),
        this.threadService.create(context, {
          name: 'Plan a movie',
        }),
        this.threadService.create(context, {
          name: 'Plan an activity',
        }),
      ]);

      await Promise.all([
        this.messageService.create(context, {
          role: 'assistant',
          model: 'qwen3:8b',
          content: 'Would you like me to help you plan a meal that you will enjoy?',
          threadId: mealThread.id,
        }),

        this.messageService.create(context, {
          role: 'assistant',
          model: 'qwen3:8b',
          content: 'Would you like me to help you find a movie that you will enjoy?',
          threadId: movieThread.id,
        }),

        this.messageService.create(context, {
          role: 'assistant',
          model: 'qwen3:8b',
          content: 'Would you like me to help you find an activity that you will enjoy?',
          threadId: activityThread.id,
        }),

        this.actionService.create(context, {
          title: 'Make dinner tonight',
          text: "Because you haven't cooked meal yet this week, I am recommending you plan something.",
          imageUrl: '/actions/dinner.jpg',
          priority: 0,
          threadId: mealThread.id,
        }),

        this.actionService.create(context, {
          title: 'Watch a movie',
          text: "Why don't you watch a movie tonight? It's a simple way for you to relax and unwind.",
          imageUrl: '/actions/movie_night.jpg',
          priority: 1,
          threadId: movieThread.id,
        }),

        this.actionService.create(context, {
          title: 'Take a break this weekend',
          text: 'The weekend is a perfect opportunity to step away from routine and recharge in a different environment. Taking time outside the usual surroundings can bring a refreshing change of pace and perspective.',
          imageUrl: '/actions/woods.jpg',
          priority: 2,
          threadId: activityThread.id,
        }),
      ]);
    }

    const [favoriteFoodQuestion, favoriteMovieGenreQuestion, favoriteActivityQuestion] = await Promise.all([
      input.food_preference
        ? this.questionService.create(context, {
            text: 'Choosing a food between pasta, burgers, salads, or tacos, which would be your favorite?',
            subcategory: 'Food',
          })
        : Promise.resolve(),

      input.movie_preference
        ? this.questionService.create(context, {
            text: 'Choosing a movie genre between comedies, dramas, documentaries, or horror, which would be your favorite?',
            subcategory: 'Entertainment',
          })
        : Promise.resolve(),

      input.activity_preference
        ? this.questionService.create(context, {
            text: 'Choosing an activity between hiking, bowling, ice skating, or going arcading, which would be your favorite?',
            subcategory: 'Entertainment',
          })
        : Promise.resolve(),
    ]);

    await Promise.all([
      input.food_preference
        ? this.answerService.create(context, {
            text: input.food_preference,
            question: favoriteFoodQuestion!,
          })
        : Promise.resolve(),

      input.movie_preference
        ? this.answerService.create(context, {
            text: input.movie_preference,
            question: favoriteMovieGenreQuestion!,
          })
        : Promise.resolve(),

      input.activity_preference
        ? this.answerService.create(context, {
            text: input.activity_preference,
            question: favoriteActivityQuestion!,
          })
        : Promise.resolve(),
    ]);

    if (!user.onboarded) {
      await this.userService.onboard(userId);
    }

    return {
      onboarded: true,
    };
  }
}
