/**
 * Persona × task intelligence — multi-prompt "how you'd do it" compose and About-you.
 *
 * Kept as its own Nest module so IntelligenceModule does not import AgentModule /
 * ScheduleModule (those barrels pull Intelligence via entity-resolution / ActionEntity
 * and create a circular init failure).
 *
 * @module PersonaModule
 */

import { Module } from '@nestjs/common';

import { LoggingModule } from '@ci/common/logging';
import { AgentModule } from '@ci/domains/agent';
import { IntelligenceModule } from '@ci/domains/intelligence';
import { LLMModule } from '@ci/domains/llm';
import { MemoryModule } from '@ci/domains/memory';
import { ScheduleModule } from '@ci/domains/schedule';
import { SummariesModule } from '@ci/domains/summaries';

import { PersonaIntelligenceController } from './controllers/PersonaIntelligenceController';
import { AboutYouService } from './services/AboutYouService';
import { PersonaComposeService } from './services/PersonaComposeService';
import { PersonaContextPackService } from './services/PersonaContextPackService';

@Module({
  imports: [
    LoggingModule,
    LLMModule,
    MemoryModule,
    SummariesModule,
    IntelligenceModule,
    AgentModule,
    ScheduleModule,
  ],
  providers: [PersonaContextPackService, PersonaComposeService, AboutYouService],
  controllers: [PersonaIntelligenceController],
  exports: [PersonaComposeService, AboutYouService, PersonaContextPackService],
})
export class PersonaModule {}

export { PersonaComposeService, PersonaContextPackService, AboutYouService };
export type { HowYoudDoItResult, HowYoudDoItStep } from './services/PersonaComposeService';
export type { AboutYouView } from './services/AboutYouService';
export type { PersonaContextPack, PersonaEvidence } from './services/PersonaContextPackService';
