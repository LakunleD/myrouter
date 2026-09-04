import { IsIn, IsString, MaxLength } from 'class-validator';

export class MessageDto {
  @IsIn(['system', 'user', 'assistant'])
  role!: 'system' | 'user' | 'assistant';

  @IsString()
  @MaxLength(1_000_000)
  content!: string;
}
