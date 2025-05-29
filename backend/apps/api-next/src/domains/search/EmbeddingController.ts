import { Controller, Get, HttpCode, Post, Body } from '@nestjs/common';
import { z } from 'zod';

import { ValidationPipe } from '../../common/pipes';

import { EmbeddingService } from './EmbeddingService';

const vectorInputSchema = z.object({
  input: z.string(),
});

@Controller('embeddings')
export class EmbeddingController {
  constructor(private readonly embeddingService: EmbeddingService) {}

  @Get()
  async getEmbeddings() {
    return this.embeddingService.findAll();
  }

  @Post('/search')
  @HttpCode(200)
  async searchEmbeddings(@Body(new ValidationPipe(vectorInputSchema)) input: { input: string }) {
    return this.embeddingService.findNearest(input.input);
  }

  @Post()
  @HttpCode(200)
  async calculateEmbedding(@Body(new ValidationPipe(vectorInputSchema)) input: { input: string }) {
    return this.embeddingService.calculateEmbedding(input.input);
  }
}
