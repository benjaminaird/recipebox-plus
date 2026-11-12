'use strict';

// Device sessions for the native client (`/api/v1`), per ADR 0010 and
// docs/native-auth-design.md.
//
// Two things live here and nothing else:
//
//   1. The token lifecycle — minting, rotation, reuse detection, expiry,
//      revocation. It is pure logic over a small store interface, so the very
//      code the server runs can be exercised offline against an in-memory
//      store. That is what makes the rotation and replay tests real rather
//      than a re-implementation that agrees with itself.
//   2. Two implementations of that store: Postgres for production, memory for
//      tests. Both are driven by the same conformance suite
//      (scripts/device-auth-test.js), so a divergence fails rather than hides.
//
// Identity is NOT here. There is one account system — `profiles`, the web
// app's — and this module only reads it. No second password store, no second
// notion of who someone is.

const crypto = require('crypto');

// Lifetimes. Constants, not configuration: they belong in the diff where they
// can be reviewed, and identical in every environment (design doc, Deployment).
const ACCESS_TTL_SECONDS = 15 * 60;                      // 15 minutes
const REFRESH_TTL_SECONDS = 30 * 24 * 60 * 60;           // 30 days, rolling on use
const DEVICE_ABSOLUTE_LIFETIME_SECONDS = 180 * 24 * 60 * 60; // 6 months, not rolling
// A refresh token that is presented again within this window is treated as the
// same device retrying (a dropped response, two screens refreshing at once)
// rather than as a replay. Past it, a second presentation revokes the family.
const REFRESH_REUSE_GRACE_SECONDS = 60;
const MAX_DEVICES_PER_USER = 25;

const DEVICE_NAME_MAX = 120;
const PLATFORMS = new Set(['ios', 'android', 'unknown']);

class DeviceAuthError extends Error {
  constructor(status, code, message, extra) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra || null;
  }
}

function mintToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

// A stable, non-reversible handle for logs. Never log a token; never log a
// whole hash either, since a hash is the database key.
function tokenFingerprint(token) {
  return hashToken(token).slice(0, 8);
}

function addSeconds(date, seconds) {
  return new Date(date.getTime() + (seconds * 1000));
}

function cleanDeviceName(value) {
  const name = String(value == null ? '' : value).trim().slice(0, DEVICE_NAME_MAX);
  return name || 'Unknown device';
}

function cleanPlatform(value) {
  const platform = String(value == null ? '' : value).trim().toLowerCase();
  return PLATFORMS.has(platform) ? platform : 'unknown';
}

function cleanInstallId(value) {
  const id = String(value == null ? '' : value).trim().slice(0, 120);
  return id || null;
}

// What the client is told about a device. Never includes a token or a hash.
function publicDevice(device, currentDeviceId) {
  return {
    id: device.id,
    name: device.device_name,
    platform: device.platform,
    createdAt: new Date(device.created_at).toISOString(),
    lastSeenAt: new Date(device.last_seen_at).toISOString(),
    current: device.id === currentDeviceId,
  };
}

// The user as `/api/v1` reports them.
//
// `emailVerified` is the column; `emailVerifiedAt` is when it was actually
// proven. Accounts that predate the verification feature were backfilled to
// `email_verified = true` with a NULL timestamp, so reporting only the boolean
// would state as proven something nobody ever proved. Both fields go out, and
// the client can tell the difference.
function publicUser(row) {
  if (!row) return null;
  const role = row.role || 'user';
  return {
    id: row.user_id,
    email: row.email,
    displayName: row.display_name || '',
    role,
    emailVerified: row.email_verified !== false,
    emailVerifiedAt: row.email_verified_at ? new Date(row.email_verified_at).toISOString() : null,
  };
}

function deviceExpiresAt(device) {
  return addSeconds(new Date(device.created_at), DEVICE_ABSOLUTE_LIFETIME_SECONDS);
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

async function issuePair(store, device, now) {
  const access = mintToken();
  const refresh = mintToken();
  const accessExpiry = addSeconds(now, ACCESS_TTL_SECONDS);
  // The rolling refresh window never outlives the device's absolute lifetime,
  // so the cap is enforced by the token's own expiry rather than by a separate
  // check somebody could forget to make.
  const rollingExpiry = addSeconds(now, REFRESH_TTL_SECONDS);
  const absolute = deviceExpiresAt(device);
  const refreshExpiry = rollingExpiry < absolute ? rollingExpiry : absolute;

  await store.insertToken({ tokenHash: hashToken(access), deviceId: device.id, kind: 'access', expiresAt: accessExpiry, createdAt: now });
  await store.insertToken({ tokenHash: hashToken(refresh), deviceId: device.id, kind: 'refresh', expiresAt: refreshExpiry, createdAt: now });

  return {
    accessToken: access,
    refreshToken: refresh,
    accessExpiresAt: accessExpiry.toISOString(),
    refreshExpiresAt: refreshExpiry.toISOString(),
    deviceId: device.id,
  };
}

/** The public shape of a pair: lifetimes as seconds remaining, no absolute
 *  timestamps, because a client must not trust its own clock against ours. */
function toPair(issued, now) {
  return {
    accessToken: issued.accessToken,
    expiresIn: Math.max(0, Math.round((new Date(issued.accessExpiresAt) - now) / 1000)),
    refreshToken: issued.refreshToken,
    refreshExpiresIn: Math.max(0, Math.round((new Date(issued.refreshExpiresAt) - now) / 1000)),
    deviceId: issued.deviceId,
  };
}

// ---------------------------------------------------------------------------
// Making the grace window idempotent
//
// A refresh presented twice inside the grace window is the same device asking
// twice, so it must get the same answer twice. The first version issued a
// second, independent chain instead — which meant a token captured in transit
// and replayed within the minute bought its holder a parallel session that
// reuse detection could never see, because neither chain was ever presented a
// second time. A security review caught it.
//
// Returning the same pair needs the pair, and all we keep of a token is its
// hash. So the successor is sealed with a key derived from the token that
// produced it: anyone who can present that token can open it, which is exactly
// the set of people who already hold it, and the database holds neither the key
// nor anything derived from it. A replay now yields precisely what the
// legitimate client already has — and the moment either of them rotates it,
// ordinary reuse detection applies to the pair of them.
// ---------------------------------------------------------------------------

const SUCCESSOR_INFO = Buffer.from('recipebox-device-successor-v1');

function successorKey(token) {
  return Buffer.from(crypto.hkdfSync('sha256', Buffer.from(String(token)), Buffer.alloc(0), SUCCESSOR_INFO, 32));
}

function sealSuccessor(token, issued) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', successorKey(token), iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(issued), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64');
}

function openSuccessor(token, sealed) {
  try {
    const raw = Buffer.from(String(sealed || ''), 'base64');
    if (raw.length <= 28) return null;
    const decipher = crypto.createDecipheriv('aes-256-gcm', successorKey(token), raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    const plain = Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
    const parsed = JSON.parse(plain);
    return (parsed && parsed.accessToken && parsed.refreshToken) ? parsed : null;
  } catch {
    return null;
  }
}

// Sign in with the web app's own credentials against the web app's own
// `profiles` row. `verifyPassword` is injected rather than imported so this
// module never owns a second opinion about what a valid password is.
async function signIn(store, { email, password, device }, options) {
  const opts = options || {};
  const now = opts.now || new Date();
  const verifyPassword = opts.verifyPassword;
  if (typeof verifyPassword !== 'function') throw new Error('signIn requires a verifyPassword function');

  const user = await store.findUserByEmail(String(email || '').trim().toLowerCase());
  // One message for an unknown address and for a wrong password, as the web
  // does: a different one would answer "does this person have an account?".
  const ok = !!user && verifyPassword(String(password || ''), user.password_hash);
  if (!ok) throw new DeviceAuthError(401, 'invalid_credentials', 'Email or password did not match.');

  if (user.email_verified === false) {
    throw new DeviceAuthError(403, 'email_verification_required', 'Confirm your email address to finish signing in.', { userId: user.user_id, email: user.email });
  }

  await store.purgeExpiredTokens(now);

  const installId = cleanInstallId(device && device.installId);
  let row = installId ? await store.findDeviceByInstall(user.user_id, installId) : null;
  if (row && (row.revoked_at || deviceExpiresAt(row) <= now)) {
    // A device past its ceiling still has revoked_at NULL, and the partial
    // unique index covers exactly those rows — so creating its replacement
    // without revoking it first collides. Retire it here.
    if (!row.revoked_at) await store.revokeDevice(row.id, now);
    row = null;
  }

  if (row) {
    // Signing in again on a device we already know starts a clean chain: any
    // token outstanding from the previous session stops working now.
    await store.deleteDeviceTokens(row.id);
    await store.updateDevice(row.id, { deviceName: cleanDeviceName(device && device.name), platform: cleanPlatform(device && device.platform), lastSeenAt: now });
    row = await store.getDevice(row.id);
  } else {
    const live = await store.countLiveDevices(user.user_id, now);
    if (live >= MAX_DEVICES_PER_USER) {
      throw new DeviceAuthError(409, 'device_limit_reached', 'Too many signed-in devices. Sign one out and try again.');
    }
    row = await store.createDevice({
      userId: user.user_id,
      deviceName: cleanDeviceName(device && device.name),
      platform: cleanPlatform(device && device.platform),
      installId,
      createdAt: now,
    });
  }

  const issued = await issuePair(store, row, now);
  return { ...toPair(issued, now), user: publicUser(user), device: publicDevice(row, row.id) };
}

// Rotate. Every success issues a new refresh token and spends the presented
// one. Presenting a spent token outside the grace window means it was captured,
// so the whole device chain goes — a false positive costs a sign-in, a false
// negative costs an account.
async function refresh(store, { refreshToken }, options) {
  const opts = options || {};
  const now = opts.now || new Date();
  const presented = String(refreshToken || '');
  // Every failure below reports the same code. A caller must not be able to
  // tell "no such token" from "revoked" from "replayed".
  const invalid = () => new DeviceAuthError(401, 'refresh_invalid', 'Sign in again to continue.');
  if (!presented) throw invalid();

  const row = await store.getToken(hashToken(presented));
  if (!row || row.kind !== 'refresh') throw invalid();

  const device = await store.getDevice(row.device_id);
  if (!device || device.revoked_at) throw invalid();

  if (deviceExpiresAt(device) <= now) {
    await store.revokeDevice(device.id, now);
    throw invalid();
  }

  const reuse = () => {
    const err = invalid();
    err.reuseDetected = true;
    err.deviceId = device.id;
    return err;
  };

  if (row.used_at) {
    const spentForMs = now.getTime() - new Date(row.used_at).getTime();
    if (spentForMs > REFRESH_REUSE_GRACE_SECONDS * 1000) {
      // Replay. Revoke the family, not just this token.
      await store.revokeDevice(device.id, now);
      throw reuse();
    }
    // Inside the window: the same device asking twice, because the first
    // answer never arrived. It gets that same answer again — not a second
    // chain, which is what a replayed token would otherwise buy. The access
    // token in there cannot have expired, because the grace window is a minute
    // and an access token lives fifteen.
    const successor = openSuccessor(presented, row.successor_enc);
    if (!successor) {
      // Spent, inside the window, and nothing to replay: a tampered row, or
      // one written before the successor was sealed. Treat it as the replay it
      // looks like rather than minting something new.
      await store.revokeDevice(device.id, now);
      throw reuse();
    }
    return repeat(store, device, successor, now);
  }

  if (new Date(row.expires_at) <= now) throw invalid();

  // Issue first, then claim. The order matters: the claim is what publishes
  // the new pair to anyone racing us, so the rows have to exist before it
  // happens, or a caller could be handed a token the database has not got yet.
  const issued = await issuePair(store, device, now);
  const won = await store.claimToken(row.token_hash, now, sealSuccessor(presented, issued));
  if (!won) {
    // Another request presenting the same token got there first. Throw away
    // what we made and answer with theirs, so two callers racing with one
    // token get one answer — which is what makes a replay useless.
    await store.deleteToken(hashToken(issued.accessToken));
    await store.deleteToken(hashToken(issued.refreshToken));
    const claimed = await store.getToken(row.token_hash);
    const successor = claimed ? openSuccessor(presented, claimed.successor_enc) : null;
    if (!successor) throw invalid();
    return repeat(store, device, successor, now);
  }

  await store.purgeExpiredTokens(now);
  await store.touchDevice(device.id, now);
  const user = await store.findUserById(device.user_id);
  if (!user) throw invalid();

  return { ...toPair(issued, now), user: publicUser(user) };
}

/** Hand back a pair that was already issued, with its lifetimes counted down. */
async function repeat(store, device, successor, now) {
  await store.touchDevice(device.id, now);
  const user = await store.findUserById(device.user_id);
  if (!user) throw new DeviceAuthError(401, 'refresh_invalid', 'Sign in again to continue.');
  return { ...toPair(successor, now), user: publicUser(user) };
}

// Resolve an access token to a user and a device, or say why not. Checked
// against the store on every request, which is what makes revocation immediate.
async function authenticate(store, accessToken, options) {
  const opts = options || {};
  const now = opts.now || new Date();
  const presented = String(accessToken || '');
  if (!presented) throw new DeviceAuthError(401, 'unauthorized', 'Sign in required.');

  const row = await store.getToken(hashToken(presented));
  if (!row || row.kind !== 'access') throw new DeviceAuthError(401, 'unauthorized', 'Sign in required.');
  if (new Date(row.expires_at) <= now) throw new DeviceAuthError(401, 'token_expired', 'Access token expired.');

  const device = await store.getDevice(row.device_id);
  if (!device || device.revoked_at || deviceExpiresAt(device) <= now) {
    throw new DeviceAuthError(401, 'unauthorized', 'Sign in required.');
  }

  const user = await store.findUserById(device.user_id);
  if (!user) throw new DeviceAuthError(401, 'unauthorized', 'Sign in required.');

  await store.touchDevice(device.id, now);
  return { user, device };
}

async function signOut(store, { deviceId }, options) {
  const now = (options || {}).now || new Date();
  if (!deviceId) return { ok: true };
  await store.revokeDevice(deviceId, now);
  return { ok: true };
}

async function listDevices(store, userId, currentDeviceId, options) {
  const now = (options || {}).now || new Date();
  const rows = await store.listDevices(userId, now);
  return rows.map((row) => publicDevice(row, currentDeviceId));
}

async function revokeDevice(store, userId, deviceId, options) {
  const now = (options || {}).now || new Date();
  const device = await store.getDevice(deviceId);
  // Someone else's device id reads as "no such device", so the endpoint cannot
  // be used to discover that an id exists.
  if (!device || device.user_id !== userId) throw new DeviceAuthError(404, 'device_not_found', 'No such device.');
  await store.revokeDevice(deviceId, now);
  return { ok: true };
}

// Credential change (password reset, password change) revokes every device.
// The web routes call this beside their existing `account_sessions` cleanup.
async function revokeAllDevices(store, userId, options) {
  const now = (options || {}).now || new Date();
  return store.revokeAllDevices(userId, now);
}

// ---------------------------------------------------------------------------
// Stores
// ---------------------------------------------------------------------------

const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS device_sessions (
     id            uuid PRIMARY KEY,
     user_id       text NOT NULL REFERENCES profiles(user_id) ON DELETE CASCADE,
     device_name   text NOT NULL DEFAULT 'Unknown device',
     platform      text NOT NULL DEFAULT 'unknown',
     install_id    text,
     created_at    timestamptz NOT NULL DEFAULT now(),
     last_seen_at  timestamptz NOT NULL DEFAULT now(),
     revoked_at    timestamptz
   )`,
  `CREATE TABLE IF NOT EXISTS device_tokens (
     token_hash  text PRIMARY KEY,
     device_id   uuid NOT NULL REFERENCES device_sessions(id) ON DELETE CASCADE,
     kind        text NOT NULL,
     expires_at  timestamptz NOT NULL,
     used_at     timestamptz,
     -- The pair this token was rotated into, sealed under the token itself so
     -- a retry inside the grace window gets the same answer rather than a
     -- second chain. Unreadable to anyone holding only the database.
     successor_enc text,
     created_at  timestamptz NOT NULL DEFAULT now()
   )`,
  'ALTER TABLE device_tokens ADD COLUMN IF NOT EXISTS successor_enc text',
  'CREATE INDEX IF NOT EXISTS device_sessions_user_idx ON device_sessions (user_id)',
  'CREATE UNIQUE INDEX IF NOT EXISTS device_sessions_install_idx ON device_sessions (user_id, install_id) WHERE install_id IS NOT NULL AND revoked_at IS NULL',
  'CREATE INDEX IF NOT EXISTS device_tokens_device_idx ON device_tokens (device_id)',
  'CREATE INDEX IF NOT EXISTS device_tokens_expiry_idx ON device_tokens (expires_at)',
];

async function ensureSchema(db) {
  for (const statement of SCHEMA_STATEMENTS) await db.query(statement);
}

function createPgStore(db) {
  return {
    async findUserByEmail(email) {
      const result = await db.query(
        'SELECT user_id, email, display_name, role, password_hash, email_verified, email_verified_at FROM profiles WHERE email=$1',
        [email]
      );
      return result.rows[0] || null;
    },
    async findUserById(userId) {
      const result = await db.query(
        'SELECT user_id, email, display_name, role, password_hash, email_verified, email_verified_at FROM profiles WHERE user_id=$1',
        [userId]
      );
      return result.rows[0] || null;
    },
    async createDevice({ userId, deviceName, platform, installId, createdAt }) {
      const result = await db.query(
        `INSERT INTO device_sessions(id, user_id, device_name, platform, install_id, created_at, last_seen_at)
         VALUES($1,$2,$3,$4,$5,$6,$6) RETURNING *`,
        [crypto.randomUUID(), userId, deviceName, platform, installId, createdAt]
      );
      return result.rows[0];
    },
    async getDevice(id) {
      // An id that is not a uuid must read as "no such device", not as a
      // database error that would leak the shape of the query.
      if (!/^[0-9a-fA-F-]{36}$/.test(String(id || ''))) return null;
      const result = await db.query('SELECT * FROM device_sessions WHERE id=$1', [id]);
      return result.rows[0] || null;
    },
    async findDeviceByInstall(userId, installId) {
      const result = await db.query(
        'SELECT * FROM device_sessions WHERE user_id=$1 AND install_id=$2 AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 1',
        [userId, installId]
      );
      return result.rows[0] || null;
    },
    async listDevices(userId, now) {
      const result = await db.query(
        'SELECT * FROM device_sessions WHERE user_id=$1 AND revoked_at IS NULL AND created_at > $2 ORDER BY last_seen_at DESC',
        [userId, addSeconds(now, -DEVICE_ABSOLUTE_LIFETIME_SECONDS)]
      );
      return result.rows;
    },
    async countLiveDevices(userId, now) {
      const result = await db.query(
        'SELECT count(*)::int AS n FROM device_sessions WHERE user_id=$1 AND revoked_at IS NULL AND created_at > $2',
        [userId, addSeconds(now, -DEVICE_ABSOLUTE_LIFETIME_SECONDS)]
      );
      return Number(result.rows[0] ? result.rows[0].n : 0);
    },
    async updateDevice(id, { deviceName, platform, lastSeenAt }) {
      await db.query(
        'UPDATE device_sessions SET device_name=$2, platform=$3, last_seen_at=$4 WHERE id=$1',
        [id, deviceName, platform, lastSeenAt]
      );
    },
    async touchDevice(id, now) {
      await db.query('UPDATE device_sessions SET last_seen_at=$2 WHERE id=$1', [id, now]);
    },
    async revokeDevice(id, now) {
      await db.query('UPDATE device_sessions SET revoked_at=$2 WHERE id=$1 AND revoked_at IS NULL', [id, now]);
      await db.query('DELETE FROM device_tokens WHERE device_id=$1', [id]);
    },
    async revokeAllDevices(userId, now) {
      await db.query('DELETE FROM device_tokens WHERE device_id IN (SELECT id FROM device_sessions WHERE user_id=$1)', [userId]);
      const result = await db.query('UPDATE device_sessions SET revoked_at=$2 WHERE user_id=$1 AND revoked_at IS NULL', [userId, now]);
      return result.rowCount || 0;
    },
    async deleteDeviceTokens(deviceId) {
      await db.query('DELETE FROM device_tokens WHERE device_id=$1', [deviceId]);
    },
    async insertToken({ tokenHash, deviceId, kind, expiresAt, createdAt }) {
      await db.query(
        'INSERT INTO device_tokens(token_hash, device_id, kind, expires_at, created_at) VALUES($1,$2,$3,$4,$5)',
        [tokenHash, deviceId, kind, expiresAt, createdAt]
      );
    },
    async getToken(tokenHash) {
      const result = await db.query('SELECT * FROM device_tokens WHERE token_hash=$1', [tokenHash]);
      return result.rows[0] || null;
    },
    // Spend a refresh token and publish its successor in one statement, so a
    // concurrent request never sees the half-done state. The row count is the
    // whole answer: one means we claimed it, zero means somebody else did.
    async claimToken(tokenHash, now, sealed) {
      const result = await db.query(
        'UPDATE device_tokens SET used_at=$2, successor_enc=$3 WHERE token_hash=$1 AND used_at IS NULL',
        [tokenHash, now, sealed]
      );
      return (result.rowCount || 0) > 0;
    },
    async recordSuccessor(tokenHash, sealed) {
      await db.query('UPDATE device_tokens SET successor_enc=$2 WHERE token_hash=$1', [tokenHash, sealed]);
    },
    async deleteToken(tokenHash) {
      await db.query('DELETE FROM device_tokens WHERE token_hash=$1', [tokenHash]);
    },
    async listTokensForDevice(deviceId) {
      const result = await db.query('SELECT * FROM device_tokens WHERE device_id=$1', [deviceId]);
      return result.rows;
    },
    async purgeExpiredTokens(now) {
      // Opportunistic, the way rate_limit_counters is already handled: a spent
      // refresh token is kept for the grace window so a replay after it still
      // has something to detect.
      await db.query(
        'DELETE FROM device_tokens WHERE expires_at < $1 AND (used_at IS NULL OR used_at < $2)',
        [now, addSeconds(now, -REFRESH_REUSE_GRACE_SECONDS)]
      );
    },
  };
}

// The same store over plain objects. Used by the offline suites, and by the
// router's test seam, so the lifecycle under test is the shipped one.
function createMemoryStore(seedUsers) {
  const users = new Map();
  const devices = new Map();
  const tokens = new Map();
  let deviceCounter = 0;

  for (const user of (seedUsers || [])) {
    users.set(String(user.email).toLowerCase(), { email_verified: true, email_verified_at: null, role: 'user', display_name: '', ...user });
  }

  const byId = (userId) => [...users.values()].find((u) => u.user_id === userId) || null;
  const live = (device, now) => !device.revoked_at && deviceExpiresAt(device) > now;

  return {
    _users: users,
    _devices: devices,
    _tokens: tokens,
    async findUserByEmail(email) { return users.get(String(email).toLowerCase()) || null; },
    async findUserById(userId) { return byId(userId); },
    async createDevice({ userId, deviceName, platform, installId, createdAt }) {
      deviceCounter += 1;
      const id = `11111111-0000-4000-8000-${String(deviceCounter).padStart(12, '0')}`;
      const device = { id, user_id: userId, device_name: deviceName, platform, install_id: installId, created_at: createdAt, last_seen_at: createdAt, revoked_at: null };
      devices.set(id, device);
      return device;
    },
    async getDevice(id) { return devices.get(String(id)) || null; },
    async findDeviceByInstall(userId, installId) {
      return [...devices.values()].find((d) => d.user_id === userId && d.install_id === installId && !d.revoked_at) || null;
    },
    async listDevices(userId, now) {
      return [...devices.values()]
        .filter((d) => d.user_id === userId && live(d, now))
        .sort((a, b) => new Date(b.last_seen_at) - new Date(a.last_seen_at));
    },
    async countLiveDevices(userId, now) {
      return [...devices.values()].filter((d) => d.user_id === userId && live(d, now)).length;
    },
    async updateDevice(id, { deviceName, platform, lastSeenAt }) {
      const device = devices.get(id);
      if (!device) return;
      device.device_name = deviceName;
      device.platform = platform;
      device.last_seen_at = lastSeenAt;
    },
    async touchDevice(id, now) {
      const device = devices.get(id);
      if (device) device.last_seen_at = now;
    },
    async revokeDevice(id, now) {
      const device = devices.get(id);
      if (device && !device.revoked_at) device.revoked_at = now;
      for (const [hash, token] of tokens) if (token.device_id === id) tokens.delete(hash);
    },
    async revokeAllDevices(userId, now) {
      let n = 0;
      for (const device of devices.values()) {
        if (device.user_id !== userId || device.revoked_at) continue;
        device.revoked_at = now;
        n += 1;
        for (const [hash, token] of tokens) if (token.device_id === device.id) tokens.delete(hash);
      }
      return n;
    },
    async deleteDeviceTokens(deviceId) {
      for (const [hash, token] of tokens) if (token.device_id === deviceId) tokens.delete(hash);
    },
    async insertToken({ tokenHash, deviceId, kind, expiresAt, createdAt }) {
      tokens.set(tokenHash, { token_hash: tokenHash, device_id: deviceId, kind, expires_at: expiresAt, used_at: null, successor_enc: null, created_at: createdAt });
    },
    async getToken(tokenHash) { return tokens.get(tokenHash) || null; },
    // Synchronous between the read and the write, which is what makes it the
    // compare-and-swap the Postgres store does in one statement.
    async claimToken(tokenHash, now, sealed) {
      const token = tokens.get(tokenHash);
      if (!token || token.used_at) return false;
      token.used_at = now;
      token.successor_enc = sealed;
      return true;
    },
    async recordSuccessor(tokenHash, sealed) {
      const token = tokens.get(tokenHash);
      if (token) token.successor_enc = sealed;
    },
    async deleteToken(tokenHash) { tokens.delete(tokenHash); },
    async listTokensForDevice(deviceId) {
      return [...tokens.values()].filter((t) => t.device_id === deviceId);
    },
    async purgeExpiredTokens(now) {
      const cutoff = addSeconds(now, -REFRESH_REUSE_GRACE_SECONDS);
      for (const [hash, token] of tokens) {
        if (new Date(token.expires_at) < now && (!token.used_at || new Date(token.used_at) < cutoff)) tokens.delete(hash);
      }
    },
  };
}

module.exports = {
  ACCESS_TTL_SECONDS,
  REFRESH_TTL_SECONDS,
  DEVICE_ABSOLUTE_LIFETIME_SECONDS,
  REFRESH_REUSE_GRACE_SECONDS,
  MAX_DEVICES_PER_USER,
  DeviceAuthError,
  SCHEMA_STATEMENTS,
  ensureSchema,
  mintToken,
  hashToken,
  tokenFingerprint,
  sealSuccessor,
  openSuccessor,
  publicUser,
  publicDevice,
  deviceExpiresAt,
  signIn,
  refresh,
  authenticate,
  signOut,
  listDevices,
  revokeDevice,
  revokeAllDevices,
  createPgStore,
  createMemoryStore,
};
