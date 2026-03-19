import {
  IsString,
  IsEnum,
  IsOptional,
  IsEmail,
  IsArray,
} from 'class-validator';

export class RsvpDto {
  @IsEnum(['accepted', 'declined', 'tentative'])
  status: 'accepted' | 'declined' | 'tentative';
}

export class IngestRsvpDto {
  @IsString()
  rawIcal: string;
}

export class SendInviteDto {
  @IsOptional()
  @IsArray()
  @IsEmail({}, { each: true })
  additionalEmails?: string[];
}
