-- FoodBridge — initial schema
--
-- Derived from the columns the backend's repositories actually SELECT, INSERT
-- and UPDATE, and cross-checked against the project's UML class diagram. The
-- backend is the authority here: every table and column name below appears
-- verbatim in backend/src/repositories/*.ts, so the two cannot drift apart
-- silently.
--
-- Applied by backend/src/db/migrate.ts, which runs migrations/*.sql in
-- filename order inside a transaction each.

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid() on PostgreSQL < 13

-- ─────────────────────────────────────────────────── controlled vocabularies
-- These mirror backend/src/domain/enums.ts exactly. Note the deliberate
-- absence of an ACCEPTED donation status: acceptance is a property of a match,
-- not of a donation.
--
-- They are TEXT with a CHECK rather than PostgreSQL enum types. A CHECK admits
-- exactly the same set of values, but an enum column forces every parameter to
-- be cast at the call site, and the application predates this schema: it passes
-- these as plain strings and sometimes compares the same parameter to a string
-- literal before assigning it, which pins its inferred type to text. A CHECK
-- gives the same guarantee without requiring the application to change.

-- ───────────────────────────────────────────────────────────────── users
-- A donor's or an organisation's account. Latitude and longitude are plain
-- columns here rather than a geography point: the backend reads them straight
-- back with SELECT *, and only donations and organisations are ever queried
-- spatially.

CREATE TABLE users (
    user_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name          TEXT NOT NULL,
    email         TEXT NOT NULL UNIQUE,
    phone         TEXT,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL CHECK (role IN ('DONOR', 'RECIPIENT', 'ADMIN')),
    address       TEXT,
    latitude      DOUBLE PRECISION,
    longitude     DOUBLE PRECISION,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_users_role ON users (role);

-- ──────────────────────────────────────────────────────────────── donors
-- One row per DONOR user. The primary key is the user id, so a donor profile
-- cannot exist without its account.

CREATE TABLE donors (
    donor_id            UUID PRIMARY KEY REFERENCES users (user_id) ON DELETE CASCADE,
    donor_type          TEXT NOT NULL,
    total_meals_donated INTEGER NOT NULL DEFAULT 0,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────── recipient organisations
-- assigned_servings is capacity already committed to accepted matches; the
-- matching engine subtracts it from serving_capacity to get availability.

CREATE TABLE recipient_organizations (
    recipient_id         UUID PRIMARY KEY REFERENCES users (user_id) ON DELETE CASCADE,
    organization_type    TEXT NOT NULL,
    serving_capacity     INTEGER NOT NULL CHECK (serving_capacity >= 0),
    assigned_servings    INTEGER NOT NULL DEFAULT 0 CHECK (assigned_servings >= 0),
    service_radius_km    DOUBLE PRECISION NOT NULL DEFAULT 10.0,
    food_preferences     TEXT[] NOT NULL DEFAULT '{}',
    dietary_restrictions TEXT[] NOT NULL DEFAULT '{}',
    active               BOOLEAN NOT NULL DEFAULT TRUE,
    location             GEOGRAPHY(Point, 4326),
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Candidate retrieval runs ST_DWithin against every active organisation, so
-- this index is what keeps matching from degrading as organisations are added.
CREATE INDEX idx_recipients_location ON recipient_organizations USING GIST (location);
CREATE INDEX idx_recipients_active   ON recipient_organizations (active) WHERE active;

-- ───────────────────────────────────────────────────────────── donations
-- Every donation begins at PENDING_REVIEW: an administrator approves it before
-- it can be matched. The timestamps are the sole basis for time-to-match, so
-- they are written by the database and never supplied by a client.

CREATE TABLE donations (
    donation_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    donor_id          UUID NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
    food_type         TEXT NOT NULL,
    description       TEXT,
    quantity_servings INTEGER NOT NULL CHECK (quantity_servings > 0),
    pickup_address    TEXT,
    pickup_location   GEOGRAPHY(Point, 4326) NOT NULL,
    submitted_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    posted_at         TIMESTAMPTZ,
    matched_at        TIMESTAMPTZ,
    pickup_start      TIMESTAMPTZ,
    pickup_end        TIMESTAMPTZ,
    expires_at        TIMESTAMPTZ NOT NULL,
    status            TEXT NOT NULL DEFAULT 'PENDING_REVIEW'
        CHECK (status IN ('PENDING_REVIEW', 'POSTED', 'REJECTED', 'MATCHED',
                          'PICKED_UP', 'COMPLETED', 'CANCELLED', 'EXPIRED')),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_donations_location ON donations USING GIST (pickup_location);
CREATE INDEX idx_donations_status   ON donations (status);
CREATE INDEX idx_donations_donor    ON donations (donor_id, submitted_at DESC);
CREATE INDEX idx_donations_expiry   ON donations (expires_at) WHERE status IN ('POSTED', 'MATCHED');

-- ─────────────────────────────────────────────────────────────── matches
-- One offer of one donation to one organisation. The four score components are
-- stored alongside the total so any allocation can be explained after the fact,
-- which the project proposal requires. expires_at is the response window.

CREATE TABLE matches (
    match_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    donation_id      UUID NOT NULL REFERENCES donations (donation_id) ON DELETE CASCADE,
    recipient_id     UUID NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
    score            DOUBLE PRECISION,
    distance_km      DOUBLE PRECISION,
    urgency_score    DOUBLE PRECISION,
    proximity_score  DOUBLE PRECISION,
    capacity_score   DOUBLE PRECISION,
    status           TEXT NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'ACCEPTED', 'REJECTED', 'EXPIRED')),
    search_radius_km DOUBLE PRECISION,
    expires_at       TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    responded_at     TIMESTAMPTZ
);

CREATE INDEX idx_matches_donation  ON matches (donation_id);
CREATE INDEX idx_matches_recipient ON matches (recipient_id, created_at DESC);
CREATE INDEX idx_matches_pending   ON matches (status, expires_at) WHERE status = 'PENDING';

-- Deliberately NOT unique on (donation_id, recipient_id): when an offer expires
-- unanswered the donation is requeued and may be offered to the same
-- organisation again. Only organisations that actively rejected it are excluded
-- from the next cycle, and that exclusion is applied by the matching service.

-- ─────────────────────────────────────────────────────────────── pickups
-- Created when an organisation accepts. Its lifecycle is separate from the
-- donation's so the handover has its own record and timestamps.

CREATE TABLE pickups (
    pickup_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    match_id        UUID NOT NULL UNIQUE REFERENCES matches (match_id) ON DELETE CASCADE,
    scheduled_at    TIMESTAMPTZ NOT NULL,
    contact_details TEXT,
    status          TEXT NOT NULL DEFAULT 'SCHEDULED'
        CHECK (status IN ('SCHEDULED', 'PICKED_UP', 'COMPLETED', 'CANCELLED')),
    picked_up_at    TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_pickups_status ON pickups (status);

-- ────────────────────────────────────────────────────── donation reviews
-- The administrator's decision on a donation. Kept as its own table rather
-- than a column so the audit trail survives a re-review.

CREATE TABLE donation_reviews (
    review_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    donation_id UUID NOT NULL REFERENCES donations (donation_id) ON DELETE CASCADE,
    admin_id    UUID NOT NULL REFERENCES users (user_id) ON DELETE RESTRICT,
    decision    TEXT NOT NULL CHECK (decision IN ('PENDING', 'APPROVED', 'REJECTED')),
    remarks     TEXT,
    reviewed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_reviews_donation ON donation_reviews (donation_id, reviewed_at ASC);

-- ───────────────────────────────────────────────────────── notifications

CREATE TABLE notifications (
    notification_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
    type            TEXT NOT NULL,
    message         TEXT NOT NULL,
    sent_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    read            BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX idx_notifications_user   ON notifications (user_id, sent_at DESC);
CREATE INDEX idx_notifications_unread ON notifications (user_id) WHERE NOT read;

-- ────────────────────────────────────────────────────── matching waitlist
-- Donations that found no eligible organisation. They are never dropped: the
-- radius is widened and they are retried on the next cycle.

CREATE TABLE matching_waitlist (
    waitlist_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    donation_id         UUID NOT NULL UNIQUE REFERENCES donations (donation_id) ON DELETE CASCADE,
    reason              TEXT NOT NULL,
    max_radius_tried_km DOUBLE PRECISION NOT NULL,
    attempts            INTEGER NOT NULL DEFAULT 1,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_attempt_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────────────── geocoding cache
-- The proposal commits to caching geocoding results so repeated addresses cost
-- no external calls, which also keeps the pilot inside a provider's free tier.

CREATE TABLE geocoding_cache (
    address    TEXT PRIMARY KEY,
    latitude   DOUBLE PRECISION NOT NULL,
    longitude  DOUBLE PRECISION NOT NULL,
    provider   TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
