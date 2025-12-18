import { UseGuards } from '@nestjs/common';
import { Mutation, Parent, Query, ResolveField, Resolver, Args, ID } from '@nestjs/graphql';

import { Context, type RequestContext, toServiceContext } from '@ci/common/context';
import { JwtAuthGuard } from '@ci/common/guards';
import { AnswerService } from '@ci/domains/intelligence';

import { CreateAnswerInput } from '../types/CreateAnswerInput';
import { GlobalUID } from '../types/GlobalUID';
import { PaginationArgs } from '../types/PaginationArgs';
import { AnswerConnection } from '../types/AnswerConnection';
import { AnswerEdge } from '../types/AnswerEdge';
import { AnswerType } from '../types/AnswerType';
import { RemoveAnswerInput } from '../types/RemoveAnswerInput';
import { UpdateAnswerInput } from '../types/UpdateAnswerInput';
import { Paginator } from '../utils/Paginator';
import { QuestionConnection } from '../types/QuestionConnection'
import { QuestionLoader } from '../loaders/QuestionLoader'
import { QuestionType } from '../types/QuestionType'
import { QuestionEdge } from '../types/QuestionEdge'

@UseGuards(JwtAuthGuard)
@Resolver(() => AnswerType)
export class AnswerResolver {
  constructor(
    private readonly answerService: AnswerService,
    private readonly questionLoader: QuestionLoader,
  ) {}

  @Mutation(() => AnswerType)
  async createAnswer(
    @Context() context: RequestContext,
    @Args('input') input: CreateAnswerInput,
  ): Promise<AnswerType> {
    const serviceContext = toServiceContext(context);

    const entity = await this.answerService.create(serviceContext, {
      text: input.answer,
      question: {
        id: input.questionId
      }
    });

    return AnswerType.toType(entity);
  }

  @Mutation(() => AnswerType, { nullable: true })
  async updateAnswer(
    @Context() context: RequestContext,
    @Args('input') input: UpdateAnswerInput,
  ): Promise<AnswerType | null> {
    const serviceContext = toServiceContext(context);

    const entity = await this.answerService.update(serviceContext, input.id, {
      text: input.answer,
    });

    return entity ? AnswerType.toType(entity) : entity;
  }

  @Mutation(() => Boolean)
  async removeAnswer(
    @Context() context: RequestContext,
    @Args('input') input: RemoveAnswerInput,
  ): Promise<boolean> {
    const serviceContext = toServiceContext(context);

    return this.answerService.remove(serviceContext, input.id);
  }

  @Query(() => AnswerConnection)
  async answers(
    @Context() context: RequestContext,
    @Args() pagination: PaginationArgs,
  ): Promise<AnswerConnection> {
    const serviceContext = toServiceContext(context);

    const entities = await this.answerService.findAll(serviceContext);

    const { slice, pageInfo, totalCount } = Paginator.paginate(entities, {
      ...pagination,
      getId: (entity) => GlobalUID.encode('answer', entity.id),
    });

    const edges: AnswerEdge[] = slice.map((entity) => {
      const node = AnswerType.toType(entity);

      return {
        node,
        cursor: node.id,
      };
    });

    return {
      edges,
      pageInfo,
      totalCount,
    };
  }

  @Query(() => AnswerType, { nullable: true })
  async answer(
    @Context() context: RequestContext,
    @Args('id', { type: () => ID }) gid: string,
  ): Promise<AnswerType | null> {
    const serviceContext = toServiceContext(context);

    const id = GlobalUID.parse('answer', gid);

    const entity = await this.answerService.findById(serviceContext, id);

    return entity ? AnswerType.toType(entity) : null;
  }

  @ResolveField(() => QuestionEdge)
  async question(
    @Context() context: RequestContext,
    @Parent() answer: AnswerType,
  ): Promise<QuestionEdge | null> {
    const serviceContext = toServiceContext(context);

    if (!answer.questionId) return null

    const question = await this.questionLoader.load(serviceContext, answer.questionId);

    const { slice, pageInfo, totalCount } = Paginator.paginate([question], {
      getId: (question) => GlobalUID.encode('question', question!.id),
    });

    const node = QuestionType.toType(question!);

    return {
      node,
      cursor: node.id,
    }
  }
}
