import { z } from 'zod';
const id = z.uuid();
const text = z.string().min(1).max(200);
const at = z.iso.datetime({ offset: true });
const primaryDocument = z
  .object({ number: text, date: z.iso.date(), name: text })
  .strict();
const base = { requestId: id };
const scan = {
  raw: z.string().min(1).max(512),
  scannerProfile: z.enum(['camera-gs1-v1', 'keyboard-gs1-v1']),
};
export const markingRequests = {
  configure: z
    .object({
      ...base,
      sellerInn: z.string().regex(/^\d{12}$/),
      warehouseId: id,
      fiasId: id,
      address: text,
      fiscalEvidenceReference: text,
    })
    .strict(),
  calendar: z
    .object({
      ...base,
      days: z
        .array(z.object({ date: z.iso.date(), working: z.boolean() }).strict())
        .min(1)
        .max(800),
    })
    .strict(),
  supply: z
    .object({
      ...base,
      documentNumber: text,
      documentDate: z.iso.date(),
      supplierInn: z.string().regex(/^(\d{10}|\d{12})$/),
      evidenceReference: text,
      unitIds: z.array(id).min(1).max(1000),
    })
    .strict(),
  check: z.object({ ...base, unitId: id }).strict(),
  importOrder: z
    .object({
      ...base,
      externalOrderId: text,
      warehouseId: id.optional(),
      mappings: z
        .array(z.object({ externalItemId: text, variantId: id }).strict())
        .max(50)
        .optional(),
    })
    .strict(),
  pack: z.object({ ...base, shipmentId: id, ...scan }).strict(),
  prepare: z.object({ ...base, shipmentId: id }).strict(),
  handover: z
    .object({
      ...base,
      shipmentId: id,
      occurredAt: at,
      evidenceReference: text,
      occurredOutsideApp: z.boolean().default(false),
    })
    .strict(),
  deliver: z
    .object({
      ...base,
      shipmentId: id,
      occurredAt: at,
      evidenceReference: text,
    })
    .strict(),
  cancel: z
    .object({
      ...base,
      shipmentId: id,
      reason: text,
      physicalPresenceConfirmed: z.literal(true),
    })
    .strict(),
  return: z
    .object({
      ...base,
      shipmentId: id,
      ...scan,
      kind: z.enum(['CUSTOMER', 'UNCLAIMED']),
      condition: z.enum(['GOOD', 'DEFECTIVE', 'DAMAGED_CODE', 'WRONG_ITEM']),
      paid: z.boolean(),
      primaryDocument: primaryDocument.optional(),
      occurredAt: at,
      evidenceReference: text,
      note: text,
    })
    .strict(),
  dispose: z
    .object({
      ...base,
      unitId: id,
      reason: z.enum(['LOSS', 'DESTRUCTION']),
      primaryDocument,
      occurredAt: at,
      evidenceReference: text,
      confirmation: z.literal('CONFIRM_IRREVERSIBLE'),
    })
    .strict(),
  correctDocument: z.object({ ...base, documentId: id, reason: text }).strict(),
  retry: z.object({ ...base, operationId: id, reason: text }).strict(),
} as const;
export const markingQuery = z
  .object({ offset: z.coerce.number().int().min(0).max(100000).default(0) })
  .strict();
export const markingParams = z.object({ id }).strict();
export const markingReadSchema = z.object({
  data: z.unknown(),
});
export const markingCommandSchema = z.object({
  ok: z.literal(true),
  replayed: z.boolean(),
  result: z.record(z.string(), z.unknown()),
});
export const markingFailureSchema = z.object({
  ok: z.literal(false),
  code: z.string(),
  blockers: z.array(z.string()),
  requestId: z.string(),
});
export function markingOpenApiPaths() {
  const paths: Record<string, unknown> = {};
  const security = [{ telegramInitData: [] }];
  for (const [action, schema] of Object.entries(markingRequests))
    paths[`/api/v1/marking/commands/${action}`] = {
      post: {
        operationId: `marking_${action}`,
        tags: ['Marking'],
        security,
        description:
          'Warehouse pipeline. External document submission is separately controlled. Actor-scoped requestId is required; same requestId with changed content returns 409.',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: z.toJSONSchema(schema) } },
        },
        responses: {
          '200': {
            description: 'Committed or replayed',
            content: {
              'application/json': {
                schema: z.toJSONSchema(markingCommandSchema),
              },
            },
          },
          '409': {
            description: 'Blocked transition or idempotency conflict',
            content: {
              'application/json': {
                schema: z.toJSONSchema(markingFailureSchema),
              },
            },
          },
        },
      },
    };
  for (const suffix of [
    'overview',
    'integrations',
    'shipments',
    'shipments/{id}',
    'units/{id}',
    'documents',
    'documents/{id}',
    'documents/{id}/export',
    'issues',
    'settings',
  ])
    paths[`/api/v1/marking/${suffix}`] = {
      get: {
        operationId: `marking_read_${suffix.replace(/[^a-z]/g, '_')}`,
        tags: ['Marking'],
        security,
        parameters: [
          ...(suffix.includes('{id}')
            ? [
                {
                  name: 'id',
                  in: 'path',
                  required: true,
                  schema: { type: 'string', format: 'uuid' },
                },
              ]
            : []),
          {
            name: 'offset',
            in: 'query',
            schema: { type: 'integer', minimum: 0, default: 0 },
          },
        ],
        responses: {
          '200': {
            description: 'Sanitized projection; pages of 50 records',
            content: {
              'application/json': { schema: z.toJSONSchema(markingReadSchema) },
            },
          },
        },
      },
    };
  return paths;
}

export const integrationStatusSchema = z.object({
  avitoConfigured: z.boolean(),
  signerConfigured: z.boolean(),
  documentsEnabled: z.boolean(),
  avitoWritesEnabled: z.boolean(),
  seller_configured: z.boolean(),
  chz_authorized: z.boolean(),
  signer_online: z.boolean(),
  signer_last_seen_at: z.string().nullable(),
  certificate_expires_at: z.string().nullable(),
});
