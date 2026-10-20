import { Markup, Telegraf, type Context } from 'telegraf';

export function createTelegramBot(token: string, miniAppUrl: string) {
  const bot = new Telegraf(token, { handlerTimeout: 15_000 });

  const menuButton = {
    type: 'web_app' as const,
    text: 'Открыть',
    web_app: { url: miniAppUrl },
  };
  const openApp = async (context: Context) => {
    if (context.chat?.type !== 'private') return;
    await context.telegram.setChatMenuButton({
      chatId: context.chat.id,
      menuButton,
    });
    await context.reply(
      'Авито Операции — рабочее место для заказов и склада. Нажмите кнопку, чтобы открыть приложение.',
      Markup.inlineKeyboard([
        Markup.button.webApp('Открыть приложение', miniAppUrl),
      ]),
    );
  };

  bot.start(openApp);
  bot.command('app', openApp);
  bot.command('id', async (context) => {
    if (context.chat.type !== 'private') return;
    await context.reply(
      `Ваш Telegram ID: ${context.from.id}\nПередайте его владельцу для предоставления доступа.`,
    );
  });
  bot.help(async (context) => {
    if (context.chat.type !== 'private') return;
    await context.reply(
      '/app — открыть приложение\n/id — узнать свой Telegram ID\nДоступ в приложение предоставляет владелец.',
    );
  });
  bot.on('text', openApp);
  return bot;
}
