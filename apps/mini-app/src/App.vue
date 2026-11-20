<script setup lang="ts">
import { computed, ref, defineAsyncComponent } from 'vue';
import { useDisplay } from 'vuetify';
import OrdersView from './components/OrdersView.vue';
import WarehouseView from './components/WarehouseView.vue';
import {
  mdiAlertCircleOutline,
  mdiArrowLeft,
  mdiArchiveOutline,
  mdiBarcodeScan,
  mdiChevronRight,
  mdiClipboardListOutline,
  mdiCogOutline,
  mdiHistory,
  mdiPackageVariantClosed,
  mdiTuneVariant,
  mdiUndoVariant,
  mdiWarehouse,
} from '@mdi/js';
import { useMobileInput } from './composables/useMobileInput';
import { useTelegramSession } from './composables/useTelegramSession';
import { layout } from './design/tokens';
const MarkingPipelineView = defineAsyncComponent(
  () => import('./components/marking/MarkingPipelineView.vue'),
);
const ReturnsView = defineAsyncComponent(
  () => import('./components/marking/ReturnsView.vue'),
);
const { mdAndUp } = useDisplay();
const mobileInputActive = useMobileInput(mdAndUp);
type WarehouseSection = 'intake' | 'stock' | 'session';
type Page =
  | 'sales'
  | 'orders'
  | 'packing'
  | 'warehouse'
  | WarehouseSection
  | 'returns'
  | 'management'
  | 'issues'
  | 'settings';
type Hub = 'sales' | 'warehouse' | 'management';

const activePage = ref<Page>('warehouse');
const warehouseSection = ref<WarehouseSection>('intake');
const warehouseActive = computed(
  () => activePage.value === warehouseSection.value,
);
const markingActive = computed(() =>
  ['packing', 'issues', 'settings'].includes(activePage.value),
);
const returnsOpened = ref(false);
const initialOrderId = ref<string | null>(null);
function navigate(page: Page) {
  initialOrderId.value = null;
  if (page === 'returns') returnsOpened.value = true;
  if (page === 'intake' || page === 'stock' || page === 'session')
    warehouseSection.value = page;
  activePage.value = page;
}
function openAvitoOrder(id: string) {
  navigate('orders');
  initialOrderId.value = id;
}
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
const owner = computed(() =>
  roles.value.some((r) => ['OWNER', 'ADMIN'].includes(r)),
);
const canReceive = computed(() =>
  roles.value.some((role) => ['OWNER', 'ADMIN', 'WAREHOUSE'].includes(role)),
);

const navigation = [
  { label: 'Продажи', icon: mdiClipboardListOutline, value: 'sales' },
  { label: 'Склад', icon: mdiWarehouse, value: 'warehouse' },
  { label: 'Возвраты', icon: mdiUndoVariant, value: 'returns' },
  { label: 'Управление', icon: mdiCogOutline, value: 'management' },
] as const;

const hubSections = {
  sales: [
    {
      label: 'Заказы',
      description: 'Заказы Авито и их статусы',
      icon: mdiClipboardListOutline,
      page: 'orders',
    },
    {
      label: 'Упаковка',
      description: 'Сборка и подготовка к отправке',
      icon: mdiPackageVariantClosed,
      page: 'packing',
    },
  ],
  warehouse: [
    {
      label: 'Приёмка',
      description: 'Добавление товаров по DataMatrix',
      icon: mdiBarcodeScan,
      page: 'intake',
    },
    {
      label: 'Остатки',
      description: 'Наличие и резервы',
      icon: mdiArchiveOutline,
      page: 'stock',
    },
    {
      label: 'Журнал приёмки',
      description: 'Результаты сканов за сессию',
      icon: mdiHistory,
      page: 'session',
    },
  ],
  management: [
    {
      label: 'Проблемы',
      description: 'Ошибки и незавершённые операции',
      icon: mdiAlertCircleOutline,
      page: 'issues',
    },
    {
      label: 'Настройки',
      description: 'Склады, Честный ЗНАК и подписант',
      icon: mdiTuneVariant,
      page: 'settings',
    },
  ],
} as const;
const hubForPage: Partial<Record<Page, Hub>> = {
  orders: 'sales',
  packing: 'sales',
  intake: 'warehouse',
  stock: 'warehouse',
  session: 'warehouse',
  issues: 'management',
  settings: 'management',
};
const parentHub = computed(() => hubForPage[activePage.value]);
const currentSection = computed(() =>
  navigation.find(
    ({ value }) => value === (parentHub.value ?? activePage.value),
  ),
);
const currentHub = computed(() => {
  const page = activePage.value;
  if (page === 'sales' || page === 'warehouse' || page === 'management')
    return {
      title: currentSection.value?.label,
      sections: hubSections[page].filter(
        ({ page }) =>
          (page !== 'settings' || owner.value) &&
          ((page !== 'intake' && page !== 'session') || canReceive.value),
      ),
    };
  return null;
});
const mobilePage = computed({
  get: () => currentSection.value?.value,
  set: (page: (typeof navigation)[number]['value'] | undefined) => {
    if (page) navigate(page);
  },
});
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
      >
        <v-list-item
          v-for="item in navigation"
          :key="item.value"
          :active="item.value === currentSection?.value"
          :aria-current="
            item.value === currentSection?.value ? 'page' : undefined
          "
          :title="item.label"
          :prepend-icon="item.icon"
          :color="
            item.value === currentSection?.value ? 'primary' : 'secondary'
          "
          class="mb-2 text-body-medium"
          :class="
            item.value === currentSection?.value
              ? 'bg-primary-soft text-primary'
              : 'text-secondary'
          "
          @click="navigate(item.value)"
        />
      </v-list>
      <template #append
        ><div class="pb-4">
          <v-sheet color="raised" rounded="md" class="pa-3 mb-5"
            ><p class="text-body-small d-flex align-center ga-2">
              <span class="status-dot bg-success" />Доступ подтверждён
            </p>
          </v-sheet>
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
        class="app-content"
        :class="
          activePage === 'orders'
            ? 'px-5 pt-5 px-md-8 pt-md-8'
            : 'px-6 pt-6 px-md-8 pt-md-8 px-lg-10 pt-lg-10'
        "
      >
        <v-btn
          v-if="authenticated && stockAllowed && parentHub"
          :prepend-icon="mdiArrowLeft"
          variant="text"
          color="primary"
          class="px-2 mb-4"
          @click="navigate(parentHub)"
          >К разделу «{{ currentSection?.label }}»</v-btn
        >
        <section
          v-if="authenticated && stockAllowed && currentHub"
          class="app-section-hub"
          aria-labelledby="app-section-title"
        >
          <h1 id="app-section-title" class="text-title-large mb-5 mb-md-6">
            {{ currentHub.title }}
          </h1>
          <div class="app-section-grid">
            <v-card
              v-for="item in currentHub.sections"
              :key="item.page"
              tag="button"
              type="button"
              border
              class="app-section-card pa-4 pa-md-5 text-left"
              :aria-label="item.label"
              @click="navigate(item.page)"
            >
              <span class="d-flex align-center justify-space-between ga-2 mb-4">
                <v-avatar
                  rounded="md"
                  color="primary-soft"
                  class="text-primary"
                >
                  <v-icon :icon="item.icon" size="22" />
                </v-avatar>
                <v-icon :icon="mdiChevronRight" color="secondary" size="18" />
              </span>
              <span class="d-block text-title-small text-md-title-medium">{{
                item.label
              }}</span>
              <span class="d-block text-body-small text-secondary mt-2">{{
                item.description
              }}</span>
            </v-card>
          </div>
        </section>
        <WarehouseView
          v-if="authenticated && stockAllowed"
          v-show="warehouseActive"
          :active="warehouseActive"
          :section="warehouseSection"
          @update:section="warehouseActive && navigate($event)"
          :init-data="initData"
          :roles="roles"
        />
        <OrdersView
          v-if="authenticated && stockAllowed && activePage === 'orders'"
          :roles="roles"
          :init-data="initData"
          :initial-order-id="initialOrderId"
          @work-started="navigate('packing')"
        />
        <ReturnsView
          v-if="
            authenticated &&
            stockAllowed &&
            (activePage === 'returns' || returnsOpened)
          "
          v-show="activePage === 'returns'"
          :active="activePage === 'returns'"
          :roles="roles"
          :init-data="initData"
          @open-order="openAvitoOrder"
        />
        <MarkingPipelineView
          v-if="authenticated && stockAllowed"
          v-show="markingActive"
          :init-data="initData"
          :roles="roles"
          :active="markingActive"
          :view="activePage"
          @navigate="navigate"
        />
        <v-sheet
          v-if="!authenticated || !stockAllowed"
          max-width="520"
          class="mx-auto mt-8 mt-md-16"
        >
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
      v-if="authenticated && stockAllowed && !mdAndUp && !mobileInputActive"
      v-model="mobilePage"
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
        :min-width="0"
        height="52"
        width="72"
        variant="text"
        color="secondary"
        rounded="md"
        class="px-1 my-3"
        :class="item.value === mobilePage ? 'bg-primary-soft' : ''"
        :aria-current="item.value === mobilePage ? 'page' : undefined"
        @click="navigate(item.value)"
      >
        <v-icon :icon="item.icon" size="20" />
        <span class="text-label-small mt-1">{{ item.label }}</span>
      </v-btn>
    </v-bottom-navigation>
  </v-app>
</template>

<style scoped>
.app-section-hub {
  max-width: 760px;
}
.app-section-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}
.app-section-card {
  min-height: 136px;
  display: flex;
  flex-direction: column;
  align-items: stretch;
}
@media (min-width: 960px) {
  .app-section-grid {
    gap: 16px;
  }
  .app-section-card {
    min-height: 148px;
  }
}
</style>
