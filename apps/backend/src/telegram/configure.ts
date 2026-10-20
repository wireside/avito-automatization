import type { Telegraf } from 'telegraf';

export async function configureTelegramBot(
  bot: Telegraf,
  miniAppUrl: string,
  chatId?: number,
) {
  await bot.telegram.setMyCommands([
    { command: 'start', description: 'Начать работу' },
    { command: 'app', description: 'Открыть приложение' },
    { command: 'id', description: 'Мой Telegram ID' },
    { command: 'help', description: 'Помощь' },
  ]);
  await bot.telegram.setChatMenuButton({
    menuButton: {
      type: 'web_app',
      text: 'Открыть',
      web_app: { url: miniAppUrl },
    },
  });
  if (chatId !== undefined) {
    await bot.telegram.setChatMenuButton({
      chatId,
      menuButton: {
        type: 'web_app',
        text: 'Открыть',
        web_app: { url: miniAppUrl },
      },
    });
  }
  const scope = chatId === undefined ? {} : { chatId };
  let actual = await bot.telegram.getChatMenuButton(scope);
  for (
    let attempt = 0;
    attempt < 15 &&
    (actual.type !== 'web_app' ||
      new URL(actual.web_app.url).href !== new URL(miniAppUrl).href);
    attempt++
  ) {
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    actual = await bot.telegram.getChatMenuButton(scope);
  }
  if (
    actual.type !== 'web_app' ||
    new URL(actual.web_app.url).href !== new URL(miniAppUrl).href
  ) {
    throw new Error('Telegram menu verification failed');
  }
}
