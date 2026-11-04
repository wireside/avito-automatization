import { requirePipeline } from './pipeline.js';
/** Reviewed subset: True API 747.0, 2026-10-21, pp.123–128,174–187. No invented purchase costs. */
export interface PrimaryDocument {
  number: string;
  date: string;
  name: string;
}
export interface ClothingDocumentInput {
  action: 'WITHDRAW' | 'RETURN' | 'WRITE_OFF' | 'CORRECT';
  reason: string;
  sellerInn: string;
  fiasId?: string;
  effectiveAt: string;
  items: { cis: string; salePriceKopecks?: number }[];
  paid?: boolean;
  primaryDocument?: PrimaryDocument;
  cancelledDocumentId?: string;
}
export function buildClothingDocument(input: ClothingDocumentInput): {
  type: 'LK_RECEIPT' | 'LP_RETURN' | 'LK_RECEIPT_CANCEL';
  body: Record<string, unknown>;
} {
  requirePipeline(/^\d{12}$/.test(input.sellerInn), 'INVALID_SELLER_INN');
  requirePipeline(
    input.items.length > 0 &&
      new Set(input.items.map((i) => i.cis)).size === input.items.length,
    'INVALID_DOCUMENT_COMPOSITION',
  );
  requirePipeline(
    input.items.every((i) => /^01\d{14}21[!-~]{13}$/.test(i.cis)),
    'INVALID_MARKING',
  );
  const day = new Date(Date.parse(input.effectiveAt) + 3 * 3600_000)
    .toISOString()
    .slice(0, 10);
  if (input.action === 'CORRECT') {
    requirePipeline(input.cancelledDocumentId, 'ORIGINAL_DOCUMENT_REQUIRED');
    return {
      type: 'LK_RECEIPT_CANCEL',
      body: { inn: input.sellerInn, lk_receipt_id: input.cancelledDocumentId },
    };
  }
  if (input.action === 'RETURN') {
    requirePipeline(
      typeof input.paid === 'boolean',
      'RETURN_PAYMENT_FACT_REQUIRED',
    );
    requirePipeline(
      !input.paid || input.primaryDocument,
      'PRIMARY_DOCUMENT_REQUIRED',
    );
    const d = input.primaryDocument;
    return {
      type: 'LP_RETURN',
      body: {
        trade_participant_inn: input.sellerInn,
        return_type: 'REMOTE_SALE_RETURN',
        paid: input.paid,
        ...(input.paid && d
          ? {
              primary_document_type: 'OTHER',
              primary_document_number: d.number,
              primary_document_date: d.date,
              primary_document_custom_name: d.name,
            }
          : {}),
        products_list: input.items.map((i) => ({ ki: i.cis })),
      },
    };
  }
  const sale = input.action === 'WITHDRAW';
  requirePipeline(
    sale
      ? input.reason === 'DISTANCE'
      : ['LOSS', 'DESTRUCTION'].includes(input.reason),
    'INVALID_LEGAL_REASON',
  );
  requirePipeline(!sale || input.fiasId, 'PLACE_OF_ACTIVITY_REQUIRED');
  requirePipeline(
    !sale ||
      input.items.every(
        (i) =>
          Number.isSafeInteger(i.salePriceKopecks) && i.salePriceKopecks! >= 0,
      ),
    'SALE_PRICE_REQUIRED',
  );
  requirePipeline(sale || input.primaryDocument, 'PRIMARY_DOCUMENT_REQUIRED');
  const d = input.primaryDocument;
  return {
    type: 'LK_RECEIPT',
    body: {
      inn: input.sellerInn,
      action: input.reason,
      action_date: day,
      ...(sale ? { fias_id: input.fiasId } : {}),
      ...(!sale && d
        ? {
            document_type: 'OTHER',
            document_number: d.number,
            document_date: d.date,
            primary_document_custom_name: d.name,
          }
        : {}),
      products: input.items.map((i) => ({
        cis: i.cis,
        ...(sale ? { product_cost: i.salePriceKopecks } : {}),
      })),
    },
  };
}
