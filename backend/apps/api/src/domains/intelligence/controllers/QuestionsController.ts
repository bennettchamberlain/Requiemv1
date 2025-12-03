import {
  Controller,
  Get,
  Post,
  HttpStatus,
  Param,
  Res,
  UseGuards,
  HttpCode,
  NotFoundException,
  Patch,
  Delete,
  Body,
} from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import type { Response } from 'express';

import { Context, Cron } from '@ci/common/decorators';
import { JwtAuthGuard } from '@ci/common/guards';
import { ValidationPipe } from '@ci/common/pipes';
import { LoggerService } from '@ci/common/services';
import { type RequestContext } from '@ci/common/types';
import { toServiceContext } from '@ci/common/utils';
import config from '@ci/configuration';
import { EventService, Events, EventPayloads, OnEvent } from '@ci/domains/events';
import { OllamaService } from '@ci/domains/llm';
import { EmbeddingService } from '@ci/domains/search';

import { Question } from '../entities/QuestionEntity';
import { AnswerService } from '../services/AnswerService';
import { QuestionService } from '../services/QuestionService';
import {
  type CreateQuestionDto,
  type UpdateQuestionDto,
  createQuestionSchema,
  updateQuestionSchema,
} from '../types';

@Controller('questions')
export class QuestionsController {
  private logger = new LoggerService(QuestionsController.name);

  constructor(
    private readonly answerService: AnswerService,
    private readonly embeddingService: EmbeddingService,
    private readonly eventService: EventService,
    private readonly ollamaService: OllamaService,
    private readonly questionService: QuestionService,
  ) {}

  @UseGuards(JwtAuthGuard)
  @Post()
  async create(
    @Context() context: RequestContext,
    @Body(new ValidationPipe(createQuestionSchema)) input: CreateQuestionDto,
  ): Promise<Question> {
    const serviceContext = toServiceContext(context);

    return await this.questionService.create(serviceContext, input);
  }

  @UseGuards(JwtAuthGuard)
  @Get()
  findAll(@Context() context: RequestContext): Promise<Question[]> {
    const serviceContext = toServiceContext(context);

    return this.questionService.findAll(serviceContext);
  }

  @UseGuards(JwtAuthGuard)
  @Get('unanswered')
  async findOneUnanswered(@Context() context: RequestContext, @Res() res: Response) {
    const serviceContext = toServiceContext(context);

    const question = await this.questionService.findOneUnanswered(serviceContext);
    if (!question) {
      return res.status(HttpStatus.NO_CONTENT).send();
    }

    return res.status(HttpStatus.OK).json(question);
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id')
  findById(@Context() context: RequestContext, @Param('id') id: string): Promise<Question | null> {
    const serviceContext = toServiceContext(context);

    return this.questionService.findById(serviceContext, id);
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id')
  async update(
    @Context() context: RequestContext,
    @Param('id') questionId: string,
    @Body(new ValidationPipe(updateQuestionSchema)) data: UpdateQuestionDto,
  ): Promise<Question | null> {
    const serviceContext = toServiceContext(context);

    const question = await this.questionService.update(serviceContext, questionId, data);

    if (!question) {
      throw new NotFoundException('Question not found');
    }

    return question;
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Context() context: RequestContext, @Param('id') questionId: string): Promise<void> {
    const serviceContext = toServiceContext(context);

    const question = await this.questionService.findById(serviceContext, questionId);

    if (!question) {
      throw new NotFoundException('Question not found');
    }

    const removal = this.questionService.remove(serviceContext, questionId);

    if (!removal) {
      throw new NotFoundException();
    }
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async cronProcessQuestions() {
    if (!config.features['scheduled.answer.inferencing']) {
      return;
    }

    this.logger.log('Processing question answer inference cron');

    const unansweredQuestions = await this.questionService.findUnansweredByUserId();

    for (const [userId, questionIds] of unansweredQuestions) {
      for (const questionId of questionIds) {
        this.eventService.send(Events.INFER_QUESTION_ANSWER, {
          ownerId: userId,
          questionId: questionId,
        });
      }
    }
  }

  @OnEvent(Events.INFER_QUESTION_ANSWER)
  async inferQuestionAnswer(payload: EventPayloads[Events.INFER_QUESTION_ANSWER]) {
    const context: RequestContext = {
      userId: payload.ownerId ?? undefined,
    };

    this.logger.log('Inferring answer to question', {
      userId: payload.ownerId,
      questionId: payload.questionId,
    });

    const serviceContext = toServiceContext(context);

    const question = await this.questionService.findById(serviceContext, payload.questionId);

    if (question) {
      const associatedAnswers = await this.embeddingService.findNearest(
        context,
        question.text,
        ['answer'],
        10,
      );

      const resolvedAnswers = await this.answerService.findSome(
        serviceContext,
        associatedAnswers.map((embedding) => embedding.id),
      );

      const ragThread = [
        {
          role: 'system',
          content: `
            I am going to provide you a question that I would ask a user directly.
            I am also going to provide you a list of questions and answers the user has already provided that I consider related context.
            I want you to impersonate the user and infer an answer for the question I provide.
            That is to say your answer should be in the first person as if you were the user.
            You are impersonating a human being, so you must not reveal that you're a machine in any way.

            Please keep the answer short (within 2 to 3 sentences).
            You MUST ONLY return your inferred answer with no additional text.
            You MUST NOT indicate that the answer is inferred.
            Your answer MUST NOT include filler words like "honestly." We are assuming you're being honest.
            Your answer MUST NOT compliment the question in any way. Stick straight to the answer.
          `,
        },
        {
          role: 'system',
          content: 'The next message will be a list of related questions that the user has responded to.',
        },
        {
          role: 'system',
          content: resolvedAnswers
            .map(
              (answer) => `
            Question: ${answer.question?.text}
            Answer: ${answer.answer}
          `,
            )
            .join('\n\n'),
        },
        {
          role: 'system',
          content:
            'The next message will be the question I need you to generate an inferred answer for while impersonating the user.',
        },
        {
          role: 'system',
          content: question.text,
        },
      ];

      // TODO: How can we improve the RAG thread?
      //
      // I was thinking we could include related questions as a start?
      // We should consider cleaning up the ergonomics of embeddingService too though. Holy shit this is dirty.
      //
      // const associatedQuestions = await this.embeddingService.findNearest({}, question.text, 'question', 5);

      const llmResponse = await this.ollamaService.chat({}, ragThread, {
        model: 'gemma3:1b',
      });

      this.logger.log('Inferred answer to question', {
        userId: payload.ownerId,
        questionId: payload.questionId,
        question: question.text,
        response: llmResponse.message.content,
      });

      const userAnswer = await this.answerService.findByQuestionId(serviceContext, payload.questionId);

      if (userAnswer) {
        this.logger.log('Answer exists, updating existing with RAG response');

        await this.answerService.update(serviceContext, userAnswer.id, {
          text: llmResponse.message.content,
        });
      } else {
        this.logger.log('Answer does not exist, creating a new one with a RAG response');
      }
    }
  }
}
