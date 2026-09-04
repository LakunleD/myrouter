import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEmpty,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { MessageDto } from './message.dto';

export class ChatCompletionRequestDto {
  /** Exactly one of `model` or `models` must be present; ChatService enforces that. */
  @IsOptional()
  @IsString()
  model?: string;

  /** Ordered fallback list. The two-attempt limit is enforced by routing with an explicit message. */
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  models?: string[];

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10_000)
  @ValidateNested({ each: true })
  @Type(() => MessageDto)
  messages!: MessageDto[];

  @IsOptional()
  @IsBoolean()
  stream = false;

  @IsOptional()
  @IsInt()
  @Min(1)
  max_tokens?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(2)
  temperature?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  top_p?: number;

  /** OpenAI accepts a single string or an array; normalise to an array before validation. */
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? [value] : value))
  @IsArray()
  @ArrayMaxSize(4)
  @IsString({ each: true })
  stop?: string[];

  @IsOptional()
  @IsIn([1])
  n?: number;

  @IsEmpty({ message: 'tools are not supported' })
  tools?: unknown;

  @IsEmpty({ message: 'functions are not supported' })
  functions?: unknown;

  @IsEmpty({ message: 'response_format is not supported' })
  response_format?: unknown;
}

/** Returns the ordered attempt list, or throws when the body has neither or both of `model` and `models`. */
export function modelsFrom(dto: ChatCompletionRequestDto): string[] | undefined {
  const hasModel = dto.model !== undefined;
  const hasModels = dto.models !== undefined;
  if (hasModel === hasModels) return undefined;
  return hasModels ? dto.models : [dto.model as string];
}
