import { z } from 'zod';
import type { markingRequests } from './marking.js';
const id = z.uuid();
const text = z.string().nullable().optional();
const amount = z
  .union([z.number().int().safe(), z.string().regex(/^\d+$/)])
  .nullable()
  .optional();
export const shipmentLineSchema = z.object({
  shipment_item_id: id,
  unit_id: id,
  name: z.string(),
  size_label: text,
  color: text,
  masked_code: z.string(),
  physical_state: z.string(),
  legal_state: text,
  packed_at: text,
  avito_marking_status: text,
  unit_price_kopecks: amount,
  legal_operation_status: text,
  submission_due_at: text,
});
export const shipmentHeaderSchema = z.object({
  id,
  parcel_code: z.string(),
  status: z.string(),
  external_order_id: text,
  items_count: z.number().int().nonnegative().optional(),
  sale_total_kopecks: amount,
  order_id: id,
  created_at: text,
  prepared_at: text,
  preparation_expires_at: text,
  handed_over_at: text,
  delivered_at: text,
  warehouse_id: text,
});
export const shipmentSchema = shipmentHeaderSchema.extend({
  items: z.array(shipmentLineSchema),
});
export const shipmentsSchema = z.array(shipmentHeaderSchema);
export const unitLegalSchema = z.object({
  id,
  current_state: z.string(),
  masked_code: z.string(),
  legal_state: text,
  ownership_verified: text,
  observed_at: text,
  received_legally: z.boolean(),
  pending: z.boolean(),
  blockers: z.array(z.string()),
});
export const overviewSchema = z.object({
  packed: z.number(),
  ready: z.number(),
  issues: z.number(),
  pending: z.number(),
  calendar_days: z.number(),
});
export const issueSchema = z.object({
  id,
  code: z.string(),
  entity_id: id,
  created_at: z.string(),
  details: z.record(z.string(), z.unknown()),
});
export const issuesSchema = z.array(issueSchema);
const docItem = z.object({
  id,
  status: z.string(),
  errorCode: text,
  error_code: text,
  unitId: text,
  unit_id: text,
  maskedCode: text,
  masked_code: text,
  action: text,
  reason: text,
  dueAt: text,
  submission_due_at: text,
});
export const documentSchema = z.object({
  id,
  status: z.string(),
  created_at: z.string(),
  external_document_id: text,
  signing_status: text,
  verification_source: text,
  items: z.array(docItem).default([]),
});
export const documentsSchema = z.array(documentSchema);
export const settingsSchema = z.array(
  z.object({
    warehouse_id: id,
    seller_inn: z.string(),
    fias_id: id,
    address: z.string(),
    fiscal_evidence_reference: z.string(),
  }),
);
export type Shipment = z.infer<typeof shipmentSchema>;
export type MarkingDocument = z.infer<typeof documentSchema>;
export type UnitLegal = z.infer<typeof unitLegalSchema>;
export type MarkingAction = keyof typeof markingRequests;
export type MarkingInput<K extends MarkingAction = MarkingAction> = z.input<
  (typeof markingRequests)[K]
>;
