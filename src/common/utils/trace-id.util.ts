import { randomUUID } from 'crypto';

export function generateTraceId(): string {
  return randomUUID();
}

export function normalizeTraceIdHeaderValue(
  value: string | string[] | undefined,
): string | null {
  if (Array.isArray(value)) {
    return value[0]?.trim() || null;
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim();
  }

  return null;
}
