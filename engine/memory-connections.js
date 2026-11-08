import { GuardError } from './errors.js';

const NO_ACCESS = { problem: { code: 'no_access', reason: 'The agent does not have access.' } };

// The browser's stand-in for the app's SQLite connections: same interface, kept in memory.
export class MemoryConnections {
  #rows = [];

  constructor(agents) {
    this.agents = agents;
  }

  #active(id) {
    return this.#rows.find((row) => row.id === id && row.status === 'active');
  }

  #publicConnection(row) {
    return { id: row.id, agentId: row.agentId, shortName: row.agent.shortName };
  }

  link(agentId, permissions, nowMs) {
    const agent = this.agents.find((a) => a.id === agentId);
    if (!agent) throw new GuardError('Agent not found.', 404);
    if (this.#rows.some((row) => row.agentId === agentId && row.status === 'active')) {
      throw new GuardError('This agent is already connected.', 409);
    }
    const id = globalThis.crypto.randomUUID();
    const token = `tok_test_${globalThis.crypto.randomUUID().replaceAll('-', '')}`;
    this.#rows.push({ id, agentId, agent, token, permissions, status: 'active', connectedAt: new Date(nowMs).toISOString(), lastActivityAt: null, revokedAt: null });
    return { connectionId: id, token };
  }

  tokenFor(connectionId) {
    return this.#active(connectionId)?.token ?? null;
  }

  authorize(token, nowMs) {
    const row = this.#rows.find((candidate) => typeof token === 'string' && candidate.token === token);
    if (!row || row.status !== 'active') return NO_ACCESS;
    if (nowMs >= Date.parse(row.permissions.connectionExpiresAt)) {
      return { problem: { code: 'no_access', reason: 'This agent\'s connection has expired.' }, connection: this.#publicConnection(row) };
    }
    row.lastActivityAt = new Date(nowMs).toISOString();
    return { connection: this.#publicConnection(row), limits: row.permissions };
  }

  limits(connectionId, nowMs) {
    const row = this.#active(connectionId);
    return row && nowMs < Date.parse(row.permissions.connectionExpiresAt) ? row.permissions : null;
  }

  revoke(connectionId, nowMs) {
    const row = this.#active(connectionId);
    if (!row) return false;
    row.status = 'revoked';
    row.revokedAt = new Date(nowMs).toISOString();
    return true;
  }

  list(nowMs, spend = {}) {
    return this.#rows.map((row) => ({
      id: row.id,
      agentId: row.agentId,
      name: row.agent.name,
      shortName: row.agent.shortName,
      icon: row.agent.icon,
      status: row.status === 'active' && nowMs >= Date.parse(row.permissions.connectionExpiresAt) ? 'expired' : row.status,
      connectedAt: row.connectedAt,
      lastActivityAt: row.lastActivityAt,
      spentCents: spend[row.id] ?? 0,
      token: `tok_test_••••${row.token.slice(-4)}`,
      permissions: row.permissions,
    }));
  }
}
