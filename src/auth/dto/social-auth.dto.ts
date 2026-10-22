import { IsNotEmpty, IsString } from 'class-validator';

export class SocialAuthDto {
  @IsString()
  @IsNotEmpty()
  idToken: string;
}
