-- Hotfix: phone-first onboarding requiere usuarios sin password inicial.
ALTER TABLE "User" ALTER COLUMN "passwordHash" DROP NOT NULL;
