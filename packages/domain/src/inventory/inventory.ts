import type { SessionUser } from '../auth/verify-telegram-session.js';
import { parseClothingMarking, type ScannerProfile } from './parse-marking.js';
import type { CatalogLookupResult, ReceiptCatalog } from './receipt-catalog.js';

export interface InventoryQuery {
  search: string;
  offset: number;
  limit: number;
}
export interface InventoryVariant {
  id: string;
  productId: string | null;
  productName: string | null;
  article: string | null;
  name: string;
  size: string | null;
  color: string | null;
  gtins: string[];
  onHand: number;
  available: number;
  quarantine: number;
  reserved: number;
  defective: number;
}
export interface InventoryPage {
  warehouse: { id: string; name: string };
  totals: { onHand: number; available: number; quarantine: number };
  items: InventoryVariant[];
  hasMore: boolean;
}
export interface InventoryUnit {
  id: string;
  internalCode: string;
  variantId: string;
  name: string;
  article?: string | null;
  color?: string | null;
  size?: string | null;
  sizeSystem?: string | null;
  maskedCode: string;
  state: string;
  location: string | null;
  receiptId: string;
  receiptNumber: string;
  receivedAt: string;
}
export interface ReceiptCommand {
  actorUserId: string;
  requestId: string;
  gtin: string;
  identityHash: string;
  inputFingerprint: string;
  maskedCode: string;
  payloadCiphertext: string;
  encryptionKeyId: string;
  parserProfile: string;
  scannerProfile: ScannerProfile;
  catalog?: ReceiptCatalog;
}
export type ReceiptResult =
  | {
      ok: true;
      outcome: 'ACCEPTED' | 'DUPLICATE';
      unit: InventoryUnit;
      replayed: boolean;
    }
  | {
      ok: false;
      code:
        | 'IDEMPOTENCY_CONFLICT'
        | 'CATALOG_ARCHIVED'
        | 'WAREHOUSE_UNAVAILABLE'
        | 'CATALOG_NOT_FOUND';
    };
export type InventoryFailure = {
  ok: false;
  code:
    | 'FORBIDDEN'
    | 'INVALID_MARKING'
    | 'INVALID_GTIN'
    | 'MARKING_STORAGE_NOT_CONFIGURED'
    | 'CATALOG_NOT_CONFIGURED'
    | 'CATALOG_NOT_FOUND'
    | 'CATALOG_UNAVAILABLE'
    | 'CATALOG_AMBIGUOUS';
};
export const canReceiveStock = (roles: readonly string[]) =>
  roles.some((role) => ['OWNER', 'ADMIN', 'WAREHOUSE'].includes(role));
export const canReadStock = (roles: readonly string[]) =>
  roles.some((role) =>
    ['OWNER', 'ADMIN', 'WAREHOUSE', 'ACCOUNTANT', 'VIEWER'].includes(role),
  );

export function createReceiveStock(deps: {
  needsCatalogLookup?: (gtin: string) => Promise<boolean>;
  lookupCatalog?: (gtin: string) => Promise<CatalogLookupResult>;
  protectMarking?: (
    raw: string,
    identity: string,
  ) => {
    identityHash: string;
    inputFingerprint: string;
    payloadCiphertext: string;
    encryptionKeyId: string;
  };
  receive: (command: ReceiptCommand) => Promise<ReceiptResult>;
}) {
  return async (
    user: SessionUser,
    input: { requestId: string; raw: string; scannerProfile: ScannerProfile },
  ): Promise<ReceiptResult | InventoryFailure> => {
    if (!canReceiveStock(user.roles)) return { ok: false, code: 'FORBIDDEN' };
    const parsed = parseClothingMarking(input.raw, input.scannerProfile);
    if (!parsed.ok) return parsed;
    if (!deps.protectMarking)
      return { ok: false, code: 'MARKING_STORAGE_NOT_CONFIGURED' };
    const { gtin, maskedCode, parserProfile, identity } = parsed.marking;
    const protectedMarking = deps.protectMarking(input.raw, identity);
    let catalog: CatalogLookupResult | undefined;
    if (
      deps.lookupCatalog &&
      (!deps.needsCatalogLookup || (await deps.needsCatalogLookup(gtin)))
    ) {
      try {
        catalog = await deps.lookupCatalog(gtin);
      } catch {
        catalog = { status: 'UNAVAILABLE' };
      }
    }
    if (
      catalog?.status === 'FOUND' &&
      (catalog.product.gtin !== gtin || !catalog.product.name.trim())
    )
      catalog = { status: 'NOT_FOUND' };
    const result = await deps.receive({
      actorUserId: user.id,
      requestId: input.requestId,
      gtin,
      maskedCode,
      parserProfile,
      scannerProfile: input.scannerProfile,
      ...protectedMarking,
      ...(catalog?.status === 'FOUND' && catalog.product.gtin === gtin
        ? { catalog: catalog.product }
        : {}),
    });
    // Persistence may still resolve a replay, duplicate or a concurrently cached card.
    // A missing catalog can never create a provisional unit in the transaction.
    if (!result.ok && result.code === 'CATALOG_NOT_FOUND') {
      const code =
        catalog?.status === 'UNAVAILABLE'
          ? 'CATALOG_UNAVAILABLE'
          : catalog?.status === 'AMBIGUOUS'
            ? 'CATALOG_AMBIGUOUS'
            : !catalog || catalog.status === 'NOT_CONFIGURED'
              ? 'CATALOG_NOT_CONFIGURED'
              : 'CATALOG_NOT_FOUND';
      return { ok: false, code };
    }
    return result;
  };
}
export function createReadInventory(deps: {
  list: (query: InventoryQuery) => Promise<InventoryPage>;
  units: (
    variantId: string,
    offset: number,
  ) => Promise<{ items: InventoryUnit[]; hasMore: boolean }>;
}) {
  return {
    list: async (user: SessionUser, query: InventoryQuery) =>
      canReadStock(user.roles)
        ? { ok: true as const, ...(await deps.list(query)) }
        : { ok: false as const, code: 'FORBIDDEN' as const },
    units: async (user: SessionUser, variantId: string, offset: number) =>
      canReadStock(user.roles)
        ? { ok: true as const, ...(await deps.units(variantId, offset)) }
        : { ok: false as const, code: 'FORBIDDEN' as const },
  };
}
export type ReceiveStock = ReturnType<typeof createReceiveStock>;
export type ReadInventory = ReturnType<typeof createReadInventory>;
