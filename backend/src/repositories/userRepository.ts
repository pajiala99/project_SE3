import type { Queryable } from '../db/pool';
import type { DonorType, UserRole } from '../domain/enums';

export interface UserRow {
  user_id: string;
  name: string;
  email: string;
  phone: string | null;
  password_hash: string;
  role: UserRole;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  created_at: string;
}

export interface DonorRow {
  donor_id: string;
  donor_type: DonorType;
  total_meals_donated: number;
}

export interface RecipientRow {
  recipient_id: string;
  name?: string;
  organization_type: string;
  serving_capacity: number;
  assigned_servings: number;
  service_radius_km: number;
  food_preferences: string[];
  dietary_restrictions: string[];
  active: boolean;
  latitude: number | null;
  longitude: number | null;
  created_at: string;
}

export const userRepository = {
  async create(
    db: Queryable,
    u: {
      name: string; email: string; phone?: string; passwordHash: string; role: UserRole;
      address?: string; latitude?: number; longitude?: number;
    },
  ): Promise<UserRow> {
    const r = await db.query<UserRow>(
      `INSERT INTO users (name, email, phone, password_hash, role, address, latitude, longitude)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [u.name, u.email, u.phone ?? null, u.passwordHash, u.role, u.address ?? null, u.latitude ?? null, u.longitude ?? null],
    );
    return r.rows[0]!;
  },

  async findByEmail(db: Queryable, email: string): Promise<UserRow | null> {
    const r = await db.query<UserRow>('SELECT * FROM users WHERE email = $1', [email.toLowerCase()]);
    return r.rows[0] ?? null;
  },

  async findById(db: Queryable, userId: string): Promise<UserRow | null> {
    const r = await db.query<UserRow>('SELECT * FROM users WHERE user_id = $1', [userId]);
    return r.rows[0] ?? null;
  },

  async updateProfile(
    db: Queryable,
    userId: string,
    p: { name?: string; phone?: string; address?: string; latitude?: number; longitude?: number },
  ): Promise<UserRow | null> {
    const r = await db.query<UserRow>(
      `UPDATE users SET
         name      = COALESCE($2, name),
         phone     = COALESCE($3, phone),
         address   = COALESCE($4, address),
         latitude  = COALESCE($5, latitude),
         longitude = COALESCE($6, longitude)
       WHERE user_id = $1 RETURNING *`,
      [userId, p.name ?? null, p.phone ?? null, p.address ?? null, p.latitude ?? null, p.longitude ?? null],
    );
    return r.rows[0] ?? null;
  },

  async listAdmins(db: Queryable): Promise<UserRow[]> {
    const r = await db.query<UserRow>(`SELECT * FROM users WHERE role = 'ADMIN'`);
    return r.rows;
  },

  async createDonor(db: Queryable, donorId: string, donorType: DonorType): Promise<DonorRow> {
    const r = await db.query<DonorRow>(
      'INSERT INTO donors (donor_id, donor_type) VALUES ($1,$2) RETURNING *',
      [donorId, donorType],
    );
    return r.rows[0]!;
  },

  async getDonor(db: Queryable, donorId: string): Promise<DonorRow | null> {
    const r = await db.query<DonorRow>('SELECT * FROM donors WHERE donor_id = $1', [donorId]);
    return r.rows[0] ?? null;
  },

  async addMealsToDonor(db: Queryable, donorId: string, servings: number): Promise<void> {
    await db.query(
      'UPDATE donors SET total_meals_donated = total_meals_donated + $2 WHERE donor_id = $1',
      [donorId, servings],
    );
  },

  async createRecipient(
    db: Queryable,
    r0: {
      recipientId: string; organizationType: string; servingCapacity: number;
      serviceRadiusKm: number; foodPreferences: string[]; dietaryRestrictions: string[];
      latitude?: number; longitude?: number;
    },
  ): Promise<RecipientRow> {
    const r = await db.query<RecipientRow>(
      `INSERT INTO recipient_organizations
         (recipient_id, organization_type, serving_capacity, service_radius_km,
          food_preferences, dietary_restrictions, active, location)
       VALUES ($1,$2,$3,$4,$5,$6,TRUE,
         CASE WHEN $7::float IS NULL THEN NULL
              ELSE ST_SetSRID(ST_MakePoint($8, $7), 4326)::geography END)
       RETURNING recipient_id, organization_type, serving_capacity, assigned_servings,
         service_radius_km, food_preferences, dietary_restrictions, active, created_at,
         ST_Y(location::geometry) AS latitude, ST_X(location::geometry) AS longitude`,
      [r0.recipientId, r0.organizationType, r0.servingCapacity, r0.serviceRadiusKm,
       r0.foodPreferences, r0.dietaryRestrictions, r0.latitude ?? null, r0.longitude ?? null],
    );
    return r.rows[0]!;
  },

  async getRecipient(db: Queryable, recipientId: string): Promise<RecipientRow | null> {
    const r = await db.query<RecipientRow>(
      `SELECT recipient_id, organization_type, serving_capacity, assigned_servings,
              service_radius_km, food_preferences, dietary_restrictions, active, created_at,
              ST_Y(location::geometry) AS latitude, ST_X(location::geometry) AS longitude
       FROM recipient_organizations WHERE recipient_id = $1`,
      [recipientId],
    );
    return r.rows[0] ?? null;
  },

  async updateRecipient(
    db: Queryable,
    recipientId: string,
    p: {
      organizationType?: string; servingCapacity?: number; serviceRadiusKm?: number;
      foodPreferences?: string[]; dietaryRestrictions?: string[]; active?: boolean;
      latitude?: number; longitude?: number;
    },
  ): Promise<RecipientRow | null> {
    const r = await db.query<RecipientRow>(
      `UPDATE recipient_organizations SET
         organization_type    = COALESCE($2, organization_type),
         serving_capacity     = COALESCE($3, serving_capacity),
         service_radius_km    = COALESCE($4, service_radius_km),
         food_preferences     = COALESCE($5, food_preferences),
         dietary_restrictions = COALESCE($6, dietary_restrictions),
         active               = COALESCE($7, active),
         location             = CASE WHEN $8::float IS NULL THEN location
              ELSE ST_SetSRID(ST_MakePoint($9, $8), 4326)::geography END
       WHERE recipient_id = $1
       RETURNING recipient_id, organization_type, serving_capacity, assigned_servings,
         service_radius_km, food_preferences, dietary_restrictions, active, created_at,
         ST_Y(location::geometry) AS latitude, ST_X(location::geometry) AS longitude`,
      [recipientId, p.organizationType ?? null, p.servingCapacity ?? null, p.serviceRadiusKm ?? null,
       p.foodPreferences ?? null, p.dietaryRestrictions ?? null, p.active ?? null,
       p.latitude ?? null, p.longitude ?? null],
    );
    return r.rows[0] ?? null;
  },

  /** Active recipients with coordinates — candidates for matching. */
  async listActiveRecipients(db: Queryable): Promise<RecipientRow[]> {
    const r = await db.query<RecipientRow>(
      `SELECT ro.recipient_id, u.name, ro.organization_type, ro.serving_capacity, ro.assigned_servings,
              ro.service_radius_km, ro.food_preferences, ro.dietary_restrictions, ro.active, ro.created_at,
              ST_Y(ro.location::geometry) AS latitude, ST_X(ro.location::geometry) AS longitude
       FROM recipient_organizations ro JOIN users u ON u.user_id = ro.recipient_id
       WHERE ro.active = TRUE AND ro.location IS NOT NULL`,
    );
    return r.rows;
  },

  async adjustAssignedServings(db: Queryable, recipientId: string, delta: number): Promise<void> {
    await db.query(
      `UPDATE recipient_organizations
         SET assigned_servings = GREATEST(0, assigned_servings + $2)
       WHERE recipient_id = $1`,
      [recipientId, delta],
    );
  },
};
