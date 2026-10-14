import type { Queryable } from '../db/pool';

export interface StatusEventRow {
  event_id: string;
  entity_type: 'DONATION' | 'MATCH' | 'PICKUP';
  entity_id: string;
  from_status: string | null;
  to_status: string;
  actor_id: string | null;   // null = the system (scheduled expiry, automatic re-match)
  actor_name: string | null;
  actor_role: string | null;
  occurred_at: string;
  /** For MATCH and PICKUP events: the organisation the offer was made to. */
  recipient_id: string | null;
}

export interface ExplanationRow {
  run_id: string;
  strategy: 'greedy' | 'hungarian';
  ran_at: string;
  triggered_by: string | null;
  outcome: 'MATCHED' | 'WAITLISTED';
  candidates: unknown;
}

export const auditRepository = {
  /** Every status change of a donation, its offers and their pickups, oldest first (NFR-19). */
  async eventsForDonation(db: Queryable, donationId: string): Promise<StatusEventRow[]> {
    const r = await db.query<StatusEventRow>(
      `WITH m AS (SELECT match_id, recipient_id FROM matches WHERE donation_id = $1),
            p AS (SELECT p.pickup_id, m.recipient_id FROM pickups p JOIN m ON m.match_id = p.match_id)
       SELECT e.event_id, e.entity_type, e.entity_id, e.from_status, e.to_status,
              e.actor_id, u.name AS actor_name, u.role AS actor_role, e.occurred_at,
              COALESCE(m.recipient_id, p.recipient_id) AS recipient_id
         FROM status_events e
         LEFT JOIN users u ON u.user_id = e.actor_id
         LEFT JOIN m ON e.entity_type = 'MATCH'  AND e.entity_id = m.match_id
         LEFT JOIN p ON e.entity_type = 'PICKUP' AND e.entity_id = p.pickup_id
        WHERE (e.entity_type = 'DONATION' AND e.entity_id = $1)
           OR m.match_id IS NOT NULL OR p.pickup_id IS NOT NULL
        ORDER BY e.occurred_at, e.event_id`,
      [donationId],
    );
    return r.rows;
  },

  /** The matcher's stored reasoning for a donation, newest run first (NFR-17). */
  async explanationsForDonation(db: Queryable, donationId: string): Promise<ExplanationRow[]> {
    const r = await db.query<ExplanationRow>(
      `SELECT x.run_id, run.strategy, run.ran_at, run.triggered_by, x.outcome, x.candidates
         FROM match_explanations x
         JOIN matching_runs run ON run.run_id = x.run_id
        WHERE x.donation_id = $1
        ORDER BY run.ran_at DESC`,
      [donationId],
    );
    return r.rows;
  },
};
