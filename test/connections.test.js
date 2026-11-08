import assert from 'node:assert/strict';
import { mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Connections, loadSigner } from '../src/connections.js';
import { openDatabase } from '../src/db.js';
import { Wallets } from '../src/wallets.js';
import { createGuard, createStore, createUser, linkAgent } from '../testing/harness.js';

const DAY_MS = 24 * 60 * 60 * 1000;

function twoAgents(permissionsB) {
  const guard = createGuard();
  guard.grantAccess('agent-a');
  const b = linkAgent(guard.store, guard.user, 'agent-b', permissionsB);
  return { guard, a: { token: guard.agentToken(), connectionId: guard.connectionId }, b };
}

const buy = (guard, token, merchantId = 'grocer', amountCents = 2000, item = 'Item') => {
  const purchase = guard.attempt({ token, merchantId, item, amountCents });
  if (purchase.status !== 'authorized') return purchase;
  return guard.checkout({ token, purchaseId: purchase.id, merchantId, item, amountCents });
};

const consentRow = (guard, connectionId) => guard.store.db
  .prepare('SELECT s.* FROM consents s JOIN agent_connections c ON c.current_consent_id = s.id WHERE c.id = ?').get(connectionId);

test('each agent gets its own token, stored only as a hash', () => {
  const { guard, a, b } = twoAgents();
  assert.notEqual(a.token, b.token);
  assert.match(a.token, /^tok_test_/);
  const stored = JSON.stringify(guard.store.db.prepare('SELECT * FROM tokens').all());
  assert.equal(stored.includes(a.token), false);
});

test('one agent can only be connected once at a time', () => {
  const { guard } = twoAgents();
  assert.throws(() => linkAgent(guard.store, guard.user, 'agent-a'), (error) => error.status === 409);
});

test('the connection stores a signed intent mandate that verifies', () => {
  const { guard, a } = twoAgents();
  const consent = consentRow(guard, a.connectionId);
  const mandate = JSON.parse(consent.mandate_json);
  assert.equal(mandate.type, 'IntentMandate');
  assert.equal(mandate.agent.name, 'ChatGPT (OpenAI)');
  assert.equal(mandate.agent.company, 'OpenAI');
  assert.equal(mandate.permissions.approvalExpiryDays, 3);
  assert.ok(mandate.stepUp.verifiedAt);
  assert.equal(guard.store.signer.verify(consent.mandate_json, consent.signature), true);
  assert.equal(guard.snapshot().connections.find((c) => c.id === a.connectionId).consent.verified, true);
});

test('a tampered consent stops the token from working', () => {
  const { guard, a } = twoAgents();
  const consent = consentRow(guard, a.connectionId);
  const tampered = consent.mandate_json.replace('"budgetCents":1000000000', '"budgetCents":2000000000');
  assert.notEqual(tampered, consent.mandate_json);
  guard.store.db.prepare('UPDATE consents SET mandate_json = ? WHERE id = ?').run(tampered, consent.id);
  const result = guard.attempt({ token: a.token, merchantId: 'grocer', item: 'Item', amountCents: 100 });
  assert.equal(result.code, 'no_access');
  assert.match(result.reason, /could not be verified/);
});

test('a purchase outside the consent is blocked even when the rules allow it', () => {
  const { guard, b } = twoAgents({ budgetCents: 3000 });
  assert.equal(buy(guard, b.token, 'pharmacy', 2500).status, 'completed');
  const over = buy(guard, b.token, 'pharmacy', 600, 'Second');
  assert.equal(over.code, 'consent');
  assert.equal(over.reason, "Declined at checkout: Gemini's $30 consent budget has $5 left.");
});

test('a purchase inside the consent is still blocked by the rules', () => {
  const { guard, a } = twoAgents();
  guard.setRules({ budgetCents: 1000, approvalCents: 5000 });
  assert.equal(buy(guard, a.token, 'grocer', 2000).code, 'allocation');
});

test('the lower approval amount of the consent and the rules applies', () => {
  const { guard, b } = twoAgents({ approvalCents: 1000 });
  const held = guard.attempt({ token: b.token, merchantId: 'grocer', item: 'Item', amountCents: 2000 });
  assert.equal(held.status, 'pending');
});

test('agent budgets are separate', () => {
  const { guard, a, b } = twoAgents({ budgetCents: 2500 });
  assert.equal(buy(guard, a.token, 'grocer', 4000, 'From A').status, 'completed');
  assert.equal(buy(guard, b.token, 'grocer', 2500, 'From B').status, 'completed');
  const spend = Object.fromEntries(guard.snapshot().connections.map((c) => [c.shortName, c.spentCents]));
  assert.deepEqual(spend, { 'ChatGPT': 4000, 'Gemini': 2500 });
});

test('revoking one agent does not affect the others', () => {
  const { guard, a, b } = twoAgents();
  const heldA = guard.attempt({ token: a.token, merchantId: 'grocer', item: 'A held', amountCents: 2100 });
  const heldB = guard.attempt({ token: b.token, merchantId: 'grocer', item: 'B held', amountCents: 2200 });
  guard.revokeConnection(a.connectionId);

  assert.equal(guard.getPurchase(heldA.id).status, 'canceled');
  assert.equal(guard.getPurchase(heldB.id).status, 'authorized');
  assert.equal(guard.attempt({ token: a.token, merchantId: 'grocer', item: 'After', amountCents: 300 }).code, 'no_access');
  assert.equal(guard.attempt({ token: b.token, merchantId: 'grocer', item: 'After', amountCents: 400 }).status, 'authorized');
  const statuses = Object.fromEntries(guard.snapshot().connections.map((c) => [c.shortName, c.status]));
  assert.deepEqual(statuses, { 'ChatGPT': 'revoked', 'Gemini': 'active' });
});

test('a revoked agent can connect again and gets a new token', () => {
  const { guard, a } = twoAgents();
  guard.revokeConnection(a.connectionId);
  const again = linkAgent(guard.store, guard.user, 'agent-a');
  assert.notEqual(again.token, a.token);
  assert.equal(guard.attempt({ token: a.token, merchantId: 'grocer', item: 'Old', amountCents: 100 }).status, 'blocked');
  assert.equal(guard.attempt({ token: again.token, merchantId: 'grocer', item: 'New', amountCents: 100 }).status, 'authorized');
});

test('one customer cannot use or revoke another customer\'s agent', () => {
  const guardOne = createGuard();
  guardOne.grantAccess('agent-a');
  const outsider = createUser(guardOne.store.db);
  const theirs = guardOne.store.connections.forUser(outsider.id);
  assert.ok(theirs.authorize(guardOne.agentToken(), Date.now()).problem);
  assert.equal(theirs.revoke(guardOne.connectionId, Date.now()), false);
  assert.equal(guardOne.store.connections.mockAgentToken(outsider.id, guardOne.connectionId), null);
});

test('a purchase cleared for one agent cannot be charged with another agent\'s token', () => {
  const { guard, a, b } = twoAgents();
  const cleared = guard.attempt({ token: a.token, merchantId: 'grocer', item: 'Item', amountCents: 100 });
  const result = guard.checkout({ token: b.token, purchaseId: cleared.id, merchantId: 'grocer', item: 'Item', amountCents: 100 });
  assert.equal(result.code, 'wrong_token');
  assert.equal(guard.snapshot().spentCents, 0);
});

test('a token stops working when the connection expires', () => {
  const { guard, b } = twoAgents({ connectionExpiresAt: new Date(Date.now() + 1.5 * DAY_MS).toISOString() });
  assert.equal(guard.attempt({ token: b.token, merchantId: 'grocer', item: 'Before', amountCents: 100 }).status, 'authorized');
  guard.advanceDay();
  guard.advanceDay();
  const result = guard.attempt({ token: b.token, merchantId: 'grocer', item: 'After', amountCents: 200 });
  assert.equal(result.code, 'no_access');
  assert.match(result.reason, /expired/);
  assert.equal(guard.snapshot().connections.find((c) => c.shortName === 'Gemini').status, 'expired');
});

test('editing permissions signs a new consent and keeps the token', () => {
  const { guard, a } = twoAgents();
  const before = consentRow(guard, a.connectionId);
  guard.store.connections.amend({
    user: guard.user,
    connectionId: a.connectionId,
    permissions: { budgetCents: 500, approvalCents: 500, connectionExpiresAt: new Date(Date.now() + 5 * DAY_MS).toISOString() },
    stepUp: { challengeId: 'test', verifiedAt: new Date().toISOString() },
    nowMs: Date.now(),
  });
  const after = consentRow(guard, a.connectionId);
  assert.equal(after.version, 2);
  assert.notEqual(after.id, before.id);
  assert.ok(guard.store.db.prepare('SELECT superseded_at FROM consents WHERE id = ?').get(before.id).superseded_at);
  assert.equal(buy(guard, a.token, 'grocer', 400).status, 'completed');
  assert.equal(buy(guard, a.token, 'grocer', 200).code, 'consent');
});

test('a held purchase rechecks the edited consent when approved', () => {
  const { guard, b } = twoAgents({ approvalCents: 1000 });
  const held = guard.attempt({ token: b.token, merchantId: 'grocer', item: 'Item', amountCents: 2000 });
  guard.store.connections.amend({
    user: guard.user,
    connectionId: b.connectionId,
    permissions: { budgetCents: 1000, approvalCents: 1000, connectionExpiresAt: new Date(Date.now() + 5 * DAY_MS).toISOString() },
    stepUp: { challengeId: 'test', verifiedAt: new Date().toISOString() },
    nowMs: Date.now(),
  });
  const approved = guard.decide(held.id, true);
  assert.equal(approved.status, 'authorized');
  const result = guard.checkout({ token: b.token, purchaseId: approved.id, merchantId: 'grocer', item: 'Item', amountCents: 2000 });
  assert.equal(result.code, 'consent');
});

test('last activity is recorded when an agent uses its token', () => {
  const { guard, a, b } = twoAgents();
  guard.attempt({ token: a.token, merchantId: 'grocer', item: 'Item', amountCents: 100 });
  const lastActivity = Object.fromEntries(guard.snapshot().connections.map((c) => [c.id, c.lastActivityAt]));
  assert.ok(lastActivity[a.connectionId]);
  assert.equal(lastActivity[b.connectionId], null);
});

test('consent limits cannot go beyond the customer\'s rules', () => {
  const guard = createGuard();
  const valid = { budgetCents: 1000, approvalCents: 1000, connectionExpiresOn: new Date(Date.now() + 5 * DAY_MS).toISOString().slice(0, 10) };
  assert.equal(guard.validatePermissions(valid).budgetCents, 1000);
  assert.throws(() => guard.validatePermissions({ ...valid, budgetCents: 50001 }), /agent allocation/);
  assert.throws(() => guard.validatePermissions({ ...valid, approvalCents: 9000 }), /Approval amount/);
  assert.throws(() => guard.validatePermissions({ ...valid, connectionExpiresOn: '2020-01-01' }), /within the next/);
  assert.throws(() => guard.validatePermissions({ ...valid, connectionExpiresOn: 'soon' }), /expiry date/);
  assert.throws(() => guard.validatePermissions(null), /missing/);
});

test('data survives a restart, and the signing key is private', () => {
  const dir = mkdtempSync(join(tmpdir(), 'acg-'));
  const dbPath = join(dir, 'test.sqlite');
  const keyPath = join(dir, 'key.pem');
  const open = () => {
    const db = openDatabase(dbPath);
    const connections = new Connections(db, loadSigner(keyPath));
    return { db, connections, wallets: new Wallets({ db, connections, stepMs: 0, features: { agentVerification: false } }) };
  };

  const first = open();
  const user = createUser(first.db);
  const { token, connectionId } = linkAgent(first, user, 'agent-a');
  const { guard } = first.wallets.get(user.id);
  guard.setRules({ budgetCents: 5000, approvalCents: 1000 });
  const paid = buy(guard, token, 'grocer', 900);
  const held = guard.attempt({ token, merchantId: 'grocer', item: 'Held', amountCents: 2000 });
  first.db.close();
  assert.equal(statSync(keyPath).mode & 0o777, 0o600);

  const second = open();
  const restored = second.wallets.get(user.id).guard;
  assert.equal(restored.rules.budgetCents, 5000);
  assert.equal(restored.getPurchase(paid.id).status, 'completed');
  assert.equal(restored.getPurchase(held.id).status, 'canceled');
  assert.ok(restored.log.some((entry) => /Charged \$9\.00/.test(entry.message)));
  const connection = restored.snapshot().connections.find((c) => c.id === connectionId);
  assert.equal(connection.status, 'active');
  assert.equal(connection.spentCents, 900);
  assert.equal(connection.consent.verified, true);
  assert.equal(restored.attempt({ token, merchantId: 'grocer', item: 'After restart', amountCents: 100 }).status, 'authorized');
  second.db.close();
});

test('a reset keeps the audit log and connections', () => {
  const store = createStore();
  const user = createUser(store.db);
  const { token } = linkAgent(store, user, 'agent-a');
  const { guard } = new Wallets({ ...store, stepMs: 0, features: { agentVerification: false } }).get(user.id);
  guard.attempt({ token, merchantId: 'grocer', item: 'Item', amountCents: 100 });
  const before = store.db.prepare('SELECT COUNT(*) AS n FROM audit_log').get().n;
  guard.reset();
  assert.equal(guard.log.length, 0);
  assert.ok(store.db.prepare('SELECT COUNT(*) AS n FROM audit_log').get().n > before);
  assert.equal(guard.snapshot().connections[0].status, 'active');
});

test('the audit log does not contain tokens', () => {
  const { guard, a } = twoAgents();
  buy(guard, a.token, 'grocer', 100);
  assert.equal(JSON.stringify(guard.log).includes(a.token), false);
});
