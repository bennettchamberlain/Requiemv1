import { Body, Controller, Get, HttpCode, Patch, UseGuards } from '@nestjs/common';
import { z } from 'zod';

import { JwtOrApiKeyAuthGuard } from '@ci/common/guards';
import { ValidationPipe } from '@ci/common/pipes';

import { LlmEndpointService } from '../services/LlmEndpointService';

const updateSchema = z.object({
  backend: z.enum(['ollama', 'openai_compatible']),
  port: z.coerce.number().int().min(1).max(65535),
  apiKey: z.string().trim().optional(),
});

@Controller('llm')
export class LlmEndpointController {
  constructor(private readonly llmEndpointService: LlmEndpointService) {}

  @UseGuards(JwtOrApiKeyAuthGuard)
  @Get('endpoint')
  @HttpCode(200)
  getEndpoint() {
    return this.llmEndpointService.getView();
  }

  @UseGuards(JwtOrApiKeyAuthGuard)
  @Patch('endpoint')
  @HttpCode(200)
  updateEndpoint(@Body(new ValidationPipe(updateSchema)) body: z.infer<typeof updateSchema>) {
    return this.llmEndpointService.update(body);
  }
}
