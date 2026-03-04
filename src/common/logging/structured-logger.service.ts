import { Injectable } from '@nestjs/common';

type LogLevel = 'info' | 'error' | 'warn';

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  event: string;
  [key: string]: unknown;
}

@Injectable()
export class StructuredLoggerService {
  info(event: string, payload: Record<string, unknown> = {}): void {
    this.write({
      timestamp: new Date().toISOString(),
      level: 'info',
      event,
      ...payload,
    });
  }

  warn(event: string, payload: Record<string, unknown> = {}): void {
    this.write({
      timestamp: new Date().toISOString(),
      level: 'warn',
      event,
      ...payload,
    });
  }

  error(event: string, payload: Record<string, unknown> = {}): void {
    this.write({
      timestamp: new Date().toISOString(),
      level: 'error',
      event,
      ...payload,
    });
  }

  private write(entry: LogEntry): void {
    process.stdout.write(`${JSON.stringify(entry)}\n`);
  }
}
