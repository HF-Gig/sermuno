export class CreateExportJobDto {
  /** json | csv | mbox | eml */
  format?: string;
  /** Resource types to export: threads, messages, contacts */
  resources?: string[];
  mailboxIds?: string[];
  from?: string;
  to?: string;
}

export class CreateImportJobDto {
  /** csv | mbox | eml */
  format?: string;
}
