import { describe, expect, it, vi } from 'vitest';
import { configureTelegramAppearance } from './telegram';

describe('Telegram native appearance', () => {
  it('reapplies supported dark colors on activation and theme changes', () => {
    const app = {
      initData: '',
      ready() {},
      expand() {},
      setHeaderColor: vi.fn(),
      setBackgroundColor: vi.fn(),
      setBottomBarColor: vi.fn(),
      onEvent:
        vi.fn<
          (event: 'themeChanged' | 'activated', handler: () => void) => void
        >(),
    };
    configureTelegramAppearance(app);
    expect(app.setHeaderColor).toHaveBeenCalledWith('#0A0A0B');
    expect(app.setBottomBarColor).toHaveBeenCalledWith('#141416');
    const apply = app.onEvent.mock.calls[0]![1];
    apply();
    expect(app.setHeaderColor).toHaveBeenCalledTimes(2);
    expect(app.onEvent.mock.calls.map(([event]) => event)).toEqual([
      'themeChanged',
      'activated',
    ]);
  });
  it('does not block app startup when an older native method throws', () => {
    const background = vi.fn();
    expect(() =>
      configureTelegramAppearance({
        initData: '',
        ready() {},
        expand() {},
        isVersionAtLeast: () => false,
        setHeaderColor: () => {
          throw Error('unsupported');
        },
        setBackgroundColor: background,
      }),
    ).not.toThrow();
    expect(background).toHaveBeenCalled();
    expect(() => configureTelegramAppearance(undefined)).not.toThrow();
  });
});
