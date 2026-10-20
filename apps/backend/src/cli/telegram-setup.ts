import { TelegramError } from 'telegraf';
import { readConfig } from '../config/index.js';
import { configureTelegramBot, createTelegramBot } from '../telegram/index.js';

let stage = 'configuration';
try {
  const config = readConfig();
  if (
    config.TELEGRAM_MODE === 'disabled' ||
    !config.TELEGRAM_BOT_TOKEN ||
    !config.MINI_APP_URL
  ) {
    throw new Error(
      'Set TELEGRAM_MODE, TELEGRAM_BOT_TOKEN and MINI_APP_URL in .env',
    );
  }
  const bot = createTelegramBot(config.TELEGRAM_BOT_TOKEN, config.MINI_APP_URL);
  stage = 'getMe';
  const identity = await bot.telegram.getMe();
  stage = 'webhook';
  if (config.TELEGRAM_MODE === 'webhook') {
    const publicUrl = new URL(process.env.TELEGRAM_WEBHOOK_URL ?? '');
    if (
      publicUrl.protocol !== 'https:' ||
      publicUrl.pathname !== '/webhooks/telegram'
    ) {
      throw new Error(
        'TELEGRAM_WEBHOOK_URL must be https://your-domain/webhooks/telegram',
      );
    }
    await bot.telegram.setWebhook(publicUrl.href, {
      secret_token: config.TELEGRAM_WEBHOOK_SECRET!,
      allowed_updates: ['message'],
    });
    const actual = await bot.telegram.getWebhookInfo();
    if (actual.url !== publicUrl.href)
      throw new Error('Webhook verification failed');
  } else {
    await bot.telegram.deleteWebhook({ drop_pending_updates: false });
    if ((await bot.telegram.getWebhookInfo()).url)
      throw new Error('Webhook was not removed');
  }
  stage = 'commands/menu';
  await configureTelegramBot(
    bot,
    config.MINI_APP_URL,
    config.TELEGRAM_SETUP_CHAT_ID,
  );
  console.log(
    `Bot configured: https://t.me/${identity.username} (${config.TELEGRAM_MODE})`,
  );
} catch (error) {
  // Provider errors may contain request URLs with the bot token.
  console.error({
    stage,
    code:
      error instanceof TelegramError ? error.code : 'LOCAL_OR_NETWORK_ERROR',
  });
  console.error(
    'Telegram setup failed. Check .env, HTTPS URLs, token and network. No secrets logged.',
  );
  process.exitCode = 1;
}
