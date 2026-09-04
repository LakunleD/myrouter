import { Module } from '@nestjs/common';
import { ModelRegistryService } from './model-registry.service';

@Module({
  providers: [ModelRegistryService],
  exports: [ModelRegistryService],
})
export class ModelsModule {}
