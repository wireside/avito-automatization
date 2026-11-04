import { createLocalSigningStore } from './local-signing.js';
import { randomUUID, createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import {
  createMarkingPipeline,
  createReceiveStock,
  createProcessIntegrationOperation,
  type PipelineAction,
} from '@avito/domain';
import { createDatabaseClient } from './client.js';
import { createInventoryStore } from './inventory.js';
import { createMarkingPipelineStore } from './marking-pipeline.js';
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
const suite = url ? describe : describe.skip;
suite(
  'complete marking pipeline with isolated PostgreSQL and durable simulated providers',
  () => {
    const client = createDatabaseClient(url ?? 'postgresql://unused'),
      ciphertexts = new Map<string, string>(),
      protect = (raw: string, identity: string) => {
        const ciphertext = randomUUID();
        ciphertexts.set(ciphertext, raw);
        return {
          identityHash: createHash('sha256').update(identity).digest('hex'),
          inputFingerprint: createHash('sha256').update(raw).digest('hex'),
          payloadCiphertext: ciphertext,
          encryptionKeyId: 'test',
        };
      },
      store = createMarkingPipelineStore(client.db, {
        encrypt: protect,
        decrypt: (ciphertext) => {
          const value = ciphertexts.get(ciphertext);
          if (!value) throw Error('Unknown ciphertext');
          return value;
        },
      }),
      pipeline = createMarkingPipeline(store, 'simulation'),
      inventory = createInventoryStore(client.db);
    const actor = {
      id: randomUUID(),
      telegramId: 'pipeline-test',
      displayName: null,
      roles: ['OWNER'],
    };
    const command = (action: PipelineAction, data: Record<string, unknown>) =>
      pipeline.command(actor, action, { requestId: randomUUID(), ...data });
    const processor = createProcessIntegrationOperation({
      store: {
        claim: (id) => claimIntegrationOperation(client.db, id),
        complete: (id, attempt) =>
          completeIntegrationOperation(client.db, id, attempt),
        fail: (input) => failIntegrationOperation(client.db, input),
      },
      retryDelay: () => 0,
      execute: (job) => pipeline.execute(job.id),
    });
    const drain = async () => {
      for (let n = 0; n < 12; n++) {
        const ids = await listEnqueueableOperationIds(client.db);
        if (!ids.length) return;
        for (const id of ids) await processor(id);
      }
      throw Error('queue did not settle');
    };
    const query = async (text: string) =>
      (await client.db.execute(sql.raw(text))).rows;
    let warehouseId = '';
    let counter = 0;
    const sellerInn = '123456789012',
      fiasId = randomUUID();
    const receive = createReceiveStock({
      receive: (command) => inventory.receive(command),
      needsCatalogLookup: (g) => inventory.needsCatalogLookup(g),
      lookupCatalog: (g) =>
        Promise.resolve({
          status: 'FOUND',
          product: {
            gtin: g,
            name: 'Брюки pipeline',
            sourceName: 'Брюки pipeline',
            article: null,
            color: null,
            size: null,
            sizeSystem: null,
            materialComposition: null,
            sourceReference: 'mock:' + g,
            observedAt: new Date().toISOString(),
            attributes: [],
          },
        }),
      protectMarking: protect,
    });
    async function fixture(outcome = 'SUCCESS') {
      const prefix = '04660430' + String(10000 + counter++).padStart(5, '0');
      const sum = [...prefix].reduce(
        (v, c, i) => v + Number(c) * (i % 2 === 0 ? 3 : 1),
        0,
      );
      const gtin = prefix + String((10 - (sum % 10)) % 10);
      const raw = `01${gtin}21TEST000000001\u001d91ABCD\u001d92${'A'.repeat(44)}`;
      const result = await receive(actor, {
        requestId: randomUUID(),
        raw,
        scannerProfile: 'camera-gs1-v1',
      });
      expect(result.ok).toBe(true);
      if (!result.ok) throw Error(result.code);
      warehouseId = String(
        (await query("SELECT id FROM warehouses WHERE code='MAIN'"))[0]!.id,
      );
      await command('configure', {
        warehouseId,
        sellerInn,
        fiasId,
        address: 'Тестовый склад',
        fiscalEvidenceReference: 'simulation:contract',
      });
      await command('simulate', {
        unitId: result.unit.id,
        state: 'INTRODUCED',
        ownerInn: sellerInn,
        outcome,
      });
      await command('supply', {
        unitIds: [result.unit.id],
        documentNumber: 'УПД-' + counter,
        documentDate: new Date().toISOString().slice(0, 10),
        supplierInn: '1234567890',
        evidenceReference: 'simulation:edo:' + counter,
      });
      await drain();
      return { unitId: result.unit.id, variantId: result.unit.variantId, raw };
    }
    async function create(f: Awaited<ReturnType<typeof fixture>>) {
      const r = await command('create', {
        externalOrderId: randomUUID(),
        externalAccountId: 'test',
        parcelCode: randomUUID(),
        warehouseId,
        items: [
          {
            externalLineKey: 'line',
            variantId: f.variantId,
            quantity: 1,
            unitPriceKopecks: 250000,
          },
        ],
      });
      return (r.result as Record<string, string>).shipmentId!;
    }
    const pack = async (shipmentId: string, raw: string) => {
      await command('pack', {
        shipmentId,
        raw,
        scannerProfile: 'camera-gs1-v1',
      });
      await drain();
    };
    beforeAll(async () => {
      await client.db
        .insert(users)
        .values({ id: actor.id, telegramId: randomUUID() });
      const days = [];
      for (let i = -30; i < 80; i++) {
        const d = new Date();
        d.setUTCDate(d.getUTCDate() + i);
        days.push({
          date: d.toISOString().slice(0, 10),
          working: ![0, 6].includes(d.getUTCDay()),
        });
      }
      await command('calendar', { days });
    });
    afterAll(() => client.pool.end());
    it('receipt → legal verification → reserve → scan → Avito acceptance → withdrawal → handover → delivery → return → resale', async () => {
      const f = await fixture();
      const shipmentId = await create(f);
      const input = {
        requestId: randomUUID(),
        shipmentId,
        raw: f.raw,
        scannerProfile: 'camera-gs1-v1',
      };
      const first = await pipeline.command(actor, 'pack', input);
      expect(first.replayed).toBe(false);
      expect((await pipeline.command(actor, 'pack', input)).replayed).toBe(
        true,
      );
      await expect(
        pipeline.command(actor, 'pack', { ...input, raw: f.raw + 'x' }),
      ).rejects.toThrow('IDEMPOTENCY_CONFLICT');
      await drain();
      await command('prepare', { shipmentId });
      await expect(
        command('handover', {
          shipmentId,
          occurredAt: new Date().toISOString(),
          evidenceReference: 'carrier',
          occurredOutsideApp: false,
        }),
      ).rejects.toThrow('LEGAL_NOT_READY');
      await drain();
      expect(
        (
          await query(`SELECT status FROM shipments WHERE id='${shipmentId}'`)
        )[0]!.status,
      ).toBe('READY');
      await command('handover', {
        shipmentId,
        occurredAt: new Date().toISOString(),
        evidenceReference: 'carrier',
        occurredOutsideApp: false,
      });
      await command('deliver', {
        shipmentId,
        occurredAt: new Date().toISOString(),
        evidenceReference: 'carrier:delivered',
      });
      await command('return', {
        shipmentId,
        raw: f.raw,
        scannerProfile: 'camera-gs1-v1',
        kind: 'CUSTOMER',
        paid: true,
        primaryDocument: {
          number: '1',
          date: new Date().toISOString().slice(0, 10),
          name: 'Акт возврата',
        },
        condition: 'GOOD',
        occurredAt: new Date().toISOString(),
        evidenceReference: 'return:act',
        note: 'Целый товар',
      });
      await drain();
      expect(
        (
          await query(
            `SELECT current_state FROM product_units WHERE id='${f.unitId}'`,
          )
        )[0]!.current_state,
      ).toBe('AVAILABLE');
      const withdrawal = (
        await query(
          `SELECT di.document_id FROM chz_document_items di JOIN chz_operations co ON co.id=di.chz_operation_id WHERE co.shipment_id='${shipmentId}' AND co.action='WITHDRAW'`,
        )
      )[0]!.document_id;
      const exported = await pipeline.read(actor, 'export', String(withdrawal));
      const packageData = exported.data as Record<string, unknown>;
      expect(packageData).toMatchObject({
        documentType: 'LK_RECEIPT',
        legalCompleted: false,
        signingStatus: 'VERIFIED',
        verificationSource: 'SIMULATION',
      });
      expect(
        createHash('sha256')
          .update(Buffer.from(String(packageData.payloadBase64), 'base64'))
          .digest('hex'),
      ).toBe(packageData.payloadHash);
      await expect(
        pipeline.read(
          { ...actor, roles: ['WAREHOUSE'] },
          'export',
          String(withdrawal),
        ),
      ).rejects.toThrow('FORBIDDEN');
      expect(
        (
          await createMarkingPipeline(store, 'disabled').read(
            actor,
            'documents',
          )
        ).simulated,
      ).toBe(true);
      const resale = await create(f);
      await pack(resale, f.raw);
      await command('prepare', { shipmentId: resale });
      await drain();
      expect(
        (
          await query(
            `SELECT count(*)::int AS n FROM chz_operations co JOIN unit_markings m ON m.id=co.marking_id WHERE m.unit_id='${f.unitId}' AND action='WITHDRAW'`,
          )
        )[0]!.n,
      ).toBe(2);
      expect(
        (
          await query(
            `SELECT count(*)::int AS n FROM inventory_movements WHERE unit_id='${f.unitId}' AND from_state='NOT_RECEIVED'`,
          )
        )[0]!.n,
      ).toBe(1);
    });
    it('cancellation after withdrawal compensates and releases only after legal verification', async () => {
      const f = await fixture(),
        shipmentId = await create(f);
      await pack(shipmentId, f.raw);
      await command('prepare', { shipmentId });
      await drain();
      await command('cancel', {
        shipmentId,
        reason: 'Покупатель отменил',
        physicalPresenceConfirmed: true,
      });
      expect(
        (
          await query(
            `SELECT current_state FROM product_units WHERE id='${f.unitId}'`,
          )
        )[0]!.current_state,
      ).toBe('QUARANTINE');
      await drain();
      expect(
        (
          await query(
            `SELECT current_state FROM product_units WHERE id='${f.unitId}'`,
          )
        )[0]!.current_state,
      ).toBe('AVAILABLE');
    });
    it('ambiguous provider results are reconciled with the same document and never duplicated', async () => {
      const f = await fixture('AMBIGUOUS'),
        shipmentId = await create(f);
      await pack(shipmentId, f.raw);
      await command('prepare', { shipmentId });
      await drain();
      expect(
        (
          await query(`SELECT status FROM shipments WHERE id='${shipmentId}'`)
        )[0]!.status,
      ).toBe('READY');
      expect(
        (
          await query(
            `SELECT count(*)::int AS n FROM chz_documents d JOIN chz_document_items di ON di.document_id=d.id JOIN chz_operations co ON co.id=di.chz_operation_id WHERE co.shipment_id='${shipmentId}'`,
          )
        )[0]!.n,
      ).toBe(1);
    });
    it('rejects owner mismatch and competing reservations without a partial order', async () => {
      const f = await fixture();
      await command('simulate', {
        unitId: f.unitId,
        state: 'INTRODUCED',
        ownerInn: '999999999999',
        outcome: 'SUCCESS',
      });
      await command('check', { unitId: f.unitId });
      await drain();
      await expect(create(f)).rejects.toThrow('INSUFFICIENT_LEGAL_STOCK');
      const good = await fixture();
      const results = await Promise.allSettled([create(good), create(good)]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    });
    it('retains a rejected document and blocks carrier handover', async () => {
      const f = await fixture('REJECTED'),
        shipmentId = await create(f);
      await pack(shipmentId, f.raw);
      await command('prepare', { shipmentId });
      await drain();
      expect(
        (
          await query(`SELECT status FROM shipments WHERE id='${shipmentId}'`)
        )[0]!.status,
      ).toBe('PACKED');
      await expect(
        command('handover', {
          shipmentId,
          occurredAt: new Date().toISOString(),
          evidenceReference: 'carrier',
          occurredOutsideApp: false,
        }),
      ).rejects.toThrow('LEGAL_NOT_READY');
      expect((await pipeline.read(actor, 'issues')).data).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: 'DOCUMENT_REJECTED' }),
        ]),
      );
      const doc = (
        await query(
          `SELECT document_id FROM chz_document_items di JOIN chz_operations co ON co.id=di.chz_operation_id WHERE co.shipment_id='${shipmentId}'`,
        )
      )[0]!.document_id;
      await command('simulate', {
        unitId: f.unitId,
        state: 'INTRODUCED',
        ownerInn: sellerInn,
        outcome: 'SUCCESS',
      });
      await drain();
      await command('correctDocument', {
        documentId: doc,
        reason: 'Исправлены исходные данные',
      });
      await drain();
      expect(
        (
          await query(`SELECT status FROM shipments WHERE id='${shipmentId}'`)
        )[0]!.status,
      ).toBe('READY');
    });
    it('records real handover outside app and raises urgent legal task rather than inventing stock', async () => {
      const f = await fixture(),
        shipmentId = await create(f);
      await pack(shipmentId, f.raw);
      await command('handover', {
        shipmentId,
        occurredAt: new Date().toISOString(),
        evidenceReference: 'carrier:late-record',
        occurredOutsideApp: true,
      });
      await drain();
      expect(
        (
          await query(
            `SELECT current_state FROM product_units WHERE id='${f.unitId}'`,
          )
        )[0]!.current_state,
      ).toBe('IN_TRANSIT');
      await expect(
        command('cancel', {
          shipmentId,
          reason: 'Поздняя отмена',
          physicalPresenceConfirmed: true,
        }),
      ).rejects.toThrow('USE_RETURN_WORKFLOW');
    });
    it('corrects only rejected items in a partially accepted batch', async () => {
      const good = await fixture(),
        bad = await fixture('REJECTED');
      const created = await command('create', {
        externalOrderId: randomUUID(),
        externalAccountId: 'test',
        parcelCode: randomUUID(),
        warehouseId,
        items: [
          {
            externalLineKey: 'a',
            variantId: good.variantId,
            quantity: 1,
            unitPriceKopecks: 250000,
          },
          {
            externalLineKey: 'b',
            variantId: bad.variantId,
            quantity: 1,
            unitPriceKopecks: 300000,
          },
        ],
      });
      const shipmentId = (created.result as Record<string, string>).shipmentId!;
      await pack(shipmentId, good.raw);
      await pack(shipmentId, bad.raw);
      const prepared = await command('prepare', { shipmentId });
      await drain();
      expect(
        (
          await query(
            `SELECT count(*)::int AS n FROM chz_operations WHERE shipment_id='${shipmentId}' AND status='CONFIRMED'`,
          )
        )[0]!.n,
      ).toBe(1);
      await command('simulate', {
        unitId: bad.unitId,
        state: 'INTRODUCED',
        ownerInn: sellerInn,
        outcome: 'SUCCESS',
      });
      await drain();
      await command('correctDocument', {
        documentId: (prepared.result as Record<string, string>).documentId,
        reason: 'Данные исправлены',
      });
      await drain();
      expect(
        (
          await query(`SELECT status FROM shipments WHERE id='${shipmentId}'`)
        )[0]!.status,
      ).toBe('READY');
      expect(
        (
          await query(
            `SELECT count(*)::int AS n FROM chz_document_items di JOIN chz_operations co ON co.id=di.chz_operation_id JOIN unit_markings m ON m.id=co.marking_id WHERE m.unit_id='${good.unitId}'`,
          )
        )[0]!.n,
      ).toBe(1);
      expect(
        (
          await query(
            `SELECT count(*)::int AS n FROM chz_document_items di JOIN chz_operations co ON co.id=di.chz_operation_id JOIN unit_markings m ON m.id=co.marking_id WHERE m.unit_id='${bad.unitId}'`,
          )
        )[0]!.n,
      ).toBe(2);
    });
    it('disposal creates a physical movement and a distinct legal reason', async () => {
      const f = await fixture();
      await command('dispose', {
        unitId: f.unitId,
        reason: 'DESTRUCTION',
        primaryDocument: {
          number: '1',
          date: new Date().toISOString().slice(0, 10),
          name: 'Акт уничтожения',
        },
        occurredAt: new Date().toISOString(),
        evidenceReference: 'act:destruction',
        confirmation: 'CONFIRM_IRREVERSIBLE',
      });
      await drain();
      expect(
        (
          await query(
            `SELECT current_state FROM product_units WHERE id='${f.unitId}'`,
          )
        )[0]!.current_state,
      ).toBe('DISPOSED');
      await expect(
        command('dispose', {
          unitId: f.unitId,
          reason: 'DESTRUCTION',
          primaryDocument: {
            number: '1',
            date: new Date().toISOString().slice(0, 10),
            name: 'Акт уничтожения',
          },
          occurredAt: new Date().toISOString(),
          evidenceReference: 'act:2',
          confirmation: 'CONFIRM_IRREVERSIBLE',
        }),
      ).rejects.toThrow('INVALID_TRANSITION');
    });
    it('leases exact document bytes and keeps received signatures unverified', async () => {
      const f = await fixture(),
        shipmentId = await create(f);
      await pack(shipmentId, f.raw);
      const prepared = await command('prepare', { shipmentId });
      const docId = (prepared.result as Record<string, string>).documentId!;
      const job = (
        await query(
          `SELECT id FROM integration_operations WHERE operation_type='pipeline.document' AND aggregate_id='${docId}'`,
        )
      )[0]!.id;
      await processor(String(job));
      const signing = createLocalSigningStore(client.db, {
        encrypt: protect,
        decrypt: (ciphertext) => {
          const value = ciphertexts.get(ciphertext);
          if (!value) throw Error('Unknown ciphertext');
          return value;
        },
      });
      expect(
        await signing.claim({
          signerId: 'local-test',
          acceptSimulation: false,
        }),
      ).toBeNull();
      const lease = await signing.claim({
        signerId: 'local-test',
        acceptSimulation: true,
      });
      expect(lease?.documentId).toBe(docId);
      if (!lease) throw Error('No task');
      expect(
        createHash('sha256')
          .update(Buffer.from(lease.payloadBase64, 'base64'))
          .digest('hex'),
      ).toBe(lease.payloadHash);
      const input = {
        taskId: lease.taskId,
        leaseId: lease.leaseId,
        signerId: 'local-test',
        payloadHash: lease.payloadHash,
        signatureBase64: Buffer.from('placeholder-not-a-real-CMS').toString(
          'base64',
        ),
        certificateBase64: Buffer.from('placeholder-not-a-real-cert').toString(
          'base64',
        ),
      };
      await expect(
        signing.receive({ ...input, payloadHash: '0'.repeat(64) }),
      ).rejects.toThrow('SIGNATURE_PAYLOAD_MISMATCH');
      await expect(
        signing.receive({ ...input, leaseId: randomUUID() }),
      ).rejects.toThrow('SIGNER_LEASE_MISMATCH');
      expect(await signing.receive(input)).toMatchObject({
        state: 'RECEIVED',
        verified: false,
        replayed: false,
      });
      expect(await signing.receive(input)).toMatchObject({
        state: 'RECEIVED',
        verified: false,
        replayed: true,
      });
      await expect(
        signing.receive({ ...input, signatureBase64: 'different' }),
      ).rejects.toThrow('IDEMPOTENCY_CONFLICT');
      expect(
        (
          await query(`SELECT status FROM chz_documents WHERE id='${docId}'`)
        )[0]!.status,
      ).toBe('WAITING_SIGNATURE');
      expect(
        await query(
          `SELECT * FROM marking_simulation_documents WHERE document_id='${docId}'`,
        ),
      ).toHaveLength(0);
    });
  },
);
