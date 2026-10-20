import { describe, expect, it, vi } from 'vitest';
import type { RedisConnection } from './redis.js';
import { createTelegramUpdateDelivery } from './telegram-updates.js';

function setup() {
  const redis = {
    set: vi.fn().mockResolvedValue('OK'),
    get: vi.fn().mockResolvedValue('done'),
    del: vi.fn().mockResolvedValue(1),
  };
  const handleUpdate = vi.fn().mockResolvedValue(undefined);
  const deliver = createTelegramUpdateDelivery({
    redis: redis as unknown as RedisConnection,
    botId: '123',
    handleUpdate,
  });
  return { redis, handleUpdate, deliver };
}
describe('Telegram transport deduplication', () => {
  it('acknowledges a completed duplicate without replaying the reply', async () => {
    const service = setup();
    service.redis.set.mockResolvedValue(null);
    expect(await service.deliver({ update_id: 7 })).toBe('duplicate');
    expect(service.handleUpdate).not.toHaveBeenCalled();
  });
  it('returns a retryable status while another delivery is in progress', async () => {
    const service = setup();
    service.redis.set.mockResolvedValue(null);
    service.redis.get.mockResolvedValue('processing');
    expect(await service.deliver({ update_id: 7 })).toBe('processing');
    expect(service.handleUpdate).not.toHaveBeenCalled();
  });
  it('releases the transport lock after a provider failure so delivery can retry', async () => {
    const service = setup();
    service.handleUpdate.mockRejectedValueOnce(new Error('provider failed'));
    expect(await service.deliver({ update_id: 7 })).toBe('failed');
    expect(service.redis.del).toHaveBeenCalledWith('telegram:123:update:7');
    expect(await service.deliver({ update_id: 7 })).toBe('delivered');
  });
});
