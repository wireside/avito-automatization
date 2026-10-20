import { defineConfig, loadEnv } from 'vite';
import vue from '@vitejs/plugin-vue';
import vuetify, { transformAssetUrls } from 'vite-plugin-vuetify';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, new URL('../../', import.meta.url).pathname, '');
  return {
    envDir: '../..',
    plugins: [
      vue({ template: { transformAssetUrls } }),
      vuetify({
        autoImport: true,
        styles: { configFile: 'src/styles/settings.scss' },
      }),
    ],
    server: {
      host: '0.0.0.0',
      port: 5173,
      strictPort: true,
      allowedHosts: env.MINI_APP_TUNNEL_HOST ? [env.MINI_APP_TUNNEL_HOST] : [],
      proxy: { '/api': 'http://127.0.0.1:3000' },
    },
    preview: { port: 4173 },
  };
});
