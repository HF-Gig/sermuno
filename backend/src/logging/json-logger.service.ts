import type { LogLevel, LoggerService } from '@nestjs/common';

type JsonSeverity = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

interface JsonLogRecord {
  timestamp: string;
  level: JsonSeverity;
  context?: string;
  message: unknown;
  trace?: string;
}

function normalizeMessage(message: unknown): unknown {
  if (message instanceof Error) {
    return {
      name: message.name,
      message: message.message,
      stack: message.stack,
    };
  }
  if (Array.isArray(message)) {
    return message.map((entry) => normalizeMessage(entry));
  }
  return message;
}

export class JsonLoggerService implements LoggerService {
  private readonly enabledLevels = new Set<LogLevel>(['error', 'warn', 'log']);

  setLogLevels(levels: LogLevel[]): void {
    this.enabledLevels.clear();
    for (const level of levels) {
      this.enabledLevels.add(level);
    }
    if (this.enabledLevels.has('error')) {
      this.enabledLevels.add('fatal');
    }
  }

  log(message: unknown, context?: string): void {
    this.write('log', message, context);
  }

  error(message: unknown, trace?: string, context?: string): void {
    this.write('error', message, context, trace);
  }

  warn(message: unknown, context?: string): void {
    this.write('warn', message, context);
  }

  debug(message: unknown, context?: string): void {
    this.write('debug', message, context);
  }

  verbose(message: unknown, context?: string): void {
    this.write('verbose', message, context);
  }

  fatal(message: unknown, trace?: string, context?: string): void {
    this.write('fatal', message, context, trace);
  }

  private write(
    level: LogLevel,
    message: unknown,
    context?: string,
    trace?: string,
  ): void {
    if (!this.enabledLevels.has(level)) {
      return;
    }

    const record: JsonLogRecord = {
      timestamp: new Date().toISOString(),
      level: this.toJsonSeverity(level),
      message: normalizeMessage(message),
      ...(context ? { context } : {}),
      ...(trace ? { trace } : {}),
    };

    const line = `${JSON.stringify(record)}\n`;
    if (level === 'error' || level === 'fatal') {
      process.stderr.write(line);
      return;
    }
    process.stdout.write(line);
  }

  private toJsonSeverity(level: LogLevel): JsonSeverity {
    if (level === 'log' || level === 'verbose') {
      return 'info';
    }
    return level as JsonSeverity;
  }
}
