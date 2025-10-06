import { Controller, UseGuards, NotFoundException, Post } from '@nestjs/common';

import { Context } from '@ci/common/decorators';
import { JwtAuthGuard } from '@ci/common/guards';
import { RequestContext } from '@ci/common/types';
import { MessageService, ThreadService } from '@ci/domains/conversations';
import { ActionService, AnswerService, QuestionService } from '@ci/domains/intelligence';
import { UserService } from '@ci/domains/user';

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
  async onboard(@Context() context: RequestContext) {
    const userId = context.userId;

    if (userId == null) {
      throw new NotFoundException();
    }

    const user = await this.userService.findOne(context.userId!);

    if (!user) {
      throw new NotFoundException();
    }

    if (!user.onboarded) {
      const mealPlanThread = await this.threadService.create(context, {
        name: 'Plan a meal',
      });

      await this.messageService.create(context, {
        role: 'assistant',
        model: 'qwen3:8b',
        content: 'Would you like me to help you plan a meal that you will enjoy?',
        threadId: mealPlanThread.id,
      });

      await this.actionService.create(context, {
        title: 'Make dinner tonight',
        text: "Because you haven't cooked meal yet this week, I am recommending you plan something.",
        imageUrl: '/actions/dinner.jpg',
        threadId: mealPlanThread.id,
      });

      const moviePlanThread = await this.threadService.create(context, {
        name: 'Plan a movie',
      });

      await this.messageService.create(context, {
        role: 'assistant',
        model: 'qwen3:8b',
        content: 'Would you like me to help you find a movie that you will enjoy?',
        threadId: moviePlanThread.id,
      });

      await this.actionService.create(context, {
        title: 'Watch a movie',
        text: "Why don't you watch a movie tonight? It's a simple way for you to relax and unwind.",
        imageUrl: '/actions/movie_night.jpg',
        threadId: moviePlanThread.id,
      });

      const activityPlanThread = await this.threadService.create(context, {
        name: 'Plan an activity',
      });

      await this.messageService.create(context, {
        role: 'assistant',
        model: 'qwen3:8b',
        content: 'Would you like me to help you find an activity that you will enjoy?',
        threadId: activityPlanThread.id,
      });

      await this.actionService.create(context, {
        title: 'Take a break this weekend',
        text: 'The weekend is a perfect opportunity to step away from routine and recharge in a different environment. Taking time outside the usual surroundings can bring a refreshing change of pace and perspective.',
        imageUrl: '/actions/woods.jpg',
        threadId: activityPlanThread.id,
      });
    }

    const favoriteFoodQuestion = await this.questionService.create(context, {
      id: 'a5a41ec2-2ece-4f91-a5c5-553d131a31e3',
      text: 'Choosing a food between pasta, burgers, salads, or tacos, which would be your favorite?',
      subcategory: 'Food',
    });

    const favoriteMovieGenreQuestion = await this.questionService.create(context, {
      id: '60dcbecc-5480-4195-bd41-dde438f53335',
      text: 'Choosing a movie genre between comedies, dramas, documentaries, or horror, which would be your favorite?',
      subcategory: 'Entertainment',
    });

    const favoriteActivityQuestion = await this.questionService.create(context, {
      id: 'e7c09dec-9b0e-4edd-b79b-31dbd1a74688',
      text: 'Choosing an activity between hiking, bowling, ice skating, or going arcading, which would be your favorite?',
      subcategory: 'Entertainment',
    });

    await this.answerService.create(context, {
      id: '06f1b7cd-7e97-4b8a-b485-673d1e6e35d5',
      text: 'Pasta',
      question: favoriteFoodQuestion,
    });

    await this.answerService.create(context, {
      id: '4a61080b-f82d-4b00-949f-0d4f3ba9a17b',
      text: 'Comedies',
      question: favoriteMovieGenreQuestion,
    });

    await this.answerService.create(context, {
      id: 'c53b1be2-0c82-41e7-b61d-5aa537275d06',
      text: 'Hiking',
      question: favoriteActivityQuestion,
    });

    if (!user.onboarded) {
      await this.userService.onboard(userId);
    }

    return {
      onboarded: true,
    };
  }
}
