import { sql } from 'drizzle-orm';
import { legalObservationMaxAgeMs } from '@avito/domain';

// Read the latest actual observation for the active unit marking (alias m).
export const latestTrueApiMarking = sql`
  LEFT JOIN LATERAL (
    SELECT state, ownership_verified, observed_at
    FROM unit_marking_events
    WHERE marking_id = m.id AND source = 'TRUE_API'
    ORDER BY observed_at DESC, id DESC LIMIT 1
  ) ms ON true
`;

// Free stock excludes items whose code is withdrawn or yet to be checked.
export const freeStock = sql`
  av.is_eligible AND av.reservation_id IS NULL AND ms.state = 'IN_CIRCULATION'
`;

// Shared by the inventory preview and the transactional reservation.
export const readyToCollect = sql`
  ${freeStock}
  AND ms.ownership_verified = 'VERIFIED'
  AND ms.observed_at > statement_timestamp() - ${legalObservationMaxAgeMs} * interval '1 millisecond'
  AND ms.observed_at <= statement_timestamp()
`;
