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
import { colors } from './design/tokens';
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false, staleTime: 15_000, refetchOnWindowFocus: true },
    mutations: { retry: false },
  },
});
window.Telegram?.WebApp.ready();
window.Telegram?.WebApp.expand();
window.Telegram?.WebApp.setHeaderColor?.(colors.background);
window.Telegram?.WebApp.setBackgroundColor?.(colors.background);
createApp(App).use(vuetify).use(VueQueryPlugin, { queryClient }).mount('#root');
