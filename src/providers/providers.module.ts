import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenAI } from '@google/genai';
import { Module } from '@nestjs/common';
import OpenAI from 'openai';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { AnthropicProvider } from './anthropic/anthropic.provider';
import { GoogleProvider } from './google/google.provider';
import type { LLMProvider } from './llm-provider.interface';
import { OpenAIProvider } from './openai/openai.provider';
import { ProviderRegistry } from './provider-registry';

@Module({
  providers: [
    {
      provide: ProviderRegistry,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => {
        const providers: LLMProvider[] = [];
        if (config.openaiApiKey) providers.push(new OpenAIProvider(new OpenAI({ apiKey: config.openaiApiKey, maxRetries: 0 })));
        if (config.anthropicApiKey) providers.push(new AnthropicProvider(new Anthropic({ apiKey: config.anthropicApiKey, maxRetries: 0 })));
        if (config.googleApiKey) providers.push(new GoogleProvider(new GoogleGenAI({ apiKey: config.googleApiKey })));
        return new ProviderRegistry(providers);
      },
    },
  ],
  exports: [ProviderRegistry],
})
export class ProvidersModule {}
