import { it, expect } from 'vitest';
import {
  buildClothingDocument,
  type ClothingDocumentInput,
} from './documents.js';
const base: ClothingDocumentInput = {
  action: 'WITHDRAW',
  reason: 'DISTANCE',
  sellerInn: '123456789012',
  fiasId: 'fias',
  effectiveAt: '2026-11-04T22:00:00Z',
  items: [{ cis: '010466043076454321TEST000000001', salePriceKopecks: 250000 }],
};
it('renders distance sale price in kopecks without purchase price, KPP or forbidden fields', () => {
  const result = buildClothingDocument(base);
  expect(result.type).toBe('LK_RECEIPT');
  expect(result.body).toEqual({
    inn: base.sellerInn,
    action: 'DISTANCE',
    action_date: '2026-11-05',
    fias_id: 'fias',
    products: [{ cis: base.items[0]!.cis, product_cost: 250000 }],
  });
});
it('requires actual paid fact for return and primary document for a paid return', () => {
  expect(() =>
    buildClothingDocument({
      ...base,
      action: 'RETURN',
      reason: 'CUSTOMER_RETURN',
    }),
  ).toThrow('RETURN_PAYMENT_FACT_REQUIRED');
  expect(
    buildClothingDocument({
      ...base,
      action: 'RETURN',
      reason: 'CUSTOMER_RETURN',
      paid: false,
    }).body,
  ).not.toHaveProperty('primary_document_number');
  expect(() =>
    buildClothingDocument({
      ...base,
      action: 'RETURN',
      reason: 'CUSTOMER_RETURN',
      paid: true,
    }),
  ).toThrow('PRIMARY_DOCUMENT_REQUIRED');
});
it('separates whole-document cancellation and disposal from a consumer return', () => {
  expect(
    buildClothingDocument({
      ...base,
      action: 'CORRECT',
      reason: 'CANCELLED_BEFORE_HANDOVER',
      cancelledDocumentId: 'original',
    }),
  ).toEqual({
    type: 'LK_RECEIPT_CANCEL',
    body: { inn: base.sellerInn, lk_receipt_id: 'original' },
  });
  const result = buildClothingDocument({
    ...base,
    action: 'WRITE_OFF',
    reason: 'LOSS',
    primaryDocument: { number: '1', date: '2026-11-04', name: 'Акт утраты' },
  });
  expect(result.body).not.toHaveProperty('fias_id');
  expect(result.body.products).toEqual([{ cis: base.items[0]!.cis }]);
});
