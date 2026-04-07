ALTER TABLE "export_jobs"
  ADD COLUMN "downloadCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "maxDownloads" INTEGER NOT NULL DEFAULT 5,
  ADD COLUMN "progressPercentage" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "checksum" TEXT;

UPDATE "export_jobs"
SET
  "downloadCount" = COALESCE("downloadCount", 0),
  "maxDownloads" = COALESCE("maxDownloads", 5),
  "progressPercentage" = COALESCE("progressPercentage", 0)
WHERE TRUE;
