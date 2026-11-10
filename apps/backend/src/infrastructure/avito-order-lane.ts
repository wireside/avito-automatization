import type { DatabaseClient } from '@avito/database';
/** One provider order lane across replicas, actions, marking lists and distance-sale submissions.
 * A dedicated PostgreSQL session holds only an advisory lock, never a warehouse transaction.
 */
export function createAvitoOrderLane(database: DatabaseClient) {
  return async (operationId: string, run: () => Promise<void>) => {
    const key = (
      await database.pool.query<{ key: string }>(
        `
    SELECT account_id || ':' || order_id AS key FROM avito_order_actions WHERE id=$1
    UNION ALL
    SELECT c.external_account_id || ':' || o.external_order_id AS key
    FROM integration_operations j
    JOIN shipments s ON s.id::text=j.aggregate_id
    JOIN orders o ON o.id=s.order_id JOIN sales_channels c ON c.id=o.channel_id
    WHERE j.id=$1 AND j.operation_type='pipeline.markings'
    UNION ALL
    SELECT c.external_account_id || ':' || o.external_order_id AS key
    FROM integration_operations j JOIN chz_document_items di ON di.document_id::text=j.aggregate_id
    JOIN chz_operations co ON co.id=di.chz_operation_id AND co.action='WITHDRAW'
    JOIN shipments s ON s.id=co.shipment_id JOIN orders o ON o.id=s.order_id
    JOIN sales_channels c ON c.id=o.channel_id
    WHERE j.id=$1 AND j.operation_type='pipeline.document'
    LIMIT 1`,
        [operationId],
      )
    ).rows[0]?.key;
    if (!key) {
      await run();
      return;
    }
    const client = await database.pool.connect();
    let locked = false,
      broken = false;
    try {
      await client.query("SET lock_timeout='45s'");
      await client.query('SELECT pg_advisory_lock(hashtextextended($1,2))', [
        'avito-order:' + key,
      ]);
      locked = true;
      await run();
    } finally {
      try {
        if (locked)
          await client.query(
            'SELECT pg_advisory_unlock(hashtextextended($1,2))',
            ['avito-order:' + key],
          );
        await client.query('RESET lock_timeout');
      } catch {
        broken = true;
      }
      client.release(broken);
    }
  };
}
