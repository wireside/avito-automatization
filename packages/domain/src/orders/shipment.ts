import type { MarketplaceOrder } from './orders.js';
import { requirePipeline } from '../marking/pipeline.js';
export interface AvitoShipmentReference {
  externalOrderId: string;
  items: { avitoId: string; quantity: number; priceMinor: number | null }[];
}
export function assertCurrentShipment(
  order: MarketplaceOrder,
  reference: AvitoShipmentReference,
  phase: 'pack' | 'dispatch',
) {
  requirePipeline(
    order.id === reference.externalOrderId,
    'ORDER_RESPONSE_MISMATCH',
  );
  requirePipeline(
    (phase === 'pack'
      ? ['on_confirmation', 'ready_to_ship']
      : ['ready_to_ship']
    ).includes(order.status),
    'ORDER_NOT_AVAILABLE',
  );
  requirePipeline(
    order.items.length === reference.items.length &&
      reference.items.every((line) => {
        const current = order.items.find((i) => i.avitoId === line.avitoId);
        return (
          current &&
          current.quantity === line.quantity &&
          current.priceMinor === line.priceMinor
        );
      }),
    'ORDER_COMPOSITION_CHANGED',
  );
}
