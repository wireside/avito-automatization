import { config } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const envPath = process.env.DOTENV_CONFIG_PATH
  ? path.resolve(process.env.DOTENV_CONFIG_PATH)
  : fileURLToPath(new URL('../../../../.env', import.meta.url));

config({ path: envPath, quiet: true });

import { z } from 'zod';

const optionalSecret = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.string().min(1).optional(),
);

const configSchema = z.object({
  PUBLIC_API_URL: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z
      .url()
      .refine((v) => {
        const u = new URL(v);
        return (
          u.protocol === 'https:' &&
          !u.username &&
          !u.password &&
          !u.search &&
          !u.hash &&
          u.pathname === '/'
        );
      }, 'Expected public HTTPS API origin')
      .transform((v) => new URL(v).origin)
      .optional(),
  ),
  SIGNER_TELEGRAM_ENROLLMENT_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  CHZ_PROXY_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  CHZ_PROXY_URL: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z
      .url()
      .refine((v) => {
        const u = new URL(v);
        return (
          ['http:', 'https:'].includes(u.protocol) &&
          !u.username &&
          !u.password &&
          !u.search &&
          !u.hash &&
          u.pathname === '/'
        );
      }, 'Expected HTTP(S) proxy origin without credentials')
      .optional(),
  ),
  CHZ_SUBMISSION_MODE: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.enum(['AVITO_OFD', 'CHZ_MANUAL', 'DIRECT_TRUE_API']).optional(),
  ),
  CHZ_DOCUMENT_SUBMISSION_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  AVITO_WRITES_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  LOCAL_SIGNER_CERTIFICATE_THUMBPRINT: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z
      .string()
      .regex(/^[0-9A-Fa-f]{40}$/)
      .optional(),
  ),
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3_000),
  LOG_LEVEL: z.string().default('info'),
  DATABASE_URL: z.url(),
  REDIS_URL: z.url(),
  MINI_APP_ORIGIN: z.url().default('http://localhost:5173'),
  MINI_APP_URL: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z
      .url()
      .refine(
        (value) => new URL(value).protocol === 'https:',
        'Mini App requires HTTPS',
      )
      .optional(),
  ),
  TELEGRAM_MODE: z.enum(['disabled', 'polling', 'webhook']).default('disabled'),
  TELEGRAM_SETUP_CHAT_ID: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
  ),
  MARKING_ENCRYPTION_KEY: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z
      .string()
      .regex(/^[A-Za-z0-9+/]{43}=$/)
      .refine(
        (value) => Buffer.from(value, 'base64').toString('base64') === value,
        'Expected canonical base64 key',
      )
      .optional(),
  ),
  MARKING_ENCRYPTION_KEY_ID: z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,64}$/)
    .default('local-v1'),
  LOCAL_SIGNER_TOKEN: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.string().min(32).max(512).optional(),
  ),
  AVITO_API_CLIENT_ID: optionalSecret,
  AVITO_API_CLIENT_SECRET: optionalSecret,
  TELEGRAM_BOT_TOKEN: optionalSecret,
  CHZ_NATIONAL_CATALOG_API_KEY: optionalSecret,
  CHZ_NATIONAL_CATALOG_ENVIRONMENT: z
    .enum(['production', 'sandbox'])
    .default('production'),
  CHZ_NATIONAL_CATALOG_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(500)
    .max(10000)
    .default(5000),
  TELEGRAM_WEBHOOK_SECRET: optionalSecret,
  TELEGRAM_INIT_DATA_MAX_AGE_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(3_600),
});

export type AppConfig = z.infer<typeof configSchema>;

export function readConfig(
  environment: NodeJS.ProcessEnv = process.env,
): AppConfig {
  const parsed = configSchema.parse(environment);
  if (parsed.CHZ_PROXY_ENABLED && !parsed.CHZ_PROXY_URL)
    throw new Error('CHZ_PROXY_ENABLED requires CHZ_PROXY_URL');

  if (
    parsed.CHZ_DOCUMENT_SUBMISSION_ENABLED &&
    (parsed.CHZ_SUBMISSION_MODE !== 'DIRECT_TRUE_API' ||
      (!(
        parsed.LOCAL_SIGNER_TOKEN && parsed.LOCAL_SIGNER_CERTIFICATE_THUMBPRINT
      ) &&
        !parsed.SIGNER_TELEGRAM_ENROLLMENT_ENABLED) ||
      !parsed.MARKING_ENCRYPTION_KEY)
  )
    throw new Error(
      'Direct CHZ sending requires DIRECT_TRUE_API, encryption and a pinned local signer',
    );
  if (
    parsed.SIGNER_TELEGRAM_ENROLLMENT_ENABLED &&
    (!parsed.PUBLIC_API_URL ||
      !parsed.TELEGRAM_BOT_TOKEN ||
      !parsed.MARKING_ENCRYPTION_KEY ||
      parsed.TELEGRAM_MODE === 'disabled')
  )
    throw new Error(
      'Telegram signer setup requires public HTTPS API, bot, encryption and enabled Telegram runtime',
    );
  if (
    parsed.TELEGRAM_MODE !== 'disabled' &&
    (!parsed.TELEGRAM_BOT_TOKEN || !parsed.MINI_APP_URL)
  ) {
    throw new Error(
      'Set TELEGRAM_BOT_TOKEN and HTTPS MINI_APP_URL to enable the bot',
    );
  }
  if (parsed.TELEGRAM_MODE === 'polling' && parsed.NODE_ENV === 'production') {
    throw new Error('Use TELEGRAM_MODE=webhook in production');
  }
  if (
    parsed.TELEGRAM_MODE === 'webhook' &&
    !/^[A-Za-z0-9_-]{1,256}$/.test(parsed.TELEGRAM_WEBHOOK_SECRET ?? '')
  ) {
    throw new Error('Set a valid TELEGRAM_WEBHOOK_SECRET for webhook mode');
  }
  return parsed;
}
