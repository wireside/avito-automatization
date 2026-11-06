import type { SignerEnrollment, SessionUser } from '@avito/domain';
import { PipelineError } from '@avito/domain';
import { signerApprovalMessage } from './signer-message.js';
import { Markup, Telegraf, type Context } from 'telegraf';

export function createTelegramBot(
  token: string,
  miniAppUrl: string,
  signer?: {
    enrollment: SignerEnrollment;
    findUser: (telegramId: string) => Promise<SessionUser | undefined>;
  },
) {
  const bot = new Telegraf(token, { handlerTimeout: 15_000 });

  const menuButton = {
    type: 'web_app' as const,
    text: 'Открыть',
    web_app: { url: miniAppUrl },
  };
  const signerUser = async (ctx: Context) =>
    ctx.from && signer ? signer.findUser(String(ctx.from.id)) : undefined;
  const setupSigner = async (ctx: Context, force = false) => {
    if (ctx.chat?.type !== 'private') return;
    const user = await signerUser(ctx);
    if (!user?.roles.includes('OWNER') || !signer) {
      await ctx.reply('Подключить УКЭП может только владелец ИП.');
      return;
    }
    try {
      const devices = await signer.enrollment.list(user),
        pending = devices.filter((d) => d.status === 'PENDING');
      if (!force && pending.length) {
        for (const d of pending) {
          const m = signerApprovalMessage(d);
          await ctx.reply(m.text, { reply_markup: m.reply_markup });
        }
        return;
      }
      if (!force && devices.some((d) => d.status === 'ACTIVE')) {
        await ctx.reply(
          'Подписант уже подключён. Для переноса на другой компьютер установите агент заново.',
          Markup.inlineKeyboard([
            Markup.button.callback('Установить на Windows', 'signer:setup'),
          ]),
        );
        return;
      }
      const link = await signer.enrollment.issue(user);
      await ctx.reply(
        'Откройте ссылку на Windows-компьютере владельца ИП. Распакуйте архив и запустите «Установить.cmd». Затем сравните код установщика с сообщением бота и подтвердите подключение. Ссылка действует 30 минут.',
        {
          ...Markup.inlineKeyboard([
            Markup.button.url('Скачать установщик Windows', link.url),
          ]),
          protect_content: true,
          link_preview_options: { is_disabled: true },
        },
      );
    } catch (e) {
      await ctx.reply(
        e instanceof PipelineError && e.code === 'INSTALL_LINK_RATE_LIMITED'
          ? 'Подождите 10 секунд и повторите /signer.'
          : 'Не удалось подготовить установку. Проверьте настройки сервера или повторите позже.',
      );
    }
  };
  bot.command('signer', (ctx) => setupSigner(ctx));
  bot.action('signer:setup', async (ctx) => {
    await ctx.answerCbQuery();
    await setupSigner(ctx, true);
  });
  bot.action(/^signer:(yes|no):([0-9a-f-]{36})$/, async (ctx) => {
    if (ctx.chat?.type !== 'private') return;
    const user = await signerUser(ctx);
    if (!user || !signer) {
      await ctx.answerCbQuery('Нет доступа');
      return;
    }
    try {
      const approve = ctx.match[1] === 'yes';
      await signer.enrollment.decide(user, ctx.match[2]!, approve);
      await ctx.answerCbQuery(
        approve ? 'Компьютер подключён' : 'Подключение отклонено',
      );
      await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
      await ctx.reply(
        approve
          ? 'Готово. Вернитесь к установщику на Windows — он завершит установку автоматически.'
          : 'Установка отклонена. При необходимости получите новую ссылку: /signer.',
      );
    } catch {
      await ctx.answerCbQuery(
        'Нет прав или срок подключения истёк. Используйте /signer.',
      );
    }
  });
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
    const user = await signerUser(context);
    if (
      user?.roles.includes('OWNER') &&
      signer &&
      !(await signer.enrollment.list(user)).some((d) => d.status === 'ACTIVE')
    )
      await context.reply(
        'Для автоматической работы с ЧЗ подключите подпись на компьютере владельца.',
        Markup.inlineKeyboard([
          Markup.button.callback(
            'Установить подписант на Windows',
            'signer:setup',
          ),
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
      '/app — открыть приложение\n/id — узнать свой Telegram ID\n/signer — подключить подпись на Windows\nДоступ в приложение предоставляет владелец.',
    );
  });
  bot.on('text', openApp);
  return bot;
}
