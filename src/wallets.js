import { MockAgent } from '../engine/agent.js';
import { APPROVAL_EXPIRY_DAYS, demoAgent } from './connections.js';
import { GuardError } from '../engine/errors.js';
import { Guard } from '../engine/guard.js';

// One guard and mock agent per customer, loaded from SQLite the first time they are needed.
export class Wallets {
  #wallets = new Map();

  constructor({ db, connections, stepMs, agentDirectory, features }) {
    this.db = db;
    this.connections = connections;
    this.stepMs = stepMs;
    this.agentDirectory = agentDirectory;
    this.features = features;
  }

  get(userId) {
    if (!this.#wallets.has(userId)) this.#wallets.set(userId, this.#load(userId));
    return this.#wallets.get(userId);
  }

  #load(userId) {
    const { db } = this;
    const row = db.prepare('SELECT state_json FROM wallet_state WHERE user_id = ?').get(userId);
    const saved = row ? JSON.parse(row.state_json) : null;
    const log = db.prepare('SELECT entry_id, at, actor, message, purchase_id, flagged FROM audit_log WHERE user_id = ? AND id > ? ORDER BY id')
      .all(userId, saved?.auditFloor ?? 0)
      .map((entry) => ({ id: entry.entry_id, at: entry.at, actor: entry.actor, message: entry.message, purchaseId: entry.purchase_id, flagged: Boolean(entry.flagged) }));

    const guard = new Guard({
      connections: this.connections.forUser(userId),
      agentDirectory: this.agentDirectory,
      features: this.features,
      saved,
      log,
      persist: (state) => db.prepare(`INSERT INTO wallet_state (user_id, state_json, updated_at) VALUES (?, ?, ?)
        ON CONFLICT (user_id) DO UPDATE SET state_json = excluded.state_json, updated_at = excluded.updated_at`)
        .run(userId, JSON.stringify(state), new Date().toISOString()),
      appendAudit: (entry) => Number(db.prepare(`INSERT INTO audit_log (entry_id, user_id, at, actor, message, purchase_id, flagged)
        VALUES (?, ?, ?, ?, ?, ?, ?)`).run(entry.id, userId, entry.at, entry.actor, entry.message, entry.purchaseId, entry.flagged ? 1 : 0).lastInsertRowid),
    });
    const agent = new MockAgent(guard, this.stepMs === undefined ? {} : { stepMs: this.stepMs });
    return { guard, agent };
  }

  sweepApprovals() {
    for (const { guard } of this.#wallets.values()) guard.checkApprovals();
  }

  // The subject is fixed when the step-up starts, so a code for one agent can't authorize another.
  #targetAgentId(user, subject) {
    const [kind, id] = subject.split(/:(.*)/s);
    const agentId = kind === 'connect' ? id : this.connections.agentIdFor(user.id, id);
    if (!agentId) throw new GuardError('Connection not found.', 404);
    return { kind, id, agentId };
  }

  previewConsent({ user, grant, input }) {
    const { guard } = this.get(user.id);
    const permissions = guard.validatePermissions(input);
    const { agentId } = this.#targetAgentId(user, grant.subject);
    return {
      agent: demoAgent(agentId),
      mandate: this.connections.buildMandate({
        consentId: 'preview',
        version: 0,
        connectionId: 'preview',
        user,
        agentId,
        permissions,
        stepUp: { challengeId: grant.challengeId, verifiedAt: grant.verifiedAt },
        issuedAt: new Date(guard.nowMs()).toISOString(),
      }),
      approvalExpiryDays: APPROVAL_EXPIRY_DAYS,
    };
  }

  allowConsent({ user, grant, input }) {
    const { guard } = this.get(user.id);
    const permissions = guard.validatePermissions(input);
    const { kind, id, agentId } = this.#targetAgentId(user, grant.subject);
    const agent = demoAgent(agentId);
    const stepUp = { challengeId: grant.challengeId, verifiedAt: grant.verifiedAt };
    const nowMs = guard.nowMs();
    if (kind === 'connect') {
      this.connections.link({ user, agentId, permissions, stepUp, nowMs });
      guard.recordEvent('security', `Signed consent and connected ${agent.shortName} after step-up. It has its own test card token.`);
    } else {
      const { version } = this.connections.amend({ user, connectionId: id, permissions, stepUp, nowMs });
      guard.recordEvent('security', `Signed consent version ${version} and updated ${agent.shortName}'s permissions after step-up.`);
    }
  }
}
