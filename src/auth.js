import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { GuardError } from '../engine/errors.js';

export const SESSION_MS = 30 * 60 * 1000;
const CODE_MS = 5 * 60 * 1000;
const STEP_UP_GRANT_MS = 10 * 60 * 1000;
const MAX_CODE_ATTEMPTS = 5;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const codeHash = (id, code) => sha256(`${id}:${code}`);

// Demo sign-in: codes are returned to the screen, and nothing is emailed or texted.
export class Auth {
  constructor(db, { now = Date.now } = {}) {
    this.db = db;
    this.now = now;
  }

  #newCode() {
    return String(randomInt(0, 1_000_000)).padStart(6, '0');
  }

  #checkCode(row, code) {
    const now = this.now();
    if (!row || row.consumed_at || row.verified_at) throw new GuardError('Request a new code.');
    if (now >= row.expires_at) throw new GuardError('That code has expired. Request a new one.');
    if (row.attempts >= MAX_CODE_ATTEMPTS) throw new GuardError('Too many attempts. Request a new code.', 429);
    const expected = Buffer.from(row.code_hash);
    const actual = Buffer.from(codeHash(row.id, String(code)));
    if (!timingSafeEqual(expected, actual)) {
      this.db.prepare('UPDATE one_time_codes SET attempts = attempts + 1 WHERE id = ?').run(row.id);
      throw new GuardError('That code is not correct.');
    }
  }

  requestSignInCode(rawEmail) {
    const email = typeof rawEmail === 'string' ? rawEmail.trim().toLowerCase() : '';
    if (email.length > 254 || !EMAIL_PATTERN.test(email)) throw new GuardError('Enter an email address.');
    const now = this.now();
    const id = randomUUID();
    const code = this.#newCode();
    this.db.prepare("UPDATE one_time_codes SET consumed_at = ? WHERE purpose = 'sign_in' AND email = ? AND consumed_at IS NULL").run(now, email);
    this.db.prepare(`INSERT INTO one_time_codes (id, purpose, email, code_hash, created_at, expires_at)
      VALUES (?, 'sign_in', ?, ?, ?, ?)`).run(id, email, codeHash(id, code), now, now + CODE_MS);
    return { email, demoCode: code, expiresAt: now + CODE_MS };
  }

  verifySignIn(rawEmail, code) {
    const email = typeof rawEmail === 'string' ? rawEmail.trim().toLowerCase() : '';
    const row = this.db.prepare(`SELECT * FROM one_time_codes
      WHERE purpose = 'sign_in' AND email = ? AND consumed_at IS NULL ORDER BY created_at DESC LIMIT 1`).get(email);
    this.#checkCode(row, code);

    const now = this.now();
    let user = this.db.prepare('SELECT id, email FROM users WHERE email = ?').get(email);
    if (!user) {
      user = { id: randomUUID(), email };
      this.db.prepare('INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)').run(user.id, email, new Date(now).toISOString());
    }
    const sessionToken = randomBytes(32).toString('hex');
    const expiresAt = now + SESSION_MS;
    this.db.prepare('UPDATE one_time_codes SET consumed_at = ? WHERE id = ?').run(now, row.id);
    this.db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
      .run(sha256(sessionToken), user.id, now, expiresAt);
    return { sessionToken, user, expiresAt };
  }

  session(sessionToken) {
    if (typeof sessionToken !== 'string' || !sessionToken) return null;
    const hash = sha256(sessionToken);
    const row = this.db.prepare(`SELECT s.user_id, s.expires_at, u.email FROM sessions s
      JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`).get(hash);
    if (!row) return null;
    if (this.now() >= row.expires_at) {
      this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hash);
      return null;
    }
    return { user: { id: row.user_id, email: row.email }, expiresAt: row.expires_at };
  }

  signOut(sessionToken) {
    if (typeof sessionToken === 'string') this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(sessionToken));
  }

  createStepUp({ userId, sessionToken, subject }) {
    const now = this.now();
    const id = randomUUID();
    const code = this.#newCode();
    this.db.prepare(`INSERT INTO one_time_codes (id, purpose, user_id, session_hash, subject, code_hash, created_at, expires_at)
      VALUES (?, 'step_up', ?, ?, ?, ?, ?, ?)`).run(id, userId, sha256(sessionToken), subject, codeHash(id, code), now, now + CODE_MS);
    return { challengeId: id, demoCode: code, expiresAt: now + CODE_MS };
  }

  #stepUpRow({ challengeId, userId, sessionToken }) {
    const row = this.db.prepare("SELECT * FROM one_time_codes WHERE id = ? AND purpose = 'step_up'").get(String(challengeId));
    if (!row || row.user_id !== userId || row.session_hash !== sha256(sessionToken)) {
      throw new GuardError('Confirm it is you with a new code.', 403);
    }
    return row;
  }

  verifyStepUp({ challengeId, userId, sessionToken, code }) {
    const row = this.#stepUpRow({ challengeId, userId, sessionToken });
    this.#checkCode(row, code);
    this.db.prepare('UPDATE one_time_codes SET verified_at = ? WHERE id = ?').run(this.now(), row.id);
    return { challengeId: row.id, subject: row.subject };
  }

  // A verified step-up is good for one consent, and only for the agent it was issued for.
  stepUpGrant({ challengeId, userId, sessionToken }) {
    const row = this.#stepUpRow({ challengeId, userId, sessionToken });
    if (!row.verified_at || row.consumed_at || this.now() >= row.verified_at + STEP_UP_GRANT_MS) {
      throw new GuardError('Confirm it is you with a new code.', 403);
    }
    return { challengeId: row.id, subject: row.subject, verifiedAt: new Date(row.verified_at).toISOString() };
  }

  consumeStepUp(challengeId) {
    this.db.prepare('UPDATE one_time_codes SET consumed_at = ? WHERE id = ?').run(this.now(), challengeId);
  }
}
