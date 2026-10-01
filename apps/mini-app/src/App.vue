<script setup lang="ts">
import { useQuery } from '@tanstack/vue-query';

interface SessionResponse {
  user: {
    id: string;
    displayName: string | null;
    roles: string[];
  };
}

const telegramInitData = window.Telegram?.WebApp.initData ?? '';
const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000';

useQuery({
  queryKey: ['telegram-session', telegramInitData],
  enabled: telegramInitData.length > 0,
  retry: false,
  queryFn: async (): Promise<SessionResponse> => {
    const response = await fetch(`${apiBaseUrl}/api/v1/auth/telegram/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ initData: telegramInitData }),
    });
    if (!response.ok) throw new Error('Telegram session validation failed');
    return response.json() as Promise<SessionResponse>;
  },
});

const modules = [
  {
    title: 'Упаковка',
    note: 'Очередь заказов и сканирование',
    badge: '0 заданий',
  },
  {
    title: 'Склад',
    note: 'Остатки, приёмка и инвентаризация',
    badge: 'Готов',
  },
  {
    title: 'Возвраты',
    note: 'Приёмка, карантин и проверка',
    badge: '0 новых',
  },
  {
    title: 'Проблемы',
    note: 'Расхождения и ручное внимание',
    badge: 'Нет',
  },
] as const;
</script>

<template>
  <main class="app-shell">
    <header class="topbar">
      <div>
        <p class="eyebrow">Операционный центр</p>
        <h1>Добрый день</h1>
      </div>
      <span class="status-dot" aria-label="Система доступна" />
    </header>

    <section class="hero">
      <span class="hero-label">Текущая смена</span>
      <strong>Смена не начата</strong>
      <button type="button">Начать смену</button>
    </section>

    <section aria-labelledby="work-title">
      <div class="section-heading">
        <h2 id="work-title">Работа</h2>
        <span>Сегодня</span>
      </div>
      <div class="module-grid">
        <button
          v-for="module in modules"
          :key="module.title"
          class="module-card"
          type="button"
        >
          <span class="module-title">{{ module.title }}</span>
          <span class="module-note">{{ module.note }}</span>
          <span class="module-badge">{{ module.badge }}</span>
        </button>
      </div>
    </section>

    <footer>
      <span>Этап 1 · фундамент системы</span>
      <span>Финансы будут предварительными</span>
    </footer>
  </main>
</template>
