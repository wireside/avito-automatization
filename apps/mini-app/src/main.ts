import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { createApp } from 'vue';
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-600.css';
import '@fontsource/inter/latin-700.css';
import '@fontsource/inter/cyrillic-400.css';
import '@fontsource/inter/cyrillic-500.css';
import '@fontsource/inter/cyrillic-600.css';
import '@fontsource/inter/cyrillic-700.css';
import 'vuetify/styles';
import './styles/main.scss';
import App from './App.vue';
import { vuetify } from './plugins/vuetify';
import { configureTelegramAppearance } from './design/telegram';
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false, staleTime: 15_000, refetchOnWindowFocus: true },
    mutations: { retry: false },
  },
});
configureTelegramAppearance(window.Telegram?.WebApp);
window.Telegram?.WebApp.ready();
window.Telegram?.WebApp.expand();
createApp(App).use(vuetify).use(VueQueryPlugin, { queryClient }).mount('#root');
