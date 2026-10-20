import { createApiRuntime } from './bootstrap/api.js';
import { readConfig } from './config/index.js';

const runtime = await createApiRuntime(readConfig());
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    runtime.app.log.info({ signal }, 'Shutting down API');
    void runtime.close().finally(() => process.exit(0));
  });
}
await runtime.start(() => {
  runtime.app.log.error(
    'Telegram polling failed; check token, network, webhook, and competing processes',
  );
  void runtime.close().finally(() => process.exit(1));
});
