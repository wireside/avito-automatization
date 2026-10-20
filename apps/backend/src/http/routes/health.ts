import type { FastifyInstance } from 'fastify';

export interface DependencyReadiness {
  postgres: 'ok' | 'error';
  redis: 'ok' | 'error';
}
export function registerHealthRoutes(
  app: FastifyInstance,
  checkReadiness: () => Promise<DependencyReadiness>,
) {
  app.get('/health/live', () => ({
    status: 'ok',
    service: 'backend-api',
    timestamp: new Date().toISOString(),
  }));
  app.get('/health/ready', async (_request, reply) => {
    const dependencies = await checkReadiness();
    const ready = dependencies.postgres === 'ok' && dependencies.redis === 'ok';
    if (!ready) reply.code(503);
    return {
      status: ready ? 'ok' : 'degraded',
      service: 'backend-api',
      timestamp: new Date().toISOString(),
      dependencies,
    };
  });
}
