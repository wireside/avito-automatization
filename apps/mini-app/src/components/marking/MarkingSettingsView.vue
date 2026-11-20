<script setup lang="ts">
import ChzConnectionPanel from './ChzConnectionPanel.vue';
import WarehouseSettingsPanel from '../WarehouseSettingsPanel.vue';
import IntegrationStatusBanner from './IntegrationStatusBanner.vue';
import { ref } from 'vue';
import { signerInstallLinkResponse } from '@avito/contracts';
import MarkingActionDialog from './MarkingActionDialog.vue';
const props = defineProps<{
  initData: string;
  active: boolean;
  roles: string[];
}>();
const installBusy = ref(false),
  installUrl = ref(''),
  installError = ref(''),
  copied = ref(false);
async function installSigner() {
  installBusy.value = true;
  installError.value = '';
  try {
    const r = await fetch(
      `${import.meta.env.VITE_API_BASE_URL ?? ''}/api/v1/local-signer/install-link`,
      {
        method: 'POST',
        headers: { authorization: `tma ${props.initData}` },
        signal: AbortSignal.timeout(15000),
      },
    );
    if (!r.ok) throw Error();
    installUrl.value = signerInstallLinkResponse.parse(await r.json()).url;
  } catch {
    installError.value =
      'Не удалось создать ссылку. Повторите через 10 секунд или отправьте нашему боту /signer.';
  } finally {
    installBusy.value = false;
  }
}
function openInstallLink() {
  installError.value = '';
  const app = window.Telegram?.WebApp;
  try {
    if (app?.openLink && app.isVersionAtLeast?.('6.1') !== false) {
      app.openLink(installUrl.value, { try_instant_view: false });
      return;
    }
  } catch {
    // Older clients can expose an SDK method without supporting it.
  }
  // A window opened from Telegram Web can inherit its download restrictions.
  installError.value =
    'Нажмите «Скопировать ссылку», откройте новую вкладку Chrome на Windows и вставьте ссылку в адресную строку.';
}
async function copyInstallLink() {
  try {
    await navigator.clipboard.writeText(installUrl.value);
    copied.value = true;
  } catch {
    installError.value = 'Скопируйте ссылку из поля ниже.';
  }
}
const dialog = ref(false);
</script>
<template>
  <section>
    <IntegrationStatusBanner :init-data="initData" />
    <h1 class="text-title-large mb-5">Настройки владельца</h1>
    <v-row
      ><v-col cols="12" md="7">
        <ChzConnectionPanel :init-data="initData" :active="active" />
        <WarehouseSettingsPanel :init-data="initData" />
        <v-card class="pa-5"
          ><h2 class="text-title-medium mb-4">Документы поставщика</h2>
          <p class="text-body-medium text-secondary mb-4">
            Входящий УПД можно привязать к партии для учёта. Привязка
            необязательна. Для сборки заказа Честный ЗНАК должен подтвердить,
            что коды в обороте и принадлежат вашему ИП.
          </p>
          <v-btn @click="dialog = true">Привязать входящий УПД</v-btn></v-card
        ></v-col
      ><v-col cols="12" md="5"
        ><v-card class="pa-5"
          ><h2 class="text-title-medium mb-4">Локальный подписант</h2>
          <v-btn
            v-if="roles.includes('OWNER')"
            color="primary-strong"
            :loading="installBusy"
            @click="installSigner"
            >Подключить Windows</v-btn
          >
          <p class="text-body-small text-secondary mt-3">
            Или отправьте нашему Telegram-боту /signer. После запуска
            установщика подтвердите компьютер кнопкой в боте.
          </p>
          <v-alert v-if="installError" type="warning" class="mt-3">{{
            installError
          }}</v-alert>
          <template v-if="installUrl">
            <v-text-field
              :model-value="installUrl"
              readonly
              label="Ссылка для Windows · 30 минут"
              class="mt-3"
            />
            <div class="d-flex flex-column flex-sm-row ga-2 mt-3">
              <v-btn
                color="primary"
                variant="outlined"
                class="flex-grow-1"
                @click="copyInstallLink"
              >
                {{ copied ? 'Ссылка скопирована' : 'Скопировать ссылку' }}
              </v-btn>
              <v-btn
                color="primary-strong"
                variant="flat"
                class="flex-grow-1"
                @click="openInstallLink"
              >
                Открыть установку
              </v-btn>
            </div>
            <p class="text-body-small text-secondary mt-2">
              Установка откроется во внешнем браузере. Если архив не
              скачивается, скопируйте ссылку и вставьте её в новую вкладку
              Chrome на Windows.
            </p>
          </template>
          <v-chip color="raised" class="mt-4 text-secondary"
            >Состояние подключения показано выше</v-chip
          >
          <p class="text-body-medium text-secondary mt-4">
            Подписант работает на Windows-компьютере владельца с подключённым
            токеном. Статус подписи доступен в карточке документа.
          </p>
          <p class="text-body-small text-muted mt-3">
            Подпись и цепочку сертификата проверяет закреплённый Windows-агент
            через КриптоПро. Ключ УКЭП и PIN остаются на компьютере владельца.
          </p></v-card
        ></v-col
      ></v-row
    ><MarkingActionDialog
      v-model="dialog"
      action="supply"
      :init-data="initData"
    />
  </section>
</template>
