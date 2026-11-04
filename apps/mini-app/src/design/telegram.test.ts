import { describe, expect, it, vi } from 'vitest';
import { configureTelegramAppearance } from './telegram';
import { colors } from './tokens';

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
    const expectColorsApplied = (calls: number) => {
      expect(app.setHeaderColor).toHaveBeenCalledTimes(calls);
      expect(app.setHeaderColor).toHaveBeenLastCalledWith(colors.background);
      expect(app.setBackgroundColor).toHaveBeenCalledTimes(calls);
      expect(app.setBackgroundColor).toHaveBeenLastCalledWith(
        colors.background,
      );
      expect(app.setBottomBarColor).toHaveBeenCalledTimes(calls);
      expect(app.setBottomBarColor).toHaveBeenLastCalledWith(colors.surface);
    };
    expectColorsApplied(1);
    for (const [index, [, apply]] of app.onEvent.mock.calls.entries()) {
      apply();
      expectColorsApplied(index + 2);
    }
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
