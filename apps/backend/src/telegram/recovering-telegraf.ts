import { Telegraf } from 'telegraf';

// Telegraf declares the older abort-controller shim; node-fetch accepts the
// native signal at runtime through the same aborted/addEventListener protocol.
type TelegramSignal = NonNullable<
  NonNullable<Parameters<Telegraf['telegram']['callApi']>[2]>['signal']
>;

export class RecoveringTelegraf extends Telegraf {
  private identityRequest:
    Promise<NonNullable<Telegraf['botInfo']>> | undefined;

  override async handleUpdate(
    ...args: Parameters<Telegraf['handleUpdate']>
  ): Promise<void> {
    // Telegraf caches a rejected getMe promise forever, before handlerTimeout
    // starts. Initialize botInfo ourselves so a failed lookup can be retried.
    if (!this.botInfo) {
      this.identityRequest ??= this.telegram
        .callApi(
          'getMe',
          {},
          {
            signal: AbortSignal.timeout(10_000) as unknown as TelegramSignal,
          },
        )
        .finally(() => {
          this.identityRequest = undefined;
        });
      this.botInfo = await this.identityRequest;
    }
    return super.handleUpdate(...args);
  }
}
