<script setup lang="ts">
import { computed } from 'vue';
import { useDisplay } from 'vuetify';
import WarehouseView from './components/WarehouseView.vue';
import DesignIcon from './components/DesignIcon.vue';
import { useTelegramSession } from './composables/useTelegramSession';
import { layout } from './design/tokens';
const { mdAndUp } = useDisplay();
const initData = window.Telegram?.WebApp.initData ?? '';
const session = useTelegramSession(initData);
const authenticated = computed(() => session.isSuccess.value);
const roles = computed(() => session.data.value?.user.roles ?? []);
const stockAllowed = computed(() =>
  roles.value.some((role) =>
    ['OWNER', 'ADMIN', 'WAREHOUSE', 'ACCOUNTANT', 'VIEWER'].includes(role),
  ),
);
const displayName = computed(
  () => session.data.value?.user.displayName || 'Сотрудник',
);
const initials = computed(() =>
  displayName.value
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join(''),
);
const roleNames: Record<string, string> = {
  OWNER: 'Владелец',
  ADMIN: 'Администратор',
  WAREHOUSE: 'Склад',
  ACCOUNTANT: 'Бухгалтер',
  VIEWER: 'Просмотр',
};
const navigation = [
  { label: 'Главная', icon: 'home', value: 'home' },
  { label: 'Заказы', icon: 'orders', value: 'orders' },
  { label: 'Склад', icon: 'warehouse', value: 'warehouse' },
  { label: 'Финансы', icon: 'finance', value: 'finance' },
  { label: 'Команда', icon: 'team', value: 'team' },
] as const;
</script>
<template>
  <v-app>
    <a class="d-sr-only-focusable" href="#main-content"
      >Перейти к содержимому</a
    >
    <v-navigation-drawer
      v-if="authenticated && stockAllowed && mdAndUp"
      permanent
      :width="layout.drawerWidth"
      color="surface"
      border="0"
      class="pa-5"
    >
      <div class="mb-6">
        <p class="text-title-medium text-primary">SHTANISHKIN</p>
        <p class="text-body-small text-muted mt-1">Управление складом</p>
      </div>
      <v-divider class="mb-6" />
      <p class="text-label-small text-muted mb-4">РАБОЧЕЕ МЕСТО</p>
      <v-list
        nav
        class="pa-0"
        bg-color="transparent"
        role="navigation"
        aria-label="Основная навигация"
        ><v-list-item
          v-for="item in navigation"
          :key="item.value"
          :active="item.value === 'warehouse'"
          :disabled="item.value !== 'warehouse'"
          :aria-disabled="item.value !== 'warehouse'"
          :title="item.label"
          :subtitle="item.value !== 'warehouse' ? 'Скоро' : ''"
          :color="item.value === 'warehouse' ? 'primary' : 'secondary'"
          class="mb-2 text-body-medium"
          :class="
            item.value === 'warehouse'
              ? 'bg-primary-soft text-primary'
              : 'text-secondary'
          "
          ><template #prepend
            ><DesignIcon
              :name="item.icon"
              class="mr-3" /></template></v-list-item
      ></v-list>
      <template #append
        ><div class="pb-4">
          <v-sheet color="raised" rounded="md" class="pa-3 mb-5"
            ><p class="text-body-small d-flex align-center ga-2">
              <span class="status-dot bg-success" />Доступ подтверждён
            </p>
            <p class="text-label-small text-muted mt-1">
              Смены появятся позже
            </p></v-sheet
          >
          <div class="d-flex align-center ga-3">
            <v-avatar color="primary-soft" rounded="md" size="36"
              ><span class="text-body-small text-primary">{{
                initials
              }}</span></v-avatar
            >
            <div class="min-w-0">
              <p class="text-title-small text-truncate">{{ displayName }}</p>
              <p class="text-label-small text-muted">
                {{ roleNames[roles[0] ?? ''] ?? 'Сотрудник' }}
              </p>
            </div>
          </div>
        </div></template
      >
    </v-navigation-drawer>
    <v-main id="main-content">
      <v-container
        fluid
        class="app-content px-6 pt-6 px-md-8 pt-md-8 px-lg-10 pt-lg-10"
      >
        <WarehouseView
          v-if="authenticated && stockAllowed"
          :init-data="initData"
          :roles="roles"
        />
        <v-sheet v-else max-width="520" class="mx-auto mt-8 mt-md-16">
          <p class="text-title-medium text-primary mb-6">SHTANISHKIN</p>
          <v-card border class="pa-6" aria-live="polite">
            <template v-if="!initData"
              ><h1 class="text-title-large mb-4">
                Откройте приложение из Telegram
              </h1>
              <p class="text-body-medium text-secondary">
                В боте нажмите «Открыть приложение» или отправьте /app.
              </p></template
            >
            <template v-else-if="session.isPending.value"
              ><v-progress-circular
                indeterminate
                color="primary"
                size="24"
                class="mb-4"
              />
              <h1 class="text-title-medium">Проверяем доступ…</h1></template
            >
            <template v-else-if="session.isError.value"
              ><h1 class="text-title-large mb-4">Не удалось войти</h1>
              <p class="text-body-medium text-secondary" role="alert">
                {{ session.error.value?.message }}
              </p>
              <v-btn
                color="primary-strong"
                class="mt-5"
                @click="session.refetch()"
                >Повторить</v-btn
              ></template
            >
            <template v-else
              ><h1 class="text-title-medium mb-4">Нет доступа к складу</h1>
              <p class="text-body-medium text-secondary">
                Обратитесь к владельцу, чтобы получить права на просмотр
                остатков.
              </p></template
            >
          </v-card>
        </v-sheet>
      </v-container>
    </v-main>
    <v-bottom-navigation
      v-if="authenticated && stockAllowed && !mdAndUp"
      model-value="warehouse"
      :height="layout.bottomNavigationHeight"
      grow
      color="primary"
      bg-color="surface"
      elevation="0"
      rounded="nav"
      class="mobile-navigation border"
    >
      <v-btn
        v-for="item in navigation"
        :key="item.value"
        :value="item.value"
        :disabled="item.value !== 'warehouse'"
        :aria-disabled="item.value !== 'warehouse'"
        :min-width="0"
        height="52"
        rounded="md"
        class="px-1 my-3"
        :class="
          item.value === 'warehouse'
            ? 'bg-primary-soft text-primary'
            : 'text-muted'
        "
        :title="item.value === 'warehouse' ? 'Склад' : `${item.label} — скоро`"
        ><DesignIcon :name="item.icon" /><span class="text-label-small mt-1">{{
          item.label
        }}</span></v-btn
      >
    </v-bottom-navigation>
  </v-app>
</template>
