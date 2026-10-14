-- ───────────────────────────────────────────────────── status-clarity ratings
-- Secondary evaluation metric from the proposal: donors and recipients rate,
-- on a 1–5 scale, how clear the status timeline was for a donation.
-- One rating per person per donation; re-submitting replaces the earlier one.

CREATE TABLE status_ratings (
    rating_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    donation_id UUID NOT NULL REFERENCES donations (donation_id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
    role        TEXT NOT NULL CHECK (role IN ('DONOR', 'RECIPIENT')),
    rating      SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
    comment     TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (donation_id, user_id)
);

CREATE INDEX idx_status_ratings_role ON status_ratings (role);
