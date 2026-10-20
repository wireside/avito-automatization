import { useQuery } from '@tanstack/vue-query';
import type { TelegramAuthResponse } from '@avito/contracts';

export function useTelegramSession(initData: string) {
  return useQuery({
    queryKey: ['telegram-session'],
    enabled: initData.length > 0,
    retry: false,
    queryFn: async (): Promise<TelegramAuthResponse> => {
      let response: Response;
      try {
        response = await fetch(
          `${import.meta.env.VITE_API_BASE_URL ?? ''}/api/v1/auth/telegram/verify`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ initData }),
            signal: AbortSignal.timeout(20_000),
          },
        );
      } catch {
        throw new Error(
          'Не удалось подключиться к серверу. Попробуйте ещё раз.',
        );
      }
      if (response.status === 403)
        throw new Error(
          'Доступ пока не выдан. Отправьте /id боту и передайте ID владельцу.',
        );
      if (response.status === 401)
        throw new Error(
          'Сессия истекла. Закройте приложение и откройте его снова из бота.',
        );
      if (!response.ok)
        throw new Error(
          'Не удалось подключиться к серверу. Попробуйте ещё раз.',
        );
      return response.json() as Promise<TelegramAuthResponse>;
    },
  });
}
