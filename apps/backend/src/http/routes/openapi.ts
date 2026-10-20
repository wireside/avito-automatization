import { createPublicApiDocument } from '@avito/contracts';
import type { FastifyInstance } from 'fastify';

export function registerOpenApiRoute(app: FastifyInstance) {
  const document = createPublicApiDocument();
  app.get('/api/v1/openapi.json', () => document);
}
