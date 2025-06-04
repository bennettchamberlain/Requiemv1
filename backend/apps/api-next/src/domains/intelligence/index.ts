import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { QuestionsController } from './controllers/QuestionsController';
import { AnswerEntity } from './entities/AnswerEntity';
import { QuestionEntity } from './entities/QuestionEntity';
import { QuestionService } from './services/QuestionService';

@Module({
  imports: [TypeOrmModule.forFeature([QuestionEntity])],
  providers: [QuestionService],
  controllers: [QuestionsController],
  exports: [QuestionService],
})
export class IntelligenceModule {}

// Entities
export { AnswerEntity, QuestionEntity };

// Services
export { QuestionService };

// Types
export type { Answer, Question } from './types';
