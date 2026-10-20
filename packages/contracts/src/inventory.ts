import { z } from 'zod';

export const inventoryScanRequestSchema = z
  .object({
    requestId: z
      .uuid()
      .describe(
        'New UUID for one scan. Keep the same UUID and exact input for network retries; a different physical scan gets a new UUID.',
      ),
    raw: z
      .string()
      .min(1)
      .max(512)
      .describe(
        'Full decoded clothing DataMatrix. Preserve ASCII GS (U+001D), case and punctuation. Never trim or log.',
      ),
    scannerProfile: z.enum(['camera-gs1-v1', 'keyboard-gs1-v1']),
  })
  .strict();
export const inventoryListQuerySchema = z
  .object({
    search: z
      .string()
      .max(120)
      .default('')
      .describe(
        'GTIN, name, manufacturer article, size or color; case insensitive.',
      ),
    offset: z.coerce.number().int().min(0).max(1000000).default(0),
    limit: z.coerce.number().int().min(1).max(100).default(40),
  })
  .strict();
export const inventoryUnitsQuerySchema = z
  .object({ offset: z.coerce.number().int().min(0).max(1000000).default(0) })
  .strict();
export const inventoryVariantParamsSchema = z.object({ id: z.uuid() }).strict();
const quantity = z.number().int().nonnegative();
export const inventoryVariantSchema = z.object({
  id: z.uuid(),
  productId: z.uuid().nullable(),
  productName: z.string().nullable(),
  article: z.string().nullable(),
  name: z.string(),
  color: z.string().nullable(),
  size: z.string().nullable(),
  gtins: z.array(z.string().regex(/^[0-9]{14}$/)),
  reviewStatus: z.string(),
  onHand: quantity,
  available: quantity,
  quarantine: quantity,
  reserved: quantity,
  defective: quantity,
});
export const inventoryUnitSchema = z.object({
  id: z.uuid(),
  internalCode: z.string(),
  variantId: z.uuid(),
  name: z.string(),
  maskedCode: z.string(),
  state: z.string(),
  location: z.string().nullable(),
  receiptId: z.uuid(),
  receiptNumber: z.string(),
  receivedAt: z.iso.datetime(),
});
export const inventoryPageResponseSchema = z.object({
  ok: z.literal(true),
  warehouse: z.object({ id: z.uuid(), name: z.string() }),
  totals: z.object({
    onHand: quantity,
    available: quantity,
    quarantine: quantity,
  }),
  items: z.array(inventoryVariantSchema),
  hasMore: z.boolean(),
});
export const inventoryUnitsResponseSchema = z.object({
  ok: z.literal(true),
  items: z.array(inventoryUnitSchema).max(20),
  hasMore: z.boolean(),
});
export const inventoryScanResponseSchema = z.object({
  ok: z.literal(true),
  outcome: z.enum(['ACCEPTED', 'DUPLICATE']),
  unit: inventoryUnitSchema,
  replayed: z.boolean(),
});
export type InventoryScanRequest = z.infer<typeof inventoryScanRequestSchema>;
export type InventoryListQuery = z.infer<typeof inventoryListQuerySchema>;
export type InventoryUnitsQuery = z.infer<typeof inventoryUnitsQuerySchema>;
export type InventoryVariantDto = z.infer<typeof inventoryVariantSchema>;
export type InventoryUnitDto = z.infer<typeof inventoryUnitSchema>;
export type InventoryPageResponse = z.infer<typeof inventoryPageResponseSchema>;
export type InventoryUnitsResponse = z.infer<
  typeof inventoryUnitsResponseSchema
>;
export type InventoryScanResponse = z.infer<typeof inventoryScanResponseSchema>;
