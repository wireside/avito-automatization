import type { StockVariant } from './inventory-api';

export function stockVariantLabel(item: StockVariant) {
  return (
    [item.size && `Размер ${item.size}`, item.color]
      .filter(Boolean)
      .join(' · ') || 'Размер и цвет не указаны'
  );
}

export function groupStock(items: StockVariant[]) {
  const groups = new Map<
    string,
    {
      id: string;
      name: string;
      article: string | null;
      items: StockVariant[];
    }
  >();
  for (const item of items) {
    const id = item.productId ?? item.id;
    const existing = groups.get(id);
    if (existing) existing.items.push(item);
    else
      groups.set(id, {
        id,
        name: item.productName ?? item.name,
        article: item.article,
        items: [item],
      });
  }
  const bySize = new Intl.Collator('ru', { numeric: true });
  for (const group of groups.values()) {
    group.items.sort((a, b) => {
      if (a.size === null && b.size !== null) return 1;
      if (b.size === null && a.size !== null) return -1;
      return bySize.compare(a.size ?? '', b.size ?? '');
    });
  }
  return [...groups.values()];
}
