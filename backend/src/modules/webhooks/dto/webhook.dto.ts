export class CreateWebhookDto {
  url!: string;
  events!: string[];
  secret?: string;
  headers?: Record<string, string>;
  filterMailboxIds?: string[];
  filterTeamIds?: string[];
  filterTagIds?: string[];
}

export class UpdateWebhookDto {
  url?: string;
  events?: string[];
  secret?: string;
  isActive?: boolean;
  headers?: Record<string, string>;
  filterMailboxIds?: string[];
  filterTeamIds?: string[];
  filterTagIds?: string[];
}

export class DispatchWebhookDto {
  eventType!: string;
  payload!: Record<string, unknown>;
}
