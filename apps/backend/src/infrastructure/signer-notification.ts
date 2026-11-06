export function createSignerNotificationSender(
  token: string | undefined,
  fetcher: typeof fetch = fetch,
) {
  return async (
    chatId: string,
    message: { text: string; reply_markup: unknown },
  ) => {
    if (!token) throw new Error('SIGNER_TELEGRAM_NOT_CONFIGURED');
    let r: Response;
    try {
      r = await fetcher(
        'https://api.telegram.org/bot' + token + '/sendMessage',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            ...message,
            protect_content: true,
          }),
          signal: AbortSignal.timeout(10000),
        },
      );
    } catch {
      throw new Error('SIGNER_TELEGRAM_UNAVAILABLE');
    }
    const body: unknown = await r.json().catch(() => null);
    if (
      !r.ok ||
      !body ||
      typeof body !== 'object' ||
      !('ok' in body) ||
      body.ok !== true ||
      !('result' in body) ||
      !body.result ||
      typeof body.result !== 'object' ||
      !('message_id' in body.result) ||
      typeof body.result.message_id !== 'number'
    )
      throw new Error('SIGNER_TELEGRAM_FAILED');
    return body.result.message_id;
  };
}
