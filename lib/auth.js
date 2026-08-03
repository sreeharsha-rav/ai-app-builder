import crypto from 'crypto';
import { all, one, run } from './db';

const SECRET = process.env.JWT_SECRET || 'dev-jwt-secret-change-me';
const ACCESS_TTL = 60 * 15; // 15 minutes
const REFRESH_TTL = 60 * 60 * 24 * 30; // 30 days

export const uid = () => crypto.randomUUID();
export const nowIso = () => new Date().toISOString();

/* ---------------- passwords ---------------- */
export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const dk = crypto.scryptSync(password, salt, 32).toString('hex');
  return `scrypt$${salt}$${dk}`;
}

export function verifyPassword(password, stored) {
  try {
    const [, salt, dk] = String(stored).split('$');
    const test = crypto.scryptSync(password, salt, 32).toString('hex');
    return crypto.timingSafeEqual(Buffer.from(test, 'hex'), Buffer.from(dk, 'hex'));
  } catch {
    return false;
  }
}

/* ---------------- JWT (HS256) ---------------- */
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');

function sign(data) {
  return crypto.createHmac('sha256', SECRET).update(data).digest('base64url');
}

/** Access token carries user_id ONLY. workspace_id / role are never cached. */
export function signAccessToken(userId) {
  const iat = Math.floor(Date.now() / 1000);
  const head = b64({ alg: 'HS256', typ: 'JWT' });
  const body = b64({ sub: userId, iat, exp: iat + ACCESS_TTL });
  return `${head}.${body}.${sign(`${head}.${body}`)}`;
}

export function verifyAccessToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const expected = sign(`${parts[0]}.${parts[1]}`);
  if (expected.length !== parts[2].length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(parts[2]))) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    if (payload.exp * 1000 < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

/* ---------------- refresh token rotation ---------------- */
const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');

export function issueRefreshToken(userId) {
  const raw = crypto.randomBytes(48).toString('base64url');
  run(
    'INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at, revoked, created_at) VALUES (?,?,?,?,0,?)',
    [uid(), userId, sha(raw), new Date(Date.now() + REFRESH_TTL * 1000).toISOString(), nowIso()]
  );
  return raw;
}

/** Consume + rotate. Returns { userId, refresh } or null. */
export function rotateRefreshToken(raw) {
  if (!raw) return null;
  const row = one('SELECT * FROM refresh_tokens WHERE token_hash = ?', [sha(raw)]);
  if (!row || row.revoked || new Date(row.expires_at) < new Date()) return null;
  run('UPDATE refresh_tokens SET revoked = 1 WHERE id = ?', [row.id]);
  return { userId: row.user_id, refresh: issueRefreshToken(row.user_id) };
}

export function revokeAllRefresh(userId) {
  run('UPDATE refresh_tokens SET revoked = 1 WHERE user_id = ?', [userId]);
}

/* ---------------- cookies ---------------- */
export const ACCESS_COOKIE = 'lg_at';
export const REFRESH_COOKIE = 'lg_rt';

export function setAuthCookies(res, accessToken, refreshToken) {
  const base = { httpOnly: true, sameSite: 'lax', secure: true, path: '/' };
  res.cookies.set(ACCESS_COOKIE, accessToken, { ...base, maxAge: ACCESS_TTL });
  if (refreshToken) res.cookies.set(REFRESH_COOKIE, refreshToken, { ...base, maxAge: REFRESH_TTL });
  return res;
}

export function clearAuthCookies(res) {
  res.cookies.set(ACCESS_COOKIE, '', { httpOnly: true, path: '/', maxAge: 0 });
  res.cookies.set(REFRESH_COOKIE, '', { httpOnly: true, path: '/', maxAge: 0 });
  return res;
}

/** Resolve the current user from the access token cookie or Bearer header. */
export function currentUser(request) {
  const bearer = request.headers.get('authorization');
  const token = bearer?.startsWith('Bearer ')
    ? bearer.slice(7)
    : request.cookies.get(ACCESS_COOKIE)?.value;
  const payload = verifyAccessToken(token);
  if (!payload) return null;
  return one('SELECT id, email, display_name, avatar_url, created_at FROM users WHERE id = ?', [payload.sub]);
}

/** Link any pending invites addressed to this email to the new user id. */
export function linkPendingInvites(userId, email) {
  const pending = all(
    "SELECT * FROM workspace_members WHERE lower(invited_email) = lower(?) AND status = 'pending' AND user_id IS NULL",
    [email]
  );
  for (const p of pending) {
    run('UPDATE workspace_members SET user_id = ? WHERE id = ?', [userId, p.id]);
  }
  return pending.length;
}
