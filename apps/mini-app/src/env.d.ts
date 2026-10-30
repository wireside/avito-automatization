/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue';

  const component: DefineComponent<
    Record<string, never>,
    Record<string, never>,
    unknown
  >;
  export default component;
}

interface Window {
  Telegram?: {
    WebApp: {
      initData: string;
      ready(): void;
      expand(): void;
      isVersionAtLeast?(version: string): boolean;
      onEvent?(event: 'themeChanged' | 'activated', handler: () => void): void;
      setBottomBarColor?(color: string): void;
      setHeaderColor?(color: string): void;
      setBackgroundColor?(color: string): void;
    };
  };
}
