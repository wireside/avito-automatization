<script setup lang="ts">
import { computed } from 'vue';
import { useDisplay } from 'vuetify';
import { mdiRefresh } from '@mdi/js';
import { useOrders } from '../composables/useOrders';
import {
  orderStatuses,
  orderStatusLabel,
  OrdersApiError,
  type MarketplaceOrderDto,
} from '../orders-api';
import ProductThumbnail from './ProductThumbnail.vue';
const props = defineProps<{ initData: string }>();
const { mdAndUp } = useDisplay();
const { status, page, selectedId, search, orders, detail, visibleOrders } =
  useOrders(props.initData);
const current = computed(() => (selectedId.value ? detail : orders));
const order = computed(() => detail.data.value?.order);
const fetchedAt = computed(() =>
  selectedId.value
    ? detail.data.value?.fetchedAt
    : orders.data.value?.fetchedAt,
);
const errorId = computed(() =>
  current.value.error.value instanceof OrdersApiError
    ? current.value.error.value.requestId
    : undefined,
);
const amount = (minor: number | null) =>
  minor === null
    ? 'Не указана'
    : new Intl.NumberFormat('ru-RU', {
        style: 'currency',
        currency: 'RUB',
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
      }).format(minor / 100);
const date = (value: string | null | undefined) =>
  value && Number.isFinite(Date.parse(value))
    ? new Date(value).toLocaleString('ru-RU', {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      })
    : 'Не указан';
const orderNumber = (id: string) => `№${id}`;
const quantity = (o: MarketplaceOrderDto) =>
  o.items.reduce((sum, item) => sum + item.quantity, 0);
const deadline = (o: MarketplaceOrderDto) =>
  o.status === 'on_confirmation'
    ? o.schedules.confirmTill
    : o.status === 'ready_to_ship'
      ? o.schedules.shipTill
      : null;
const statusColor = (value: string) =>
  ['in_dispute', 'on_return'].includes(value)
    ? 'warning'
    : ['delivered', 'closed'].includes(value)
      ? 'success'
      : value === 'canceled'
        ? 'muted'
        : 'primary';
const actionNames: Record<string, string> = {
  confirm: 'Подтверждение заказа',
  setMarkings: 'Передача маркировки',
  perform: 'Подтверждение отправки',
  receive: 'Подтверждение получения',
  reject: 'Отмена',
  setTrackNumber: 'Передача трек-номера',
  fixTrackNumber: 'Исправление трек-номера',
  acceptReturnOrder: 'Подтверждение возврата',
  setCNCDetails: 'Подготовка самовывоза',
  getCourierDeliveryRange: 'Интервалы курьера',
  setCourierDeliveryRange: 'Выбор времени курьера',
};
</script>
<template>
  <section aria-labelledby="orders-title">
    <v-btn
      v-if="selectedId"
      variant="text"
      color="primary"
      class="px-0 mb-3"
      @click="selectedId = null"
      >← Заказы</v-btn
    >
    <div class="d-flex align-start ga-3 mb-4 mb-md-5">
      <div class="min-w-0 flex-grow-1">
        <h1 id="orders-title" class="text-title-large orders-wrap">
          {{ selectedId ? `Заказ ${orderNumber(selectedId)}` : 'Заказы' }}
        </h1>
        <p class="text-body-medium text-secondary mt-1">
          Авито ·
          {{
            current.isError.value
              ? 'не удалось обновить'
              : fetchedAt
                ? `обновлено ${date(fetchedAt)}`
                : 'загружаем данные'
          }}
        </p>
      </div>
      <v-btn
        :icon="mdiRefresh"
        size="36"
        variant="text"
        color="secondary"
        aria-label="Обновить заказы"
        :loading="current.isFetching.value"
        @click="current.refetch()"
      />
    </div>
    <v-alert
      v-if="current.isError.value"
      type="error"
      class="mb-5"
      role="alert"
    >
      {{ current.error.value?.message }}
      <p v-if="fetchedAt" class="mt-2">
        Ниже показаны данные предыдущего обновления.
      </p>
      <p v-if="errorId" class="text-body-small mt-2">
        Код обращения: {{ errorId }}
      </p>
      <v-btn class="mt-3" @click="current.refetch()">Повторить</v-btn>
    </v-alert>
    <v-progress-linear
      v-if="current.isPending.value && current.isFetching.value"
      indeterminate
      color="primary"
      aria-label="Загрузка заказов"
      class="mb-5"
    />
    <template v-if="!selectedId">
      <div class="d-flex flex-wrap align-center ga-2 mb-4">
        <v-btn
          v-for="tab in orderStatuses.filter((t) =>
            ['', 'in_transit'].includes(t.value),
          )"
          :key="tab.value"
          height="44"
          :min-width="0"
          class="px-3"
          :color="status === tab.value ? 'primary-soft' : 'transparent'"
          :class="status === tab.value ? 'text-primary' : 'text-secondary'"
          :aria-pressed="status === tab.value"
          @click="status = tab.value"
          >{{ tab.title }}</v-btn
        >
        <v-menu
          ><template #activator="{ props: menuProps }"
            ><v-btn
              v-bind="menuProps"
              height="44"
              :min-width="0"
              class="px-3"
              :class="status ? 'text-primary' : 'text-secondary'"
              :color="
                orderStatuses
                  .filter((t) => !['', 'in_transit'].includes(t.value))
                  .some((t) => t.value === status)
                  ? 'primary-soft'
                  : 'transparent'
              "
              >{{
                orderStatuses
                  .filter((t) => !['', 'in_transit'].includes(t.value))
                  .find((t) => t.value === status)?.title ?? 'Ещё ▾'
              }}</v-btn
            ></template
          ><v-list
            ><v-list-item
              v-for="tab in orderStatuses.filter(
                (t) => !['', 'in_transit'].includes(t.value),
              )"
              :key="tab.value"
              :title="tab.title"
              @click="status = tab.value" /></v-list
        ></v-menu>
      </div>
      <v-text-field
        v-model="search"
        placeholder="Номер или товар на странице"
        aria-label="Номер или товар на странице"
        variant="solo"
        flat
        hide-details
        clearable
        class="mb-4 orders-search"
        @click:clear="search = ''"
      />
      <div class="d-flex align-center ga-2 mb-4">
        <p class="text-body-small text-secondary flex-grow-1">
          Данные на текущей странице
        </p>
        <v-chip
          color="warning-soft"
          class="text-warning"
          title="Подтверждение, сборка и маркировка недоступны. Заказы Авито и склад не изменяются."
          >Только просмотр</v-chip
        >
      </div>
      <v-card
        v-if="mdAndUp && visibleOrders.length"
        color="transparent"
        rounded="0"
        class="mb-4"
        ><v-table class="bg-transparent orders-table"
          ><thead>
            <tr>
              <th>Номер / дата</th>
              <th>Товары</th>
              <th>Статус Авито</th>
              <th>Срок Авито</th>
              <th>Сумма</th>
              <th />
            </tr>
          </thead>
          <tbody>
            <tr v-for="o in visibleOrders" :key="o.id" :data-order-id="o.id">
              <td>
                <p class="text-label-large orders-wrap">
                  {{ orderNumber(o.id) }}
                </p>
                <p class="text-body-small text-secondary mt-1">
                  {{ date(o.createdAt) }}
                </p>
              </td>
              <td>
                <div class="d-flex align-center ga-3 py-3">
                  <ProductThumbnail kind="denim" :src="o.items[0]?.imageUrl" />
                  <div>
                    <p class="text-label-large">
                      {{ o.items[0]?.title ?? 'Без товаров'
                      }}{{
                        o.items.length > 1 ? ` + ещё ${o.items.length - 1}` : ''
                      }}
                    </p>
                    <p class="text-body-medium mt-1">
                      {{ quantity(o) }} шт. · вариант не сопоставлен
                    </p>
                    <p class="text-body-small text-secondary mt-1">
                      Объявление {{ o.items[0]?.avitoId }}
                    </p>
                  </div>
                </div>
              </td>
              <td>
                <v-chip
                  :color="`${statusColor(o.status)}-soft`"
                  :class="`text-${statusColor(o.status)}`"
                  >{{ orderStatusLabel(o.status) }}</v-chip
                >
              </td>
              <td class="text-body-small text-warning">
                {{ date(deadline(o)) }}
              </td>
              <td class="text-label-large text-no-wrap">
                {{ amount(o.priceMinor) }}
              </td>
              <td>
                <v-btn
                  width="160"
                  :aria-label="`Открыть заказ ${o.id}`"
                  @click="selectedId = o.id"
                  >Открыть заказ</v-btn
                >
              </td>
            </tr>
          </tbody></v-table
        ></v-card
      >
      <div v-else class="d-flex flex-column ga-4">
        <v-card
          v-for="o in visibleOrders"
          :key="o.id"
          class="pa-4"
          rounded="lg"
          :data-order-id="o.id"
        >
          <div class="d-flex align-center ga-3 mb-3">
            <v-btn
              variant="text"
              color="on-surface"
              class="px-0 order-number min-w-0"
              height="auto"
              :aria-label="`Открыть заказ ${o.id}`"
              @click="selectedId = o.id"
              >{{ orderNumber(o.id) }}</v-btn
            ><span class="text-label-large flex-shrink-0 text-no-wrap">{{
              amount(o.priceMinor)
            }}</span>
          </div>
          <div class="d-flex align-center ga-3 mb-3">
            <ProductThumbnail kind="denim" :src="o.items[0]?.imageUrl" />
            <div class="min-w-0">
              <p class="text-label-large orders-wrap">
                {{ o.items[0]?.title ?? 'Без товаров'
                }}{{ o.items.length > 1 ? ` + ещё ${o.items.length - 1}` : '' }}
              </p>
              <p class="text-body-medium mt-1">
                {{ quantity(o) }} шт. · вариант не сопоставлен
              </p>
              <p class="text-body-small text-secondary mt-1">
                Объявление {{ o.items[0]?.avitoId }} · без резерва
              </p>
            </div>
          </div>
          <div class="d-flex flex-wrap align-center ga-2">
            <v-chip
              :color="`${statusColor(o.status)}-soft`"
              :class="`text-${statusColor(o.status)}`"
              >{{ orderStatusLabel(o.status) }}</v-chip
            ><span v-if="deadline(o)" class="text-body-small text-warning"
              >До {{ date(deadline(o)) }}</span
            >
          </div>
          <p class="text-body-small text-secondary mt-3">
            Авито: {{ orderStatusLabel(o.status) }}
          </p>
        </v-card>
      </div>
      <v-card
        v-if="orders.isSuccess.value && !visibleOrders.length"
        class="pa-6 text-body-medium"
        >{{
          search
            ? 'На этой странице ничего не найдено.'
            : 'Заказов в этом разделе нет.'
        }}</v-card
      >
      <div class="d-flex justify-space-between align-center ga-3 mt-5">
        <v-btn :disabled="page === 1 || orders.isFetching.value" @click="page--"
          >Назад</v-btn
        ><span class="text-body-small text-secondary">Страница {{ page }}</span
        ><v-btn
          :disabled="
            !orders.data.value?.hasMore ||
            orders.isFetching.value ||
            orders.isError.value
          "
          @click="page++"
          >Далее</v-btn
        >
      </div>
    </template>
    <template v-else-if="order">
      <p class="text-body-small text-secondary orders-wrap mb-4">
        № {{ order.id
        }}<span v-if="order.marketplaceId">
          · № маркетплейса {{ order.marketplaceId }}</span
        >
        · создан {{ date(order.createdAt) }}
      </p>
      <v-chip :color="statusColor(order.status)" variant="tonal" class="mb-5"
        >Авито: {{ orderStatusLabel(order.status) }}</v-chip
      >
      <v-row
        ><v-col cols="12" md="8">
          <v-card class="pa-4 pa-md-6 mb-5"
            ><div class="d-flex align-center ga-3 mb-4">
              <h2 class="text-title-medium">Товары заказа</h2>
              <v-spacer /><span class="text-body-small text-secondary"
                >{{ quantity(order) }} шт.</span
              >
            </div>
            <div
              v-for="item in order.items"
              :key="item.avitoId"
              class="d-flex align-center ga-4 mb-4"
            >
              <ProductThumbnail kind="denim" :src="item.imageUrl" />
              <div class="min-w-0">
                <h3 class="text-title-small orders-wrap">{{ item.title }}</h3>
                <p class="text-body-medium mt-2">
                  {{ item.quantity }} шт. · {{ amount(item.priceMinor) }} за шт.
                </p>
                <p class="text-body-small text-secondary mt-1">
                  Объявление {{ item.avitoId }}
                </p>
              </div>
            </div>
            <v-divider class="my-4" />
            <p class="text-body-small text-secondary">
              Складской вариант и резерв не назначены. Размер и цвет не
              определяются по одному объявлению.
            </p>
          </v-card>
          <v-card class="pa-4 pa-md-6 mb-5"
            ><h2 class="text-title-medium mb-3">Просмотр заказа</h2>
            <p class="text-body-medium text-secondary">
              Статус и доступные действия получены из Авито. Подтверждение,
              сборка, отгрузка и передача маркировки в приложении пока
              выключены.
            </p>
            <v-btn
              v-if="order.availableActions.some((a) => a.name === 'confirm')"
              disabled
              block
              class="mt-4"
              >Подтверждение недоступно</v-btn
            >
            <p class="text-body-small text-muted mt-3">
              Запросы в Честный знак не отправляются.
            </p></v-card
          >
          <v-card class="pa-4 pa-md-6"
            ><h2 class="text-title-medium mb-3">Обновления Авито</h2>
            <p class="text-body-medium">Создан: {{ date(order.createdAt) }}</p>
            <p class="text-body-medium mt-2">
              Изменён в Авито: {{ date(order.updatedAt) }}
            </p>
            <p class="text-body-small text-secondary mt-3">
              Обновляем данные каждые 30 секунд, пока открыт экран. Подробная
              история перемещений не предоставлена.
            </p></v-card
          > </v-col
        ><v-col cols="12" md="4">
          <v-card class="pa-4 pa-md-6 mb-5"
            ><h2 class="text-title-medium mb-3">Сроки Авито</h2>
            <p class="text-body-small text-secondary">Подтвердить до</p>
            <p class="text-title-medium mt-1">
              {{ date(order.schedules.confirmTill) }}
            </p>
            <p class="text-body-small text-secondary mt-4">Отправить до</p>
            <p class="text-title-medium mt-1">
              {{ date(order.schedules.shipTill) }}
            </p></v-card
          >
          <v-card class="pa-4 pa-md-6 mb-5"
            ><h2 class="text-title-medium mb-3">Доставка Авито</h2>
            <p class="text-body-medium">
              {{ order.delivery.serviceName ?? 'Служба не указана' }}
            </p>
            <p class="text-body-small text-secondary orders-wrap mt-3">
              Отправление: {{ order.delivery.dispatchNumber ?? 'Не указано' }}
            </p>
            <p
              class="text-body-medium orders-wrap mt-3"
              data-testid="order-tracking"
            >
              Трек-номер: {{ order.delivery.trackingNumber ?? 'Не указан' }}
            </p>
            <v-btn disabled block class="mt-4"
              >PDF пока недоступен</v-btn
            ></v-card
          >
          <v-card class="pa-4 pa-md-6 mb-5"
            ><h2 class="text-title-medium mb-3">Сумма заказа</h2>
            <p class="text-title-large">{{ amount(order.priceMinor) }}</p>
            <p class="text-body-small text-secondary mt-3">
              Стоимость товаров из Авито. Не является выплатой или прибылью.
            </p></v-card
          >
          <v-card v-if="order.availableActions.length" class="pa-4 pa-md-6"
            ><h2 class="text-title-medium mb-3">Действия в Авито</h2>
            <p
              v-for="(action, index) in order.availableActions"
              :key="index"
              class="text-body-small text-secondary mt-2"
            >
              {{ actionNames[action.name] ?? action.name
              }}{{ action.required ? ' · обязательно' : '' }}
            </p>
            <p class="text-body-small text-muted mt-3">
              Только информация · выполнение недоступно
            </p></v-card
          >
        </v-col></v-row
      >
    </template>
  </section>
</template>
<style scoped>
.orders-wrap {
  overflow-wrap: anywhere;
}
.order-number {
  flex: 1 1 0;
  justify-content: flex-start;
  white-space: normal;
  text-align: left;
}
.order-number :deep(.v-btn__content) {
  display: block;
  white-space: normal;
  overflow-wrap: anywhere;
  max-width: 100%;
}
.orders-search :deep(.v-field) {
  --v-input-control-height: 44px;
  --v-field-input-padding-top: 12px;
  --v-field-input-padding-bottom: 12px;
}
.orders-search :deep(.v-field__input) {
  min-height: 44px;
  height: 44px;
  line-height: 20px;
}
.orders-table :deep(thead) {
  display: none;
}
.orders-table :deep(td) {
  border-bottom: 0 !important;
  padding-top: 12px;
  padding-bottom: 12px;
}
.orders-table :deep(td:first-child) {
  max-width: 220px;
  padding-left: 0;
}
.orders-table :deep(td:last-child) {
  padding-right: 0;
}
</style>
