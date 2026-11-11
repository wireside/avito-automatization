import { afterEach, describe, expect, it, vi } from 'vitest';
import { RecoveringTelegraf } from './recovering-telegraf.js';

const identity = {
  id: 123,
  is_bot: true as const,
  first_name: 'Fixture',
  username: 'fixture_bot',
  can_join_groups: false,
  can_read_all_group_messages: false,
  supports_inline_queries: false,
};
const update = (id: number) => ({
  update_id: id,
  message: {
    message_id: id,
    date: 1,
    chat: { id: 42, type: 'private' as const, first_name: 'Fixture' },
    from: { id: 42, is_bot: false, first_name: 'Fixture' },
    text: '/signer',
  },
});
afterEach(() => vi.restoreAllMocks());

describe('Telegram identity initialization', () => {
  it('retries after an initial network failure and then processes new updates', async () => {
    const bot = new RecoveringTelegraf('123:fixture');
    const getMe = vi
      .spyOn(bot.telegram, 'callApi')
      .mockRejectedValueOnce(new Error('temporary network failure'))
      .mockResolvedValue(identity);
    const handle = vi.fn();
    bot.use(handle);
    await expect(bot.handleUpdate(update(1))).rejects.toThrow(
      'temporary network failure',
    );
    expect(handle).not.toHaveBeenCalled();
    await bot.handleUpdate(update(2));
    await bot.handleUpdate(update(3));
    expect(getMe).toHaveBeenCalledTimes(2);
    expect(handle).toHaveBeenCalledTimes(2);
    expect(bot.botInfo).toEqual(identity);
  });

  it('shares an in-flight lookup across concurrent webhook deliveries', async () => {
    const bot = new RecoveringTelegraf('123:fixture');
    const lookup = Promise.withResolvers<typeof identity>();
    const getMe = vi
      .spyOn(bot.telegram, 'callApi')
      .mockReturnValue(lookup.promise);
    const handle = vi.fn();
    bot.use(handle);
    const first = bot.handleUpdate(update(1));
    const second = bot.handleUpdate(update(2));
    expect(getMe).toHaveBeenCalledTimes(1);
    expect(handle).not.toHaveBeenCalled();
    lookup.resolve(identity);
    await Promise.all([first, second]);
    expect(handle).toHaveBeenCalledTimes(2);
  });

  it('aborts a stalled lookup and permits the next update to initialize again', async () => {
    const bot = new RecoveringTelegraf('123:fixture');
    const timeout = new AbortController();
    const timeoutCall = vi
      .spyOn(AbortSignal, 'timeout')
      .mockReturnValue(timeout.signal);
    const getMe = vi.spyOn(bot.telegram, 'callApi').mockImplementationOnce(
      (_method, _payload, options) =>
        new Promise((_resolve, reject) => {
          options?.signal?.addEventListener('abort', () =>
            reject(new Error('lookup timed out')),
          );
        }),
    );
    const attempt = expect(bot.handleUpdate(update(1))).rejects.toThrow(
      'lookup timed out',
    );
    expect(timeoutCall).toHaveBeenCalledWith(10_000);
    timeout.abort();
    await attempt;
    getMe.mockResolvedValue(identity);
    await bot.handleUpdate(update(2));
    expect(getMe).toHaveBeenCalledTimes(2);
  });
});
