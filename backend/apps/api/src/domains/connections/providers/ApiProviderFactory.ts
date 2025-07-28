import { Injectable } from '@nestjs/common';
import { GoogleApiProvider } from './GoogleApiProvider';
import { MicrosoftApiProvider } from './MicrosoftApiProvider';
import type { ApiProvider } from './types';

@Injectable()
export class ApiProviderFactory {
  private readonly providers = new Map<string, ApiProvider>();

  constructor() {
    // Register providers by provider ID
    this.providers.set('018f8b9a-1234-7000-8000-000000000001', new GoogleApiProvider());
    this.providers.set('018f8b9a-1234-7000-8000-000000000006', new MicrosoftApiProvider());
  }

  getProvider(providerId: string): ApiProvider {
    const provider = this.providers.get(providerId);
    if (!provider) {
      throw new Error(`Unsupported provider ID: ${providerId}`);
    }
    return provider;
  }

  hasProvider(providerId: string): boolean {
    return this.providers.has(providerId);
  }
}
