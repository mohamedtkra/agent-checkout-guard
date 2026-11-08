import { randomUUID } from 'node:crypto';
import { DEMO_AGENTS, MERCHANTS } from '../src/catalog.js';
import { Connections, loadSigner } from '../src/connections.js';
import { openDatabase } from '../src/db.js';
import { Guard } from '../src/guard.js';

const PERMISSIVE = {
  budgetCents: 1_000_000_000,
  approvalCents: 1_000_000_000,
  allowedMerchantIds: MERCHANTS.map((m) => m.id),
};

export function createStore() {
  const db = openDatabase(':memory:');
  const signer = loadSigner(null);
  return { db, signer, connections: new Connections(db, signer) };
}

export function createUser(db, email = `${randomUUID()}@demo.example`) {
  const user = { id: randomUUID(), email };
  db.prepare('INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)').run(user.id, email, new Date().toISOString());
  return user;
}

export function linkAgent(store, user, agentId = DEMO_AGENTS[0].id, permissions = {}) {
  return store.connections.link({
    user,
    agentId,
    permissions: {
      ...PERMISSIVE,
      connectionExpiresAt: new Date(Date.now() + 300 * 24 * 60 * 60 * 1000).toISOString(),
      ...permissions,
    },
    stepUp: { challengeId: 'test', verifiedAt: new Date().toISOString() },
    nowMs: Date.now(),
  });
}

// A real guard over a real in-memory database, with shortcuts for connecting one agent.
class TestGuard extends Guard {
  constructor() {
    const store = createStore();
    const user = createUser(store.db);
    super({ connections: store.connections.forUser(user.id) });
    this.store = store;
    this.user = user;
    this.currentToken = null;
    this.connectionId = null;
  }

  grantAccess(agentId, permissions) {
    if (this.currentToken) return;
    const { token, connectionId } = linkAgent(this.store, this.user, agentId, permissions);
    this.currentToken = token;
    this.connectionId = connectionId;
  }

  agentToken() {
    return this.currentToken;
  }

  revokeAccess() {
    this.revokeConnection(this.connectionId);
    this.currentToken = null;
  }
}

export const createGuard = () => new TestGuard();
