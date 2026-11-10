import { z } from 'zod';
const value = z.string().min(1).max(500);
const empty = z.object({}).strict();
const tracking = z.object({ trackingNumber: value }).strict();
export const avitoActionCommandSchema = z.intersection(
  z.object({ requestId: z.uuid() }),
  z.discriminatedUnion('action', [
    z.object({ action: z.enum(['confirm', 'reject', 'perform']), data: empty }),
    z.object({
      action: z.literal('receive'),
      data: z.object({ confirmCode: value.optional() }).strict(),
    }),
    z.object({
      action: z.enum(['setTrackNumber', 'fixTrackNumber']),
      data: tracking,
    }),
    z.object({
      action: z.literal('acceptReturnOrder'),
      data: z
        .object({
          terminalNumber: z.string().regex(/^\d{6}$/),
          name: value,
          phone: z.string().regex(/^\+?\d{10,15}$/),
        })
        .strict(),
    }),
    z.object({
      action: z.literal('setCNCDetails'),
      data: z
        .object({
          address: value,
          details: z.string().max(1000),
          bookingPeriod: z.number().int().positive().max(365),
        })
        .strict(),
    }),
    z.object({
      action: z.literal('setCourierDeliveryRange'),
      data: z
        .object({
          address: value,
          addressDetails: z.string().max(500).optional(),
          name: value,
          phone: z.string().regex(/^\+?\d{10,15}$/),
          startDate: z.iso.datetime({ offset: true }),
          endDate: z.iso.datetime({ offset: true }),
          intervalType: z.enum(['fixed', 'asap']),
        })
        .strict()
        .refine((d) => Date.parse(d.endDate) > Date.parse(d.startDate)),
    }),
    z.object({ action: z.literal('label'), data: empty }),
  ]),
);
export const avitoActionsResponseSchema = z.object({
  writesEnabled: z.boolean(),
  operations: z.array(
    z.object({
      id: z.uuid(),
      action: z.string(),
      status: z.string(),
      errorCode: z.string().nullable(),
      createdAt: z.iso.datetime(),
      labelReady: z.boolean(),
      reconcilable: z.boolean().default(false),
    }),
  ),
});
export const avitoActionQueuedSchema = z.object({
  operationId: z.uuid(),
  replayed: z.boolean(),
});
export const courierOptionsSchema = z.object({
  address: z.string().optional(),
  addressDetails: z.string().optional(),
  name: z.string().optional(),
  phone: z.string().optional(),
  dateOptions: z.array(
    z.object({
      date: z.string(),
      timeIntervals: z.array(
        z.object({
          startDate: z.string(),
          endDate: z.string(),
          title: z.string(),
          type: z.string(),
        }),
      ),
    }),
  ),
});
export type AvitoActionCommandDto = z.infer<typeof avitoActionCommandSchema>;
