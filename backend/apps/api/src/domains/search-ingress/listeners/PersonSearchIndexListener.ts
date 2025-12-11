import { Injectable } from '@nestjs/common';

import { EmbeddingGenerationService } from '@ci/common/embeddings';
import { LoggerService } from '@ci/common/logging';
import { SYSTEM_USER, type ServiceContext } from '@ci/common/types';
import { OnEvent } from '@ci/domains/events';
import { type Person, PersonService } from '@ci/domains/memory';
import { PersonCreatedEvent, type PersonCreatedPayload } from '@ci/domains/memory/events';

import { EmbeddingService } from '../services/EmbeddingService';
import { VectorService } from '../services/VectorService';

@Injectable()
export class PersonSearchIndexListener {
  constructor(
    private readonly personService: PersonService,
    private readonly embeddingGenerationService: EmbeddingGenerationService,
    private readonly embeddingService: EmbeddingService,
    private readonly vectorService: VectorService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(PersonSearchIndexListener.name);
  }

  @OnEvent(PersonCreatedEvent, { queue: 'search-index' })
  async handleFileUploaded(payload: PersonCreatedPayload) {
    this.logger.log('Generating vector embedding for new person', {
      personId: payload.personId,
    });

    const context = {
      userId: SYSTEM_USER,
    } satisfies ServiceContext;

    const person = await this.personService.findById(context, payload.personId);

    if (person == null) {
      this.logger.warn('Person not found, skipping indexing');

      return;
    }

    if (person.userId == null) {
      this.logger.warn('Person has no associated user, cannot index');

      return;
    }

    const searchDocument = this.getSearchDocument(person);

    if (searchDocument == null) {
      this.logger.log('Person has no search content, skipping indexing');

      return;
    }

    const embedding = await this.embeddingGenerationService.generateEmbedding(searchDocument);

    await this.embeddingService.upsert(
      {
        userId: person.userId,
      },
      {
        entityType: 'person',
        entityId: person.id,
        embedding,
      },
    );

    this.logger.log('Generated embedding for person');

    const searchContent = this.getSearchContent(person);

    await this.vectorService.upsert(
      {
        userId: person.userId,
      },
      {
        entityType: 'person',
        entityId: person.id,
        searchableText: searchContent,
      },
    );

    this.logger.log('Generated tsvector for person');
  }

  private getSearchContent(person: Person): string[] {
    const parts = [
      person.name,
      person.description,
      person.properties ? JSON.stringify(person.properties) : null,
    ];

    return parts.filter((part): part is string => typeof part === 'string' && part.length > 0);
  }

  private getSearchDocument(person: Person): string | null {
    const parts = new Set<string>();

    const push = (value: unknown) => {
      if (typeof value !== 'string') {
        return;
      }

      const normalized = value.trim();

      if (normalized.length === 0) {
        return;
      }

      parts.add(normalized);
    };

    push(person.name ?? null);
    push(person.description ?? null);

    const properties = (person.properties ?? {}) as Record<string, unknown>;
    const candidateKeys = ['first_name', 'last_name', 'email', 'occupation', 'bio'];

    for (const key of candidateKeys) {
      push(properties[key]);
    }

    const aliases = properties['aliases'];

    if (Array.isArray(aliases)) {
      for (const alias of aliases) {
        push(alias);
      }
    }

    const result = Array.from(parts).join(' ');

    return result.length > 0 ? result : null;
  }
}
