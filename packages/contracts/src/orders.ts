import { z } from 'zod';
export const orderStatusSchema = z.enum([
  'on_confirmation',
  'ready_to_ship',
  'in_transit',
  'canceled',
  'delivered',
  'on_return',
  'in_dispute',
  'closed',
]);
export const ordersQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).max(100000).default(1),
    limit: z.coerce.number().int().min(1).max(20).default(20),
    status: orderStatusSchema.optional(),
  })
  .strict();
export const orderParamsSchema = z.object({
  id: z.string().regex(/^[0-9]{1,32}$/),
});
const nullableText = z.string().nullable();
const money = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER)
  .nullable();
export const marketplaceOrderSchema = z.object({
  id: z.string(),
  marketplaceId: nullableText,
  status: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  items: z.array(
    z.object({
      avitoId: z.string(),
      title: z.string(),
      quantity: z.number().int().positive(),
      priceMinor: money,
      imageUrl: z
        .url()
        .refine((value) => new URL(value).protocol === 'https:')
        .nullable()
        .optional(),
    }),
  ),
  priceMinor: money,
  schedules: z.object({ confirmTill: nullableText, shipTill: nullableText }),
  delivery: z.object({
    serviceName: nullableText,
    serviceType: nullableText,
    trackingNumber: nullableText,
    dispatchNumber: nullableText,
  }),
  availableActions: z.array(
    z.object({ name: z.string(), required: z.boolean() }),
  ),
});
export const ordersPageResponseSchema = z.object({
  ok: z.literal(true),
  orders: z.array(marketplaceOrderSchema),
  hasMore: z.boolean(),
  fetchedAt: z.iso.datetime(),
  mode: z.literal('read_only'),
});
export const orderResponseSchema = z.object({
  ok: z.literal(true),
  order: marketplaceOrderSchema,
  fetchedAt: z.iso.datetime(),
  mode: z.literal('read_only'),
});
export type MarketplaceOrderDto = z.infer<typeof marketplaceOrderSchema>;
export type OrdersPageResponse = z.infer<typeof ordersPageResponseSchema>;
export type OrderResponse = z.infer<typeof orderResponseSchema>;
