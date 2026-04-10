import type { LogLevel } from '@nestjs/common';

export type SupportedLogLevel = 'debug' | 'info' | 'warn' | 'error';
export type SupportedLogFormat = 'pretty' | 'json';

export interface ResolvedLoggingConfig {
  level: SupportedLogLevel;
  format: SupportedLogFormat;
  nestLogLevels: LogLevel[];
}

const SUPPORTED_LEVELS: SupportedLogLevel[] = [
  'debug',
  'info',
  'warn',
  'error',
];
const SUPPORTED_FORMATS: SupportedLogFormat[] = ['pretty', 'json'];

const NEST_LEVELS_BY_LEVEL: Record<SupportedLogLevel, LogLevel[]> = {
  debug: ['error', 'warn', 'log', 'debug'],
  info: ['error', 'warn', 'log'],
  warn: ['error', 'warn'],
  error: ['error'],
};

function asNormalizedString(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : undefined;
}

export function resolveLoggingConfig(
  env: NodeJS.ProcessEnv = process.env,
): ResolvedLoggingConfig {
  const rawLevel = asNormalizedString(env.LOG_LEVEL) ?? 'info';
  const rawFormat = asNormalizedString(env.LOG_FORMAT) ?? 'pretty';

  if (!SUPPORTED_LEVELS.includes(rawLevel as SupportedLogLevel)) {
    throw new Error(
      `Invalid LOG_LEVEL "${env.LOG_LEVEL ?? ''}". Expected one of: ${SUPPORTED_LEVELS.join(', ')}`,
    );
  }
  if (!SUPPORTED_FORMATS.includes(rawFormat as SupportedLogFormat)) {
    throw new Error(
      `Invalid LOG_FORMAT "${env.LOG_FORMAT ?? ''}". Expected one of: ${SUPPORTED_FORMATS.join(', ')}`,
    );
  }

  const level = rawLevel as SupportedLogLevel;
  const format = rawFormat as SupportedLogFormat;

  return {
    level,
    format,
    nestLogLevels: [...NEST_LEVELS_BY_LEVEL[level]],
  };
}
