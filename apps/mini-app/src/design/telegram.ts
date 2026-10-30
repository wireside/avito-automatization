import { colors } from './tokens';

type TelegramApp = NonNullable<Window['Telegram']>['WebApp'];
/** Native iOS controls remain owned by Telegram; only supported colors are set. */
export function configureTelegramAppearance(app: TelegramApp | undefined) {
  if (!app) return;
  const apply = () => {
    const changes = [
      () =>
        app.setHeaderColor?.(
          app.isVersionAtLeast?.('6.9') === false
            ? 'bg_color'
            : colors.background,
        ),
      () => app.setBackgroundColor?.(colors.background),
      () => app.setBottomBarColor?.(colors.surface),
    ];
    for (const change of changes) {
      try {
        change();
      } catch {
        /* Older clients may expose unsupported SDK methods. */
      }
    }
  };
  apply();
  app.onEvent?.('themeChanged', apply);
  app.onEvent?.('activated', apply);
}
