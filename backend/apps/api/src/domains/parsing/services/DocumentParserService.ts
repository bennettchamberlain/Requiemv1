import { Injectable } from '@nestjs/common';

import { LoggerService } from '@ci/common/logging';
import config from '@ci/configuration';

import { type ParsedDocument } from '../types';

@Injectable()
export class DocumentParserService {
  constructor(private readonly logger: LoggerService) {
    this.logger.setContext(DocumentParserService.name);
  }

  async parse(fileBytes: Uint8Array, mimeType: string, filename: string): Promise<ParsedDocument> {
    const url = `${config.services.parser.host}/parse`;

    const form = new FormData();
    form.append('file', new Blob([fileBytes], { type: mimeType }), filename);
    form.append('mime_type', mimeType);

    const response = await fetch(url, {
      method: 'POST',
      body: form,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Parser service returned ${response.status}: ${body}`);
    }

    return response.json() as Promise<ParsedDocument>;
  }
}
