import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes, randomUUID, sign, verify } from 'node:crypto';
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { AGENT_COMPANIES, DEMO_AGENTS, MERCHANTS } from './catalog.js';
import { GuardError } from './errors.js';

export const APPROVAL_EXPIRY_DAYS = 3;

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const NO_ACCESS = { problem: { code: 'no_access', reason: 'The agent does not have access.' } };
const masked = (last4) => `tok_test_••••${last4}`;

// Signs consent records with an Ed25519 key held by this server, on the customer's behalf after step-up.
export function loadSigner(path) {
  let privateKey;
  if (path && existsSync(path)) {
    privateKey = createPrivateKey(readFileSync(path));
  } else {
    ({ privateKey } = generateKeyPairSync('ed25519'));
    if (path) {
      writeFileSync(path, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
      chmodSync(path, 0o600);
    }
  }
  const publicKey = createPublicKey(privateKey);
  const keyId = sha256(publicKey.export({ type: 'spki', format: 'der' })).slice(0, 16);
  return {
    keyId,
    sign: (text) => sign(null, Buffer.from(text), privateKey).toString('base64'),
    verify: (text, signature) => verify(null, Buffer.from(text), publicKey, Buffer.from(signature, 'base64')),
  };
}

export function demoAgent(agentId) {
  return DEMO_AGENTS.find((agent) => agent.id === agentId);
}

export class Connections {
  constructor(db, signer) {
    this.db = db;
    this.signer = signer;
  }

  forUser(userId) {
    return {
      authorize: (token, nowMs) => this.authorize(userId, token, nowMs),
      limits: (connectionId, nowMs) => this.limits(userId, connectionId, nowMs),
      list: (nowMs, spend) => this.list(userId, nowMs, spend),
      revoke: (connectionId, nowMs) => this.revoke(userId, connectionId, nowMs),
    };
  }

  // AP2-style intent mandate: what the customer allowed, not a conformant AP2 credential.
  buildMandate({ consentId, version, connectionId, user, agentId, permissions, stepUp, issuedAt }) {
    const agent = demoAgent(agentId);
    const allowedMerchants = MERCHANTS.filter((m) => permissions.allowedMerchantIds.includes(m.id)).map((m) => m.name);
    const budget = (permissions.budgetCents / 100).toFixed(2);
    const approval = (permissions.approvalCents / 100).toFixed(2);
    return {
      type: 'IntentMandate',
      profile: 'ap2-style-demo',
      demo: true,
      id: consentId,
      version,
      issuedAt,
      connectionId,
      customer: { id: user.id, email: user.email },
      agent: { id: agent.id, name: agent.name, company: AGENT_COMPANIES.find((c) => c.id === agent.companyId).name },
      permissions: {
        currency: 'USD',
        budgetCents: permissions.budgetCents,
        allowedMerchantIds: permissions.allowedMerchantIds,
        allowedMerchants,
        approvalCents: permissions.approvalCents,
        approvalExpiryDays: APPROVAL_EXPIRY_DAYS,
        connectionExpiresAt: permissions.connectionExpiresAt,
      },
      statement: `${agent.name} may spend up to $${budget} in total at ${allowedMerchants.join(', ') || 'no merchants'}, asking for approval above $${approval}, until the end of ${permissions.connectionExpiresAt.slice(0, 10)} UTC.`,
      stepUp,
    };
  }

  #insertConsent({ connectionId, version, mandate, issuedAt }) {
    const mandateJson = JSON.stringify(mandate);
    this.db.prepare(`INSERT INTO consents (id, connection_id, version, mandate_json, signature, key_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(mandate.id, connectionId, version, mandateJson, this.signer.sign(mandateJson), this.signer.keyId, issuedAt);
    this.db.prepare('UPDATE agent_connections SET current_consent_id = ? WHERE id = ?').run(mandate.id, connectionId);
  }

  hasActive(userId, agentId) {
    return Boolean(this.db.prepare("SELECT 1 FROM agent_connections WHERE user_id = ? AND agent_id = ? AND status = 'active'").get(userId, agentId));
  }

  link({ user, agentId, permissions, stepUp, nowMs }) {
    if (!demoAgent(agentId)) throw new GuardError('Agent not found.', 404);
    if (this.hasActive(user.id, agentId)) throw new GuardError('This agent is already connected.', 409);
    const issuedAt = new Date(nowMs).toISOString();
    const connectionId = randomUUID();
    const token = `tok_test_${randomBytes(16).toString('hex')}`;

    this.db.transaction(() => {
      this.db.prepare(`INSERT INTO agent_connections (id, user_id, agent_id, status, connected_at)
        VALUES (?, ?, ?, 'active', ?)`).run(connectionId, user.id, agentId, issuedAt);
      const mandate = this.buildMandate({ consentId: randomUUID(), version: 1, connectionId, user, agentId, permissions, stepUp, issuedAt });
      this.#insertConsent({ connectionId, version: 1, mandate, issuedAt });
      this.db.prepare('INSERT INTO tokens (id, connection_id, token_hash, last4, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(randomUUID(), connectionId, sha256(token), token.slice(-4), issuedAt);
      this.db.prepare('INSERT INTO mock_agent_credentials (connection_id, token) VALUES (?, ?)').run(connectionId, token);
    })();
    return { connectionId, token };
  }

  amend({ user, connectionId, permissions, stepUp, nowMs }) {
    const connection = this.#active(user.id, connectionId);
    if (!connection) throw new GuardError('Connection not found.', 404);
    const issuedAt = new Date(nowMs).toISOString();
    const previous = this.db.prepare('SELECT version FROM consents WHERE id = ?').get(connection.current_consent_id);
    const version = previous.version + 1;

    this.db.transaction(() => {
      this.db.prepare('UPDATE consents SET superseded_at = ? WHERE id = ?').run(issuedAt, connection.current_consent_id);
      const mandate = this.buildMandate({ consentId: randomUUID(), version, connectionId, user, agentId: connection.agent_id, permissions, stepUp, issuedAt });
      this.#insertConsent({ connectionId, version, mandate, issuedAt });
    })();
    return { connectionId, version };
  }

  #active(userId, connectionId) {
    return this.db.prepare("SELECT * FROM agent_connections WHERE id = ? AND user_id = ? AND status = 'active'").get(String(connectionId), userId);
  }

  agentNameFor(userId, connectionId) {
    const row = this.#active(userId, connectionId);
    return row && demoAgent(row.agent_id).shortName;
  }

  agentIdFor(userId, connectionId) {
    return this.#active(userId, connectionId)?.agent_id;
  }

  revoke(userId, connectionId, nowMs) {
    if (!this.#active(userId, connectionId)) return false;
    const at = new Date(nowMs).toISOString();
    this.db.transaction(() => {
      this.db.prepare("UPDATE agent_connections SET status = 'revoked', revoked_at = ? WHERE id = ?").run(at, connectionId);
      this.db.prepare('UPDATE tokens SET revoked_at = ? WHERE connection_id = ?').run(at, connectionId);
      this.db.prepare('DELETE FROM mock_agent_credentials WHERE connection_id = ?').run(connectionId);
    })();
    return true;
  }

  // The token the mock agent presents. Only the mock agent's run is started with it.
  mockAgentToken(userId, connectionId) {
    if (!this.#active(userId, connectionId)) return null;
    return this.db.prepare('SELECT token FROM mock_agent_credentials WHERE connection_id = ?').get(connectionId)?.token ?? null;
  }

  #verifiedPermissions(consent, connectionId) {
    if (!this.signer.verify(consent.mandate_json, consent.signature)) return null;
    const mandate = JSON.parse(consent.mandate_json);
    return mandate.connectionId === connectionId ? mandate.permissions : null;
  }

  #checkConsent(connection, nowMs) {
    const consent = this.db.prepare('SELECT * FROM consents WHERE id = ?').get(connection.current_consent_id);
    const permissions = consent && this.#verifiedPermissions(consent, connection.id);
    if (!permissions) return { problem: { code: 'no_access', reason: 'The signed consent could not be verified.' } };
    if (nowMs >= Date.parse(permissions.connectionExpiresAt)) {
      return { problem: { code: 'no_access', reason: 'This agent\'s connection has expired.' } };
    }
    return { permissions };
  }

  #publicConnection(row) {
    const agent = demoAgent(row.agent_id);
    return { id: row.id, agentId: agent.id, shortName: agent.shortName, companyId: agent.companyId };
  }

  // Runs on every purchase: the token, then the connection, then the signed consent behind it.
  authorize(userId, token, nowMs) {
    if (typeof token !== 'string' || !token) return NO_ACCESS;
    const row = this.db.prepare(`SELECT c.*, t.revoked_at AS token_revoked_at FROM tokens t
      JOIN agent_connections c ON c.id = t.connection_id
      WHERE t.token_hash = ? AND c.user_id = ?`).get(sha256(token), userId);
    if (!row || row.status !== 'active' || row.token_revoked_at) return NO_ACCESS;
    const { problem, permissions } = this.#checkConsent(row, nowMs);
    if (problem) return { problem, connection: this.#publicConnection(row) };
    this.db.prepare('UPDATE agent_connections SET last_activity_at = ? WHERE id = ?').run(new Date(nowMs).toISOString(), row.id);
    return { connection: this.#publicConnection(row), limits: permissions };
  }

  limits(userId, connectionId, nowMs) {
    const row = this.#active(userId, connectionId);
    if (!row) return null;
    return this.#checkConsent(row, nowMs).permissions ?? null;
  }

  list(userId, nowMs, spend = {}) {
    const rows = this.db.prepare(`SELECT c.*, t.last4, s.mandate_json, s.signature, s.key_id, s.version, s.id AS consent_id, s.created_at AS signed_at
      FROM agent_connections c
      JOIN tokens t ON t.connection_id = c.id
      JOIN consents s ON s.id = c.current_consent_id
      WHERE c.user_id = ? ORDER BY c.connected_at DESC`).all(userId);
    return rows.map((row) => {
      const agent = demoAgent(row.agent_id);
      const verified = this.signer.verify(row.mandate_json, row.signature);
      const { permissions } = JSON.parse(row.mandate_json);
      let status = row.status;
      if (status === 'active' && nowMs >= Date.parse(permissions.connectionExpiresAt)) status = 'expired';
      return {
        id: row.id,
        agentId: agent.id,
        name: agent.name,
        shortName: agent.shortName,
        icon: agent.icon,
        companyName: AGENT_COMPANIES.find((c) => c.id === agent.companyId).name,
        status,
        connectedAt: row.connected_at,
        revokedAt: row.revoked_at,
        lastActivityAt: row.last_activity_at,
        spentCents: spend[row.id] ?? 0,
        token: masked(row.last4),
        permissions,
        consent: { id: row.consent_id, version: row.version, signedAt: row.signed_at, keyId: row.key_id, signature: row.signature, mandateJson: row.mandate_json, verified },
      };
    });
  }
}
