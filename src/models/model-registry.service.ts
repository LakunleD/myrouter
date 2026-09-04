import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { buildModelRegistry, ModelEntry, ModelRegistry } from './model-registry';

@Injectable()
export class ModelRegistryService {
  private readonly registry: ModelRegistry;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.registry = buildModelRegistry({
      openai: config.openaiModelId,
      anthropic: config.anthropicModelId,
      google: config.googleModelId,
    });
  }

  resolve(alias: string): ModelEntry | undefined {
    return this.registry[alias];
  }

  aliases(): string[] {
    return Object.keys(this.registry);
  }
}
