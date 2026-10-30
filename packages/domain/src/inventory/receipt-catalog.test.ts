import { describe, expect, it } from 'vitest';
import {
  resolveReceiptCatalog,
  normalizeCatalogGtin,
  type CatalogCard,
} from './receipt-catalog.js';

const gtin = '04660430764543';
const observedAt = '2026-10-27T12:00:00.000Z';
const card: CatalogCard = {
  sourceReference: 'national-catalog:123',
  name: 'Брюки арт. AB-77 синие L',
  status: 'published',
  identifiers: [{ value: gtin.slice(1), type: 'gtin', level: 'trade-unit' }],
  attributes: [
    { id: 12, name: 'Вид товара', value: 'Брюки', valueType: null },
    {
      id: 13914,
      name: 'Модель / артикул производителя',
      value: 'AB-77',
      valueType: null,
    },
    { id: 36, name: 'Цвет', value: 'синий', valueType: null },
    {
      id: 35,
      name: 'Размер одежды / изделия',
      value: 'L',
      valueType: 'ЕВРОПА',
    },
  ],
};
describe('receipt catalog resolution', () => {
  it('maps each exact GTIN and preserves source/size system instead of hardcoding a model', () => {
    const result = resolveReceiptCatalog(gtin, [card], observedAt);
    expect(result).toMatchObject({
      status: 'FOUND',
      product: {
        gtin,
        name: 'Брюки AB-77 синий L',
        article: 'AB-77',
        color: 'синий',
        size: 'L',
        sizeSystem: 'ЕВРОПА',
        sourceReference: card.sourceReference,
        observedAt,
      },
    });
    const another = {
      ...card,
      name: 'Шорты арт. ZX-14',
      identifiers: [
        { value: '04660430764550', type: 'gtin', level: 'trade-unit' },
      ],
      attributes: card.attributes.map((attribute) =>
        attribute.id === 13914 ? { ...attribute, value: 'ZX-14' } : attribute,
      ),
    };
    expect(
      resolveReceiptCatalog('04660430764550', [card, another], observedAt),
    ).toMatchObject({
      status: 'FOUND',
      product: { gtin: '04660430764550', article: 'ZX-14' },
    });
  });
  it('validates normalized GTINs without numeric conversion', () => {
    expect(normalizeCatalogGtin(gtin.slice(1))).toBe(gtin);
    for (const value of [
      '4660430764544',
      '4.660430764543e12',
      ` ${gtin}`,
      'invalid',
    ])
      expect(normalizeCatalogGtin(value)).toBeUndefined();
  });
  it('does not use a mismatched GTIN, non-consumer pack or ambiguous result', () => {
    expect(
      resolveReceiptCatalog('04660430764550', [card], observedAt).status,
    ).toBe('NOT_FOUND');
    expect(
      resolveReceiptCatalog(
        gtin,
        [
          {
            ...card,
            identifiers: [{ value: gtin, type: 'gtin', level: 'box' }],
          },
        ],
        observedAt,
      ).status,
    ).toBe('NOT_FOUND');
    expect(
      resolveReceiptCatalog(
        gtin,
        [card, { ...card, sourceReference: 'national-catalog:other' }],
        observedAt,
      ).status,
    ).toBe('AMBIGUOUS');
  });
  it('keeps missing fields explicit instead of guessing from a title', () => {
    expect(
      resolveReceiptCatalog(gtin, [{ ...card, attributes: [] }], observedAt),
    ).toMatchObject({
      status: 'FOUND',
      product: {
        name: card.name,
        article: null,
        color: null,
        size: null,
      },
    });
  });
  it('does not silently assign an article contradicted by the title', () => {
    expect(
      resolveReceiptCatalog(
        gtin,
        [{ ...card, name: 'Брюки арт. AB-78 синие L' }],
        observedAt,
      ),
    ).toMatchObject({
      status: 'FOUND',
      product: {
        name: 'Брюки арт. AB-78 синие L',
        article: null,
      },
    });
  });
  it('preserves unambiguous fields without a human review status', () => {
    expect(
      resolveReceiptCatalog(
        gtin,
        [
          {
            ...card,
            attributes: [
              ...card.attributes,
              { id: 36, name: 'Цвет', value: 'красный', valueType: null },
            ],
          },
        ],
        observedAt,
      ),
    ).toMatchObject({
      status: 'FOUND',
      product: { color: null },
    });
    expect(
      resolveReceiptCatalog(
        gtin,
        [{ ...card, status: 'archived' }],
        observedAt,
      ),
    ).toMatchObject({ status: 'FOUND', product: { name: card.name } });
  });
});
