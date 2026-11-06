import type { SignerCandidate } from '@avito/domain';
export function signerApprovalMessage(d: SignerCandidate) {
  return {
    text: `Подключение подписи\nКомпьютер: ${d.signerId}\nИНН ИП: ${d.sellerInn}\nКод на экране Windows: ${d.pairingCode}\nСертификат: ${d.certificateThumbprint}\nДействует до: ${d.certificateExpiresAt.slice(0, 10)}\n\nСравните код с окном установщика и подтвердите только свой компьютер. Подключение заменит прежний подписант. Ключ и PIN остаются на Windows.`,
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: 'Подключить этот компьютер',
            callback_data: 'signer:yes:' + d.id,
          },
        ],
        [{ text: 'Отклонить', callback_data: 'signer:no:' + d.id }],
      ],
    },
  };
}
