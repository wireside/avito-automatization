import { it, expect, vi, afterEach } from 'vitest';
import { Telegram } from 'telegraf';
import {
  createSignerEnrollment,
  type SignerEnrollmentStore,
} from '@avito/domain';
import { createTelegramBot } from './bot.js';
const owner = {
  id: '00000000-0000-4000-8000-000000000001',
  telegramId: '42',
  displayName: null,
  roles: ['OWNER'],
};
const id = '00000000-0000-4000-8000-000000000002';
afterEach(() => vi.restoreAllMocks());
it('issues a private installer for OWNER and processes the same approval callback emitted by the worker', async () => {
  const call = vi.spyOn(Telegram.prototype, 'callApi').mockResolvedValue(true);
  const store = {
    createTicket: vi.fn().mockResolvedValue({
      ticket: 'a'.repeat(43),
      expiresAt: '2027-01-01T00:00:00Z',
    }),
    validTicket: vi.fn(),
    register: vi.fn(),
    decide: vi.fn(),
    list: vi.fn().mockResolvedValue([]),
    binding: vi.fn(),
    status: vi.fn(),
    hasActive: vi.fn(),
    notification: vi.fn(),
    notified: vi.fn(),
  } satisfies SignerEnrollmentStore;
  const enrollment = createSignerEnrollment({
    store,
    publicUrl: 'https://api.example.com',
    inspectCertificate: vi.fn(),
  });
  const findUser = vi.fn().mockResolvedValue(owner);
  const bot = createTelegramBot('123:fake', 'https://app.example.com', {
    enrollment,
    findUser,
  });
  bot.botInfo = {
    id: 123,
    is_bot: true,
    first_name: 'Fixture',
    username: 'fixture_bot',
    can_join_groups: false,
    can_read_all_group_messages: false,
    supports_inline_queries: false,
  };
  const from = { id: 42, is_bot: false as const, first_name: 'Owner' },
    chat = { id: 42, type: 'private' as const, first_name: 'Owner' };
  await bot.handleUpdate({
    update_id: 1,
    message: {
      message_id: 1,
      date: 1,
      chat,
      from,
      text: '/signer',
      entities: [{ type: 'bot_command', offset: 0, length: 7 }],
    },
  });
  expect(store.createTicket).toHaveBeenCalledWith(owner.id);
  expect(call).toHaveBeenCalledWith(
    'sendMessage',
    expect.objectContaining({ chat_id: 42, protect_content: true }),
  );
  await bot.handleUpdate({
    update_id: 2,
    callback_query: {
      id: 'callback',
      from,
      chat_instance: 'fixture',
      data: 'signer:yes:' + id,
      message: { message_id: 2, date: 1, chat, from, text: 'Approval' },
    },
  });
  expect(store.decide).toHaveBeenCalledWith(owner.id, id, true);
  findUser.mockResolvedValue({ ...owner, roles: ['WAREHOUSE'] });
  await bot.handleUpdate({
    update_id: 3,
    message: {
      message_id: 3,
      date: 1,
      chat,
      from,
      text: '/signer',
      entities: [{ type: 'bot_command', offset: 0, length: 7 }],
    },
  });
  expect(store.createTicket).toHaveBeenCalledTimes(1);
});
