export const catalogLookupStatuses = [
  'FOUND',
  'NOT_FOUND',
  'UNAVAILABLE',
  'NOT_CONFIGURED',
  'AMBIGUOUS',
] as const;
export interface CatalogAttribute {
  id: number;
  name: string;
  value: string;
  valueType: string | null;
}
export interface CatalogCard {
  sourceReference: string;
  name: string | null;
  status: string;
  identifiers: { value: string; type: string; level: string }[];
  attributes: CatalogAttribute[];
}
export interface ReceiptCatalog {
  gtin: string;
  sourceReference: string;
  observedAt: string;
  name: string;
  sourceName: string;
  article: string | null;
  color: string | null;
  size: string | null;
  sizeSystem: string | null;
  materialComposition: string | null;
  attributes: CatalogAttribute[];
}
export type CatalogLookupResult =
  | { status: 'FOUND'; product: ReceiptCatalog }
  | { status: Exclude<(typeof catalogLookupStatuses)[number], 'FOUND'> };

export function normalizeCatalogGtin(value: string): string | undefined {
  if (!/^(?:[0-9]{8}|[0-9]{12,14})$/.test(value)) return;
  const gtin = value.padStart(14, '0');
  const sum = [...gtin.slice(0, 13)].reduce(
    (total, digit, index) => total + Number(digit) * (index % 2 === 0 ? 3 : 1),
    0,
  );
  return (10 - (sum % 10)) % 10 === Number(gtin[13]) ? gtin : undefined;
}

const normalizeAttribute = (value: string) =>
  value
    .toLocaleLowerCase('ru-RU')
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

const normalizeValue = (value: string) =>
  value
    .normalize('NFC')
    .toLocaleLowerCase('ru-RU')
    .replace(/ё/g, 'е')
    .replace(/\s+/g, ' ')
    .trim();

export function resolveReceiptCatalog(
  gtin: string,
  cards: CatalogCard[],
  observedAt: string,
): CatalogLookupResult {
  const matching = cards.filter((card) =>
    card.identifiers.some(
      (identifier) =>
        identifier.type === 'gtin' &&
        identifier.level === 'trade-unit' &&
        normalizeCatalogGtin(identifier.value) === gtin,
    ),
  );
  if (!matching.length) return { status: 'NOT_FOUND' };
  if (matching.length !== 1) return { status: 'AMBIGUOUS' };
  const card = matching[0]!;
  let conflict = card.status.toLowerCase() !== 'published';
  const attribute = (...aliases: string[]) => {
    const names = aliases.map(normalizeAttribute);
    const candidates = card.attributes.filter(
      (entry) =>
        names.includes(normalizeAttribute(entry.name)) && entry.value.trim(),
    );
    if (
      new Set(
        candidates.map(
          (entry) =>
            `${normalizeValue(entry.value)}:${normalizeValue(entry.valueType ?? '')}`,
        ),
      ).size > 1
    ) {
      conflict = true;
      return undefined;
    }
    return candidates[0];
  };
  const sourceName =
    card.name?.trim() ||
    attribute(
      'Полное наименование товара',
      'Наименование товара',
    )?.value.trim();
  if (!sourceName) return { status: 'NOT_FOUND' };
  let article =
    attribute(
      'Модель / артикул производителя',
      'Артикул производителя',
      'Артикул',
      'Модель',
    )?.value.trim() ?? null;
  const color = attribute('Цвет', 'Цвет изделия')?.value.trim() ?? null;
  const sizeAttribute = attribute(
    'Размер одежды / изделия',
    'Размер одежды',
    'Размер изделия',
    'Размер',
  );
  const size = sizeAttribute?.value.trim() ?? null;
  const sizeSystem = sizeAttribute?.valueType?.trim() || null;
  const materialComposition =
    attribute('Состав', 'Состав сырья', 'Состав материала')?.value.trim() ??
    null;
  const kind = attribute(
    'Вид товара',
    'Тип изделия',
    'Вид изделия',
  )?.value.trim();
  const titleArticle =
    /(?:^|[^\p{L}\p{N}])(?:артикул|арт\.)\s*[:№#]?\s*([\p{L}\p{N}][\p{L}\p{N}._/-]*)/iu.exec(
      sourceName,
    )?.[1];
  if (
    article &&
    titleArticle &&
    /\d/.test(titleArticle) &&
    normalizeValue(titleArticle) !== normalizeValue(article)
  ) {
    conflict = true;
    article = null;
  }
  return {
    status: 'FOUND',
    product: {
      gtin,
      sourceReference: card.sourceReference,
      observedAt,
      name:
        conflict || !article
          ? sourceName
          : [kind, article, color, size].filter(Boolean).join(' '),
      sourceName,
      article,
      color,
      size,
      sizeSystem,
      materialComposition,
      attributes: card.attributes,
    },
  };
}

export function canEnrichIntakeVariant(
  variant: {
    sku: string;
    name: string;
    productId: string | null;
    archivedAt: Date | null;
    color: string | null;
    sizeLabel: string | null;
    sizeSystem: string | null;
    materialComposition: string | null;
    attributes: Record<string, unknown>;
  },
  gtin: string,
): boolean {
  return (
    variant.sku === `GTIN:${gtin}` &&
    variant.name === `Товар ${gtin}` &&
    variant.productId === null &&
    variant.archivedAt === null &&
    variant.color === null &&
    variant.sizeLabel === null &&
    variant.sizeSystem === null &&
    variant.materialComposition === null &&
    Object.keys(variant.attributes).length === 0
  );
}
