import { IsString } from 'class-validator';

export class MergeCartDto {
  @IsString()
  sessionId!: string;
}
