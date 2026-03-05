-- Migración FASE 1C: tipificación de OTP para seguridad por flujo.
-- CreateEnum
CREATE TYPE "OtpCodeType" AS ENUM ('PASSWORD_RESET');

-- AlterTable
ALTER TABLE "OtpCode" ADD COLUMN "type" "OtpCodeType" NOT NULL DEFAULT 'PASSWORD_RESET';

-- CreateIndex
CREATE INDEX "OtpCode_userId_type_expiresAt_idx" ON "OtpCode"("userId", "type", "expiresAt");
