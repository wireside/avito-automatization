import { createWorkerRuntime } from './bootstrap/worker.js';
import { readConfig } from './config/index.js';

const runtime = createWorkerRuntime(readConfig());
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    runtime.logger.info({ signal }, 'Shutting down worker');
    void runtime.close().finally(() => process.exit(0));
  });
}
await runtime.start();
