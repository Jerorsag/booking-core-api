-- Migración FASE 1B: revocación por fecha.
-- AlterTable
ALTER TABLE "RefreshToken" DROP COLUMN "revoked",
ADD COLUMN     "revokedAt" TIMESTAMP(3);
