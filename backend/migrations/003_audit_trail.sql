-- ─────────────────────────────────────────────────────────── audit trail
-- SRS NFR-19: every state transition is persisted with its timestamp and its
-- actor. A trigger on each lifecycle table records the change, so no code path
-- can forget to log it. The acting user is read from the transaction-local
-- setting foodbridge.actor_id (set by the API); NULL means the system acted
-- (scheduled expiry, an automatic re-match).

CREATE TABLE status_events (
    event_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_type TEXT NOT NULL CHECK (entity_type IN ('DONATION', 'MATCH', 'PICKUP')),
    entity_id   UUID NOT NULL,
    from_status TEXT,                      -- NULL on creation
    to_status   TEXT NOT NULL,
    actor_id    UUID REFERENCES users (user_id) ON DELETE SET NULL,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX idx_status_events_entity ON status_events (entity_type, entity_id, occurred_at);

CREATE OR REPLACE FUNCTION fb_log_status_change() RETURNS trigger AS $$
DECLARE
  actor TEXT := NULLIF(current_setting('foodbridge.actor_id', true), '');
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NULL;
  END IF;
  INSERT INTO status_events (entity_type, entity_id, from_status, to_status, actor_id)
  VALUES (
    TG_ARGV[0],
    (to_jsonb(NEW) ->> TG_ARGV[1])::uuid,
    CASE WHEN TG_OP = 'UPDATE' THEN OLD.status END,
    NEW.status,
    actor::uuid
  );
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_donations_status AFTER INSERT OR UPDATE OF status ON donations
  FOR EACH ROW EXECUTE FUNCTION fb_log_status_change('DONATION', 'donation_id');
CREATE TRIGGER trg_matches_status AFTER INSERT OR UPDATE OF status ON matches
  FOR EACH ROW EXECUTE FUNCTION fb_log_status_change('MATCH', 'match_id');
CREATE TRIGGER trg_pickups_status AFTER INSERT OR UPDATE OF status ON pickups
  FOR EACH ROW EXECUTE FUNCTION fb_log_status_change('PICKUP', 'pickup_id');

-- ─────────────────────────────────────────────── matching runs + reasons
-- SRS NFR-17: every allocation must be reconstructable afterwards, including
-- why an organisation was excluded. Each cycle is one run; each donation it
-- considered keeps the matcher's per-candidate explanation.

CREATE TABLE matching_runs (
    run_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    strategy     TEXT NOT NULL CHECK (strategy IN ('greedy', 'hungarian')),
    triggered_by UUID REFERENCES users (user_id) ON DELETE SET NULL,  -- NULL = system
    ran_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE match_explanations (
    run_id      UUID NOT NULL REFERENCES matching_runs (run_id) ON DELETE CASCADE,
    donation_id UUID NOT NULL REFERENCES donations (donation_id) ON DELETE CASCADE,
    outcome     TEXT NOT NULL CHECK (outcome IN ('MATCHED', 'WAITLISTED')),
    candidates  JSONB NOT NULL,
    PRIMARY KEY (run_id, donation_id)
);

CREATE INDEX idx_match_explanations_donation ON match_explanations (donation_id);

-- Which strategy produced an offer (SRS FR-48 compares greedy and Hungarian).
ALTER TABLE matches ADD COLUMN strategy TEXT CHECK (strategy IN ('greedy', 'hungarian'));
ALTER TABLE matches ADD COLUMN run_id UUID REFERENCES matching_runs (run_id) ON DELETE SET NULL;
