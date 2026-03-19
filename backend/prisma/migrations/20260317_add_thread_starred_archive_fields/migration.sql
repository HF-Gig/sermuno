-- AlterEnum
ALTER TYPE "ThreadStatus" ADD VALUE 'ARCHIVED';

-- AlterTable
ALTER TABLE "scheduled_messages" ALTER COLUMN "cancelledAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "threads" ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "starred" BOOLEAN NOT NULL DEFAULT false;

