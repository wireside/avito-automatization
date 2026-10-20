export function assertTelegramUserId(telegramId: string): void {
  if (
    !/^[1-9][0-9]{0,15}$/.test(telegramId) ||
    !Number.isSafeInteger(Number(telegramId))
  ) {
    throw new Error('A numeric Telegram user ID is required');
  }
}

export interface GrantOwnerAccessInput {
  telegramId: string;
  correlationId: string;
}

export function createGrantOwnerAccess(
  persist: (input: GrantOwnerAccessInput) => Promise<void>,
) {
  return async (input: GrantOwnerAccessInput): Promise<void> => {
    assertTelegramUserId(input.telegramId);
    await persist(input);
  };
}
