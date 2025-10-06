import { Controller, UseGuards, NotFoundException, Post } from '@nestjs/common';

import { Context } from '@ci/common/decorators';
import { JwtAuthGuard } from '@ci/common/guards';
import { RequestContext } from '@ci/common/types';
import { UserService } from '@ci/domains/user';
import { MessageService, ThreadService } from '@ci/domains/conversations';
import { ActionService, AnswerService, QuestionService } from '@ci/domains/intelligence';

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

    await this.userService.onboard(userId);

    return {
      onboarded: true,
    };
  }
}
