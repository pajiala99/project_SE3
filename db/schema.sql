-- Enable spatial extension
CREATE EXTENSION IF NOT EXISTS postgis;

-- ============ USERS & ROLES ============
CREATE TYPE user_role AS ENUM ('DONOR', 'RECIPIENT', 'ADMIN');

CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role user_role NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

-- ============ DONORS ============
CREATE TABLE donors (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    donor_type VARCHAR(50),
    default_location GEOGRAPHY(Point, 4326),
    created_at TIMESTAMP DEFAULT NOW()
);

-- ============ RECIPIENT ORGANIZATIONS ============
CREATE TYPE verification_status AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

CREATE TABLE recipients (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    org_name VARCHAR(255) NOT NULL,
    service_location GEOGRAPHY(Point, 4326) NOT NULL,
    service_radius_km NUMERIC(6,2) DEFAULT 5.0,
    capacity_servings INTEGER NOT NULL,
    food_preferences TEXT[],
    dietary_restrictions TEXT[],
    verification_status verification_status DEFAULT 'PENDING',
    trust_score NUMERIC(4,2) DEFAULT 50.0,
    verified_at TIMESTAMP,
    verified_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP DEFAULT NOW()
);

-- ============ VERIFICATION DOCUMENTS ============
CREATE TABLE verification_documents (
    id SERIAL PRIMARY KEY,
    recipient_id INTEGER REFERENCES recipients(id) ON DELETE CASCADE,
    document_type VARCHAR(50),
    file_url TEXT NOT NULL,
    uploaded_at TIMESTAMP DEFAULT NOW(),
    review_status verification_status DEFAULT 'PENDING',
    review_notes TEXT,
    reviewed_by INTEGER REFERENCES users(id),
    reviewed_at TIMESTAMP
);

-- ============ DONATIONS ============
CREATE TYPE donation_status AS ENUM (
    'PENDING_REVIEW', 'REJECTED', 'POSTED', 'MATCHED',
    'PICKED_UP', 'COMPLETED', 'EXPIRED'
);

CREATE TABLE donations (
    id SERIAL PRIMARY KEY,
    donor_id INTEGER REFERENCES donors(id) ON DELETE CASCADE,
    food_type VARCHAR(100),
    quantity_servings INTEGER NOT NULL,
    pickup_location GEOGRAPHY(Point, 4326) NOT NULL,
    pickup_window_start TIMESTAMP,
    pickup_window_end TIMESTAMP,
    expiry_time TIMESTAMP NOT NULL,
    status donation_status DEFAULT 'PENDING_REVIEW',
    rejection_reason TEXT,
    posted_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_donations_location ON donations USING GIST (pickup_location);
CREATE INDEX idx_recipients_location ON recipients USING GIST (service_location);

-- ============ MATCHES ============
CREATE TYPE match_status AS ENUM ('PROPOSED', 'ACCEPTED', 'DECLINED', 'CANCELLED');

CREATE TABLE matches (
    id SERIAL PRIMARY KEY,
    donation_id INTEGER REFERENCES donations(id) ON DELETE CASCADE,
    recipient_id INTEGER REFERENCES recipients(id) ON DELETE CASCADE,
    proximity_score NUMERIC(5,2),
    urgency_score NUMERIC(5,2),
    capacity_score NUMERIC(5,2),
    total_score NUMERIC(5,2),
    status match_status DEFAULT 'PROPOSED',
    pickup_code VARCHAR(10),
    matched_at TIMESTAMP DEFAULT NOW(),
    responded_at TIMESTAMP
);

-- ============ AUDIT LOG ============
CREATE TABLE audit_logs (
    id SERIAL PRIMARY KEY,
    entity_type VARCHAR(50),
    entity_id INTEGER,
    action VARCHAR(50),
    performed_by INTEGER REFERENCES users(id),
    notes TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

-- ============ NOTIFICATIONS ============
CREATE TABLE notifications (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    message TEXT NOT NULL,
    is_read BOOLEAN DEFAULT FALSE,
    related_entity_type VARCHAR(50),
    related_entity_id INTEGER,
    created_at TIMESTAMP DEFAULT NOW()
);

-- ============ GEOCODE CACHE ============
CREATE TABLE geocode_cache (
    id SERIAL PRIMARY KEY,
    raw_address TEXT UNIQUE NOT NULL,
    location GEOGRAPHY(Point, 4326) NOT NULL,
    provider VARCHAR(50),
    cached_at TIMESTAMP DEFAULT NOW()
);
