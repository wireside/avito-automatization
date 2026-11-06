import pino, { type Logger, type LoggerOptions } from 'pino';

const redactPaths = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.body.initData',
  'req.body.raw',
  '*.raw',
  '*.payloadCiphertext',
  '*.MARKING_ENCRYPTION_KEY',
  '*.botToken',
  '*.cis',
  '*.cisRaw',
  '*.certificate',
  '*.clientSecret',
  '*.pin',
  '*.privateKey',
  '*.token',
  '*.ticket',
  '*.deviceTokenHash',
  '*.certificateBase64',
  'req.body.ticket',
  'req.body.deviceTokenHash',
  'req.body.certificateBase64',
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
