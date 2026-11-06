import { ref, shallowRef } from 'vue';
import { useQueryClient } from '@tanstack/vue-query';
import type { MarkingAction } from '@avito/contracts';
import { createMarkingApi, MarkingApiError } from '../marking-api';
/** A lost response keeps exactly the same immutable body, including original scan and UUID. */
export function useMarkingCommand(initData: string) {
  const api = createMarkingApi(initData);
  const client = useQueryClient();
  const busy = ref(false);
  const error = shallowRef<MarkingApiError>();
  const message = ref('');
  const pending = shallowRef<{
    action: MarkingAction;
    input: Record<string, unknown>;
  } | null>(null);
  async function run() {
    if (!pending.value || busy.value) return false;
    busy.value = true;
    error.value = undefined;
    message.value = '';
    try {
      const result = await api.command(
        pending.value.action,
        pending.value.input,
      );
      pending.value = null;
      message.value = result.replayed
        ? 'Результат исходного запроса восстановлен.'
        : 'Сохранено. Обработка продолжается в фоне.';
      await Promise.all([
        client.invalidateQueries({ queryKey: ['marking'] }),
        client.invalidateQueries({ queryKey: ['inventory'] }),
        client.invalidateQueries({ queryKey: ['inventory-units'] }),
      ]);
      return true;
    } catch (e) {
      error.value =
        e instanceof MarkingApiError
          ? e
          : new MarkingApiError('Не удалось подтвердить результат.', true);
      if (!error.value.uncertain) pending.value = null;
      return false;
    } finally {
      busy.value = false;
    }
  }
  return {
    busy,
    error,
    message,
    pending,
    retry: run,
    async send(action: MarkingAction, input: Record<string, unknown>) {
      if (pending.value || busy.value) return false;
      pending.value = {
        action,
        input: { ...input, requestId: crypto.randomUUID() },
      };
      return run();
    },
  };
}
