CREATE TYPE "AttachmentScanStatus" AS ENUM (
  'UNSCANNED',
  'PENDING',
  'CLEAN',
  'INFECTED',
  'FAILED'
);

ALTER TABLE "attachments"
ADD COLUMN "scanStatus" "AttachmentScanStatus" NOT NULL DEFAULT 'UNSCANNED',
ADD COLUMN "scannerName" TEXT,
ADD COLUMN "scannerVersion" TEXT,
ADD COLUMN "scannedAt" TIMESTAMP(3),
ADD COLUMN "scanFailureReason" TEXT,
ADD COLUMN "malwareSignature" TEXT,
ADD COLUMN "quarantinedAt" TIMESTAMP(3);
