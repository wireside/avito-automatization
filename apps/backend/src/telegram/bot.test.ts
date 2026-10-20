import { Telegram } from 'telegraf';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { configureTelegramBot, createTelegramBot } from './index.js';

const identity = {
  id: 123,
  is_bot: true as const,
  first_name: 'Test',
  username: 'test_bot',
  can_join_groups: false,
  can_read_all_group_messages: false,
  supports_inline_queries: false,
};
afterEach(() => vi.restoreAllMocks());
describe('Telegram entry points', () => {
  it('updates and reads back the intended private chat menu', async () => {
    const bot = createTelegramBot('123:fake-token', 'https://app.example.com');
    vi.spyOn(bot.telegram, 'setMyCommands').mockResolvedValue(true);
    const setMenu = vi
      .spyOn(bot.telegram, 'setChatMenuButton')
      .mockResolvedValue(true);
    const getMenu = vi
      .spyOn(bot.telegram, 'getChatMenuButton')
      .mockResolvedValue({
        type: 'web_app',
        text: 'Открыть',
        web_app: { url: 'https://app.example.com/' },
      });
    await configureTelegramBot(bot, 'https://app.example.com', 42);
    expect(setMenu).toHaveBeenLastCalledWith({
      chatId: 42,
      menuButton: {
        type: 'web_app',
        text: 'Открыть',
        web_app: { url: 'https://app.example.com' },
      },
    });
    expect(getMenu).toHaveBeenCalledWith({ chatId: 42 });
  });

  it.each(['/start', '/app', 'Привет'])(
    'opens Mini App from %s in private chats',
    async (text) => {
      const call = vi
        .spyOn(Telegram.prototype, 'callApi')
        .mockResolvedValue(true);
      const bot = createTelegramBot(
        '123:fake-token',
        'https://app.example.com',
      );
      bot.botInfo = identity;
      await bot.handleUpdate({
        update_id: 1,
        message: {
          message_id: 1,
          date: 1,
          chat: { id: 42, type: 'private', first_name: 'Test' },
          from: { id: 42, is_bot: false, first_name: 'Test' },
          text,
          entities: text.startsWith('/')
            ? [{ type: 'bot_command', offset: 0, length: text.length }]
            : [],
        },
      });
      expect(call).toHaveBeenCalledWith(
        'sendMessage',
        expect.objectContaining({
          chat_id: 42,
          reply_markup: {
            inline_keyboard: [
              [
                {
                  hide: false,
                  text: 'Открыть приложение',
                  web_app: { url: 'https://app.example.com' },
                },
              ],
            ],
          },
        }),
      );
    },
  );
  it('does not send private Web App buttons to group chats', async () => {
    const call = vi
      .spyOn(Telegram.prototype, 'callApi')
      .mockResolvedValue(true);
    const bot = createTelegramBot('123:fake-token', 'https://app.example.com');
    bot.botInfo = identity;
    await bot.handleUpdate({
      update_id: 1,
      message: {
        message_id: 1,
        date: 1,
        chat: { id: -42, type: 'group', title: 'Test' },
        from: { id: 42, is_bot: false, first_name: 'Test' },
        text: '/start',
        entities: [{ type: 'bot_command', offset: 0, length: 6 }],
      },
    });
    expect(call).not.toHaveBeenCalled();
  });
});
