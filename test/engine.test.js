import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { MockAgent } from '../engine/agent.js';
import { checkoutPayload } from '../engine/agent-directory.js';
import { createCatalog } from '../engine/catalog.js';
import { FEATURE_IDS, Guard, normalizeFeatures } from '../engine/guard.js';
import { MemoryConnections } from '../engine/memory-connections.js';

const agents = [
  { id: 'a', name: 'Agent A', shortName: 'A', icon: 'a.svg' },
  { id: 'b', name: 'Agent B', shortName: 'B', icon: 'b.svg' },
];
const catalog = createCatalog({
  agents,
  merchants: [{ id: 'shop', name: 'Sample Shop', category: 'Things', logo: 'shop.svg' }, { id: 'other', name: 'Sample Other', category: 'Things', logo: 'other.svg' }],
  categoryIcons: { Things: 't.svg', Other: 'o.svg' },
  products: { Widget: { description: 'A widget.', image: 'widget.svg' } },
});

const DAY_MS = 24 * 60 * 60 * 1000;
const LIMITS = { budgetCents: 1_000_000, approvalCents: 1_000_000 };

function setup(features, rules = { budgetCents: 10000, approvalCents: 5000 }) {
  const connections = new MemoryConnections(agents);
  const guard = new Guard({ connections, catalog, features });
  guard.setRules(rules);
  const link = (id = 'a', limits = LIMITS) => connections.link(id, { ...limits, connectionExpiresAt: new Date(Date.now() + 30 * DAY_MS).toISOString() }, Date.now());
  return { guard, connections, link };
}

let counter = 0;
function buy(guard, token, amountCents) {
  const details = { token, merchantId: 'shop', item: `Item ${counter += 1}`, amountCents };
  const intent = guard.attempt(details);
  if (intent.status !== 'authorized') return intent;
  const signature = guard.agentDirectory.sign(intent.agentId, checkoutPayload({ ...details, purchaseId: intent.id }));
  return guard.checkout({ ...details, purchaseId: intent.id, signature });
}

test('the engine has no Node-only imports, so it can run in a browser', () => {
  const dir = fileURLToPath(new URL('../engine/', import.meta.url));
  for (const file of readdirSync(dir)) {
    const source = readFileSync(`${dir}${file}`, 'utf8');
    assert.doesNotMatch(source, /from '(node:|[a-z])/, file);
    assert.doesNotMatch(source, /require\(|process\./, file);
  }
});

test('every feature is on by default', () => {
  assert.deepEqual(normalizeFeatures(), Object.fromEntries(FEATURE_IDS.map((id) => [id, true])));
});

test('split by agent depends on credit allocation', () => {
  assert.equal(normalizeFeatures({ creditHolds: false }).splitByAgent, false);
});

test('a custom catalog describes purchases', () => {
  const { guard, link } = setup();
  const { token } = link();
  const purchase = guard.attempt({ token, merchantId: 'shop', item: 'Widget', amountCents: 100 });
  assert.equal(purchase.merchantName, 'Sample Shop');
  assert.equal(purchase.category, 'Things');
  assert.equal(purchase.image, 'widget.svg');
  assert.deepEqual(guard.snapshot().merchants.map((m) => m.id), ['shop', 'other']);
  assert.deepEqual(guard.snapshot().demoAgents.map((a) => a.id), ['a', 'b']);
});

test('memory connections give each agent its own token and revoke only one', () => {
  const { connections, link } = setup();
  const a = link('a');
  const b = link('b');
  assert.notEqual(a.token, b.token);
  assert.throws(() => link('a'), (error) => error.status === 409);
  assert.throws(() => link('nobody'), (error) => error.status === 404);
  connections.revoke(a.connectionId, Date.now());
  assert.equal(connections.authorize(a.token, Date.now()).problem.code, 'no_access');
  assert.ok(connections.authorize(b.token, Date.now()).limits);
  assert.equal(connections.tokenFor(a.connectionId), null);
  assert.equal(connections.authorize(null, Date.now()).problem.code, 'no_access');
});

test('memory connections expire, and the list hides full tokens', () => {
  const { connections, guard } = setup();
  const nowMs = Date.now();
  const { token } = connections.link('a', { ...LIMITS, connectionExpiresAt: new Date(nowMs + DAY_MS).toISOString() }, nowMs);
  assert.match(connections.authorize(token, nowMs + DAY_MS).problem.reason, /expired/);
  assert.equal(connections.list(nowMs + DAY_MS)[0].status, 'expired');
  assert.equal(JSON.stringify(guard.snapshot()).includes(token), false);
});

test('with approvals off, a large purchase needs no approval', () => {
  const { guard, link } = setup({ approvals: false });
  assert.equal(buy(guard, link().token, 9000).status, 'held');
});

test('with approvals on, the same purchase waits for the customer', () => {
  const { guard, link } = setup();
  assert.equal(buy(guard, link().token, 9000).status, 'pending');
});

test('with credit holds off, purchases charge at once with no allocation limit', () => {
  const { guard, link } = setup({ creditHolds: false, approvals: false });
  const result = buy(guard, link().token, 900000);
  assert.equal(result.status, 'completed');
  assert.equal(guard.paused, false);
  assert.deepEqual(guard.snapshot().holds, []);
});

test('with credit holds off, the agent consent budget still applies', () => {
  const { guard, link } = setup({ creditHolds: false, approvals: false });
  const { token } = link('a', { budgetCents: 1000, approvalCents: 1000 });
  assert.equal(buy(guard, token, 1500).code, 'consent');
});

test('with split off, shares are ignored', () => {
  const { guard, link } = setup({ splitByAgent: false }, { budgetCents: 10000, approvalCents: 10000, agentShares: { a: 100 } });
  assert.equal(buy(guard, link().token, 5000).status, 'held');
  assert.equal(guard.snapshot().spendingByAgent[0].shared, true);
});

test('with split on, shares are enforced', () => {
  const { guard, link } = setup({}, { budgetCents: 10000, approvalCents: 10000, agentShares: { a: 100 } });
  assert.equal(buy(guard, link().token, 5000).code, 'agent_share');
});

test('with refunds off, a problem cannot be reported', () => {
  const { guard, link } = setup({ refunds: false, creditHolds: false });
  const paid = buy(guard, link().token, 1000);
  assert.throws(() => guard.reportProblem(paid.id, { reason: 'other' }), (error) => error.status === 403);
});

test('with overreach off, an out-of-rules charge is not flagged and nothing pauses', () => {
  const { guard, link } = setup({ overreach: false });
  link();
  const charge = guard.recordUnclearedCharge({ merchantId: 'x', item: 'Mystery', amountCents: 50000 });
  assert.equal(charge.flagged, false);
  assert.equal(guard.paused, false);
});

test('with overreach on, the same charge is flagged and agents pause', () => {
  const { guard, link } = setup();
  link();
  assert.equal(guard.recordUnclearedCharge({ merchantId: 'x', item: 'Mystery', amountCents: 50000 }).flagged, true);
  assert.equal(guard.paused, true);
});

test('a higher final price is blocked whichever blocks are on', () => {
  const { guard, link } = setup({ overreach: false, approvals: false, creditHolds: false, agentVerification: false });
  const { token } = link();
  const details = { token, merchantId: 'shop', item: 'Widget', amountCents: 100 };
  const intent = guard.attempt(details);
  assert.equal(guard.checkout({ ...details, purchaseId: intent.id, amountCents: 200 }).code, 'mismatch');
});

test('the mock agent shops from a custom list, and overreach uses its merchants', async () => {
  const { guard, link } = setup({}, { budgetCents: 10000, approvalCents: 10000 });
  const { token } = link();
  const agent = new MockAgent(guard, { stepMs: 0, list: [{ merchantId: 'shop', item: 'Widget', amountCents: 500 }] });
  await agent.run(token);
  assert.equal(guard.snapshot().spentCents, 500);
  await agent.simulateOverreach(token);
  await agent.simulateOverreach(token);
  assert.equal(guard.purchases.at(-1).code, 'mismatch');
  assert.equal(guard.snapshot().spentCents, 500);
});
