import pino, { type Logger, type LoggerOptions } from 'pino';

const redactPaths = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.body.initData',
  '*.botToken',
  '*.cis',
  '*.cisRaw',
  '*.certificate',
  '*.clientSecret',
  '*.pin',
  '*.privateKey',
  '*.token',
];

export function createLogger(
  level = 'info',
  options: LoggerOptions = {},
): Logger {
  return pino({
    level,
    redact: { paths: redactPaths, censor: '[REDACTED]' },
    ...options,
  });
}
