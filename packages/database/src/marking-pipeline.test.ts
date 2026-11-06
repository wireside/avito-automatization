import { randomUUID, createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import {
  createMarkingPipeline,
  createReceiveStock,
  createMarkingExecutor,
  ProviderError,
  createProcessIntegrationOperation,
  type PipelineAction,
  type CodeObservation,
  type ProviderDocument,
} from '@avito/domain';
import { createDatabaseClient } from './client.js';
import { createInventoryStore } from './inventory.js';
import { createMarkingPipelineStore } from './marking-pipeline.js';
import { createMarkingWorkStore } from './provider-work.js';
import {
  claimIntegrationOperation,
  completeIntegrationOperation,
  failIntegrationOperation,
  listEnqueueableOperationIds,
} from './operations.js';
import { users } from './schema.js';
const url =
  process.env.RUN_MARKING_TESTS === 'true'
    ? process.env.DATABASE_URL
    : undefined;
(url ? describe : describe.skip)(
  'warehouse with provider adapters and PostgreSQL',
  () => {
    const db = createDatabaseClient(url ?? 'postgresql://unused'),
      ciphertexts = new Map<string, string>();
    const protect = (raw: string, identity: string) => {
      const id = randomUUID();
      ciphertexts.set(id, raw);
      return {
        identityHash: createHash('sha256').update(identity).digest('hex'),
        inputFingerprint: createHash('sha256').update(raw).digest('hex'),
        payloadCiphertext: id,
        encryptionKeyId: 'test',
      };
    };
    const protection = {
      encrypt: protect,
      decrypt: (id: string) => {
        const raw = ciphertexts.get(id);
        if (!raw) throw Error('fixture ciphertext missing');
        return raw;
      },
    };
    const actor = {
        id: randomUUID(),
        telegramId: 'integration',
        displayName: null,
        roles: ['OWNER'],
      },
      store = createMarkingPipelineStore(db.db, protection),
      pipeline = createMarkingPipeline(store),
      workStore = createMarkingWorkStore(db.db, protection),
      inventory = createInventoryStore(db.db);
    const codes = new Map<string, CodeObservation>(),
      documents = new Map<string, ProviderDocument>(),
      inn = '123456789012',
      supplier = '1234567890';
    let warehouseId = '',
      serial = 0;
    const legal = {
      authorizeSubmission: () => Promise.resolve(),
      check: vi.fn((cises: string[]) =>
        Promise.resolve(
          cises.flatMap((c) => (codes.get(c) ? [codes.get(c)!] : [])),
        ),
      ),
      document: vi.fn((id: string) => {
        const d = documents.get(id);
        if (!d) throw Error('fixture document missing');
        return Promise.resolve(d);
      }),
      submit: vi.fn(
        (input: {
          type: string;
          payloadBase64: string;
          signatureBase64: string;
        }) => {
          const body = JSON.parse(
            Buffer.from(input.payloadBase64, 'base64').toString(),
          ) as {
            products?: { cis: string }[];
            products_list?: { ki: string }[];
            lk_receipt_id?: string;
          };
          const id = randomUUID(),
            returning =
              input.type === 'LP_RETURN' || input.type === 'LK_RECEIPT_CANCEL';
          const original = body.lk_receipt_id
            ? documents.get(body.lk_receipt_id)
            : null;
          const cises =
            body.products?.map((i) => i.cis) ??
            body.products_list?.map((i) => i.ki) ??
            (
              (original?.body as { products: { cis: string }[] })?.products ??
              []
            ).map((i) => i.cis);
          for (const cis of cises)
            codes.set(cis, {
              cis,
              status: returning ? 'INTRODUCED' : 'RETIRED',
              statusEx: 'EMPTY',
              ownerInn: inn,
              observedAt: new Date().toISOString(),
            });
          documents.set(id, {
            id,
            status: 'CHECKED_OK',
            senderInn: inn,
            receiverInn: '',
            type: input.type,
            body,
          });
          return Promise.resolve(id);
        },
      ),
    };
    const execute = createMarkingExecutor({
      store: workStore,
      legal,
      sendMarkings: () => Promise.resolve(),
      submissionsEnabled: true,
    });
    const process = createProcessIntegrationOperation({
      store: {
        claim: (id) => claimIntegrationOperation(db.db, id),
        complete: (id, n) => completeIntegrationOperation(db.db, id, n),
        fail: (i) => failIntegrationOperation(db.db, i),
      },
      retryDelay: () => 0,
      execute: (job) => execute(job.id),
    });
    const command = (action: PipelineAction, input: Record<string, unknown>) =>
      pipeline.command(actor, action, { requestId: randomUUID(), ...input });
    async function drain() {
      for (let round = 0; round < 16; round++) {
        const signJobs = (
          await db.db.execute<{ id: string; payload_hash: string }>(
            sql`SELECT id,payload_hash FROM signer_jobs WHERE purpose='DOCUMENT' AND status='PENDING'`,
          )
        ).rows;
        for (const task of signJobs) {
          const enc = protect(
            JSON.stringify({
              signatureBase64: 'fixture-cms',
              certificateBase64: 'fixture-certificate',
            }),
            'signature:' + task.id,
          );
          await db.db.execute(
            sql`UPDATE signer_jobs SET status='VERIFIED',signature_ciphertext=${enc.payloadCiphertext},signature_key_id=${enc.encryptionKeyId},signature_identity_hash=${enc.identityHash},signature_hash=${'a'.repeat(64)},verified_at=now() WHERE id=${task.id}`,
          );
        }
        await db.db.execute(
          sql`UPDATE integration_operations SET next_attempt_at=now()-interval '1 second' WHERE operation_type LIKE 'pipeline.%' AND status IN ('PENDING','RETRY_SCHEDULED')`,
        );
        const ids = await listEnqueueableOperationIds(db.db);
        if (!ids.length) return;
        for (const id of ids) await process(id);
      }
      throw Error('jobs did not settle');
    }
    const receive = createReceiveStock({
      receive: (i) => inventory.receive(i),
      protectMarking: protect,
      needsCatalogLookup: (g) => inventory.needsCatalogLookup(g),
      lookupCatalog: (g) =>
        Promise.resolve({
          status: 'FOUND',
          product: {
            gtin: g,
            name: 'Брюки',
            sourceName: 'Брюки',
            article: null,
            color: null,
            size: null,
            sizeSystem: null,
            materialComposition: null,
            sourceReference: 'fixture:' + g,
            observedAt: new Date().toISOString(),
            attributes: [],
          },
        }),
    });
    async function fixture() {
      const prefix = '04660430' + String(20000 + serial++),
        sum = [...prefix].reduce(
          (n, d, i) => n + Number(d) * (i % 2 === 0 ? 3 : 1),
          0,
        ),
        gtin = prefix + ((10 - (sum % 10)) % 10),
        cis = '01' + gtin + '21TEST000000001',
        raw = cis + '\u001d91ABCD\u001d92' + 'A'.repeat(44);
      const r = await receive(actor, {
        requestId: randomUUID(),
        raw,
        scannerProfile: 'camera-gs1-v1',
      });
      if (!r.ok) throw Error(r.code);
      const incomingId = randomUUID();
      codes.set(cis, {
        cis,
        status: 'INTRODUCED',
        statusEx: 'EMPTY',
        ownerInn: inn,
        observedAt: new Date().toISOString(),
      });
      documents.set(incomingId, {
        id: incomingId,
        type: 'UNIVERSAL_TRANSFER_DOCUMENT',
        status: 'CHECKED_OK',
        senderInn: supplier,
        receiverInn: inn,
        body: {
          products: [{ code: cis, codeType: 'EXEMPLARY' }],
          productsTotal: 1,
        },
      });
      await command('supply', {
        unitIds: [r.unit.id],
        documentNumber: 'UPD',
        documentDate: '2026-11-06',
        supplierInn: supplier,
        evidenceReference: incomingId,
      });
      await drain();
      return { unitId: r.unit.id, variantId: r.unit.variantId, cis, raw };
    }
    async function shipment(f: Awaited<ReturnType<typeof fixture>>) {
      const r = await command('create', {
        externalOrderId: randomUUID(),
        externalAccountId: 'account',
        parcelCode: randomUUID(),
        warehouseId,
        providerStatus: 'ready_to_ship',
        providerUpdatedAt: new Date().toISOString(),
        availableActions: ['setMarkings'],
        items: [
          {
            externalLineKey: '123',
            variantId: f.variantId,
            quantity: 1,
            unitPriceKopecks: 250000,
          },
        ],
      });
      return (r.result as { shipmentId: string }).shipmentId;
    }
    beforeAll(async () => {
      await db.db
        .insert(users)
        .values({ id: actor.id, telegramId: randomUUID() });
      warehouseId = (
        await db.db.execute<{ id: string }>(
          sql`SELECT id FROM warehouses WHERE code='MAIN'`,
        )
      ).rows[0]!.id;
      await command('configure', {
        warehouseId,
        sellerInn: inn,
        fiasId: randomUUID(),
        address: 'Склад',
        fiscalEvidenceReference: 'contract:verified',
      });
      const days = [];
      for (let i = -1; i < 40; i++) {
        const d = new Date();
        d.setUTCDate(d.getUTCDate() + i);
        days.push({
          date: d.toISOString().slice(0, 10),
          working: ![0, 6].includes(d.getUTCDay()),
        });
      }
      await command('calendar', { days });
    });
    afterAll(() => db.pool.end());
    it('checks real provider-shaped evidence, reserves, packs, signs, dispatches and returns the same unit', async () => {
      const f = await fixture(),
        id = await shipment(f);
      await command('pack', {
        shipmentId: id,
        raw: f.raw,
        scannerProfile: 'camera-gs1-v1',
      });
      await drain();
      await command('prepare', { shipmentId: id });
      await drain();
      expect((await pipeline.read(actor, 'shipment', id)).data).toMatchObject({
        status: 'READY',
      });
      const exported = (
        await pipeline.read(
          actor,
          'export',
          (
            await db.db.execute<{ id: string }>(
              sql`SELECT d.id FROM chz_documents d JOIN chz_document_items di ON di.document_id=d.id JOIN chz_operations co ON co.id=di.chz_operation_id WHERE co.shipment_id=${id} LIMIT 1`,
            )
          ).rows[0]!.id,
        )
      ).data as Record<string, unknown>;
      expect(exported).toMatchObject({
        legalCompleted: true,
        verificationSource: 'WINDOWS_CRYPTOPRO',
      });
      expect(exported.providerReceiptBase64).toBeTypeOf('string');
      await command('handover', {
        shipmentId: id,
        occurredAt: new Date().toISOString(),
        evidenceReference: 'carrier:1',
        occurredOutsideApp: false,
      });
      await command('return', {
        shipmentId: id,
        raw: f.raw,
        scannerProfile: 'camera-gs1-v1',
        kind: 'UNCLAIMED',
        condition: 'GOOD',
        paid: false,
        occurredAt: new Date().toISOString(),
        evidenceReference: 'carrier:return',
        note: 'Целый товар',
      });
      await drain();
      expect((await pipeline.read(actor, 'unit', f.unitId)).data).toMatchObject(
        { current_state: 'AVAILABLE', legal_state: 'IN_CIRCULATION' },
      );
      const next = await shipment(f);
      expect(next).not.toBe(id);
    });
    it('keeps snapshot and idempotency through repeated packing requests', async () => {
      const f = await fixture(),
        id = await shipment(f),
        input = {
          requestId: randomUUID(),
          shipmentId: id,
          raw: f.raw,
          scannerProfile: 'camera-gs1-v1',
        };
      await pipeline.command(actor, 'pack', input);
      expect(await pipeline.command(actor, 'pack', input)).toMatchObject({
        replayed: true,
      });
      await expect(
        pipeline.command(actor, 'pack', { ...input, raw: f.raw + 'x' }),
      ).rejects.toThrow('IDEMPOTENCY_CONFLICT');
      await drain();
    });
    it('does not reserve a code whose provider owner differs', async () => {
      const f = await fixture();
      codes.set(f.cis, { ...codes.get(f.cis)!, ownerInn: '999999999999' });
      await command('check', { unitId: f.unitId });
      await drain();
      await expect(shipment(f)).rejects.toThrow('INSUFFICIENT_LEGAL_STOCK');
    });
    it('cancels an unsigned preparation without external legal compensation', async () => {
      const f = await fixture(),
        id = await shipment(f);
      await command('pack', {
        shipmentId: id,
        raw: f.raw,
        scannerProfile: 'camera-gs1-v1',
      });
      await drain();
      await command('prepare', { shipmentId: id });
      const before = legal.submit.mock.calls.length;
      await command('cancel', {
        shipmentId: id,
        reason: 'Заказ отменён до передачи',
        physicalPresenceConfirmed: true,
      });
      await drain();
      expect(legal.submit.mock.calls.length).toBe(before);
      expect((await pipeline.read(actor, 'unit', f.unitId)).data).toMatchObject(
        {
          current_state: 'AVAILABLE',
          legal_state: 'IN_CIRCULATION',
          pending: false,
        },
      );
    });
    it('refreshes incoming evidence automatically and does not enqueue duplicate checks', async () => {
      const f = await fixture();
      await db.db.execute(
        sql`UPDATE marking_supply_evidence SET verified_at=NULL WHERE unit_id=${f.unitId}`,
      );
      await pipeline.reconcile();
      await pipeline.reconcile();
      const checks = await db.db.execute<{ n: number }>(
        sql`SELECT count(*)::int AS n FROM integration_operations WHERE aggregate_id=${f.unitId} AND operation_type='pipeline.check' AND status='PENDING'`,
      );
      expect(checks.rows[0]!.n).toBe(1);
      await drain();
      expect((await pipeline.read(actor, 'unit', f.unitId)).data).toMatchObject(
        { received_legally: true },
      );
    });
    it('retires the failed attempt and clears its exception after an explicit retry succeeds', async () => {
      const f = await fixture();
      legal.check.mockRejectedValueOnce(
        new ProviderError('CHZ_CODE_RESPONSE_INCOMPLETE'),
      );
      await command('check', { unitId: f.unitId });
      await drain();
      await pipeline.reconcile();
      const job = (
        await db.db.execute<{ id: string }>(
          sql`SELECT id FROM integration_operations WHERE aggregate_id=${f.unitId} AND status='MANUAL_ATTENTION' ORDER BY created_at DESC LIMIT 1`,
        )
      ).rows[0]!;
      await command('retry', {
        operationId: job.id,
        reason: 'Доступ восстановлен',
      });
      await drain();
      await pipeline.reconcile();
      expect(
        (
          await db.db.execute(
            sql`SELECT status FROM integration_operations WHERE id=${job.id}`,
          )
        ).rows[0]!.status,
      ).toBe('CANCELLED');
      expect(
        (
          await db.db.execute(
            sql`SELECT id FROM marking_issues WHERE entity_id IN (${job.id},${f.unitId}) AND resolved_at IS NULL`,
          )
        ).rows,
      ).toHaveLength(0);
    });
    it('exposes the actual integrations and has no runtime mode flag', async () => {
      const r = await pipeline.read(actor, 'integrations');
      expect(r).not.toHaveProperty('mode');
      expect(r.data).toMatchObject({
        chz_authorized: false,
        signer_online: false,
        documentsEnabled: false,
      });
    });
  },
);
