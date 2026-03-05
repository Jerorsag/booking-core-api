-- Migración FASE 2A: se agrega tipo OTP para login phone-first.
ALTER TYPE "OtpCodeType" ADD VALUE IF NOT EXISTS 'LOGIN_OTP';
