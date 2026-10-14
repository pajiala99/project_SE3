import bcrypt from 'bcryptjs';
import { getPool, withTransaction, type Queryable } from '../db/pool';
import { DONOR_TYPES, ORGANIZATION_TYPES } from '../domain/enums';
import { signToken, type AuthUser } from '../middleware/authenticate';
import { userRepository, type UserRow } from '../repositories/userRepository';
import { badRequest, conflict, unauthorized } from '../utils/errors';
import {
  asObject,
  coordinates,
  optionalNumber,
  optionalString,
  optionalStringArray,
  requiredEmail,
  requiredEnum,
  requiredInt,
  requiredString,
} from '../utils/validation';

const SELF_REGISTER_ROLES = ['DONOR', 'RECIPIENT'] as const;

function toAuthUser(row: { user_id: string; email: string; name: string; role: AuthUser['role'] }): AuthUser {
  return { userId: row.user_id, email: row.email, name: row.name, role: row.role };
}

/** The user row without its password hash. Every auth endpoint (register,
 *  login, me, profile) returns the user in this one snake_case shape. */
function toPublicUser(row: UserRow): Omit<UserRow, 'password_hash'> {
  const { password_hash: _omit, ...safe } = row;
  return safe;
}

async function loadProfile(db: Queryable, user: UserRow) {
  if (user.role === 'DONOR') return userRepository.getDonor(db, user.user_id);
  if (user.role === 'RECIPIENT') return userRepository.getRecipient(db, user.user_id);
  return null;
}

/** UML User operations: register(), login(), updateProfile(). */
export const authService = {
  async register(db: Queryable, body: unknown) {
    const b = asObject(body);
    const name = requiredString(b, 'name', 120);
    const email = requiredEmail(b);
    const password = requiredString(b, 'password', 200);
    if (password.length < 8) throw badRequest("'password' must be at least 8 characters.");
    // FR-1: self-registration is for donors and recipient organisations only.
    // Administrator accounts are provisioned by the operating team (seed/DB).
    const role = requiredEnum(b, 'role', SELF_REGISTER_ROLES);
    const phone = optionalString(b, 'phone', 40);
    const address = optionalString(b, 'address', 300);

    let coords: { latitude?: number; longitude?: number } = {};
    if (b.latitude !== undefined || b.longitude !== undefined) coords = coordinates(b);

    if (await userRepository.findByEmail(db, email)) {
      throw conflict('EMAIL_TAKEN', `An account with email '${email}' already exists.`);
    }

    const passwordHash = await bcrypt.hash(password, 10);

    return withTransaction(db, async (tx) => {
      const user = await userRepository.create(tx, {
        name, email, phone, passwordHash, role, address,
        latitude: coords.latitude, longitude: coords.longitude,
      });

      let profile: unknown = null;
      if (role === 'DONOR') {
        const donorType = requiredEnum(b, 'donorType', DONOR_TYPES);
        profile = await userRepository.createDonor(tx, user.user_id, donorType);
      } else if (role === 'RECIPIENT') {
        const organizationType = requiredEnum(b, 'organizationType', ORGANIZATION_TYPES);
        const servingCapacity = requiredInt(b, 'servingCapacity', 1, 1_000_000);
        const serviceRadiusKm = optionalNumber(b, 'serviceRadiusKm', 0.5, 500) ?? 10;
        const foodPreferences = optionalStringArray(b, 'foodPreferences') ?? [];
        const dietaryRestrictions = optionalStringArray(b, 'dietaryRestrictions') ?? [];
        if (coords.latitude === undefined) {
          throw badRequest("Recipients must provide 'latitude' and 'longitude' for matching.");
        }
        profile = await userRepository.createRecipient(tx, {
          recipientId: user.user_id, organizationType, servingCapacity, serviceRadiusKm,
          foodPreferences, dietaryRestrictions, latitude: coords.latitude, longitude: coords.longitude,
        });
      }

      return { user: toPublicUser(user), profile, token: signToken(toAuthUser(user)) };
    });
  },

  async login(db: Queryable, body: unknown) {
    const b = asObject(body);
    const email = requiredEmail(b);
    const password = requiredString(b, 'password');

    const user = await userRepository.findByEmail(db, email);
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      throw unauthorized('Invalid email or password.');
    }
    return {
      user: toPublicUser(user),
      profile: await loadProfile(db, user),
      token: signToken(toAuthUser(user)),
    };
  },

  async getProfile(db: Queryable, userId: string) {
    const user = await userRepository.findById(db, userId);
    if (!user) throw unauthorized('Account no longer exists.');
    return { user: toPublicUser(user), profile: await loadProfile(db, user) };
  },

  async updateProfile(db: Queryable, userId: string, body: unknown) {
    const b = asObject(body);
    const user = await userRepository.findById(db, userId);
    if (!user) throw unauthorized('Account no longer exists.');

    const updated = await userRepository.updateProfile(db, userId, {
      name: optionalString(b, 'name', 120),
      phone: optionalString(b, 'phone', 40),
      address: optionalString(b, 'address', 300),
      latitude: optionalNumber(b, 'latitude', -90, 90),
      longitude: optionalNumber(b, 'longitude', -180, 180),
    });

    let profile = null;
    if (user.role === 'RECIPIENT') {
      profile = await userRepository.updateRecipient(db, userId, {
        organizationType: b.organizationType === undefined ? undefined : requiredEnum(b, 'organizationType', ORGANIZATION_TYPES),
        servingCapacity: b.servingCapacity === undefined ? undefined : requiredInt(b, 'servingCapacity', 1, 1_000_000),
        serviceRadiusKm: optionalNumber(b, 'serviceRadiusKm', 0.5, 500),
        foodPreferences: optionalStringArray(b, 'foodPreferences'),
        dietaryRestrictions: optionalStringArray(b, 'dietaryRestrictions'),
        active: typeof b.active === 'boolean' ? b.active : undefined,
        latitude: optionalNumber(b, 'latitude', -90, 90),
        longitude: optionalNumber(b, 'longitude', -180, 180),
      });
    } else if (user.role === 'DONOR') {
      profile = await userRepository.getDonor(db, userId);
    }

    return { user: toPublicUser(updated!), profile };
  },
};

export function defaultDb(): Queryable {
  return getPool();
}
