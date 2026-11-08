import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MockAgent, UNCLEARED_CHARGE } from '../engine/agent.js';
import { Wallets } from '../src/wallets.js';
import { createGuard, createStore, createUser, linkAgent } from '../testing/harness.js';

const RULES = { budgetCents: 50000, approvalCents: 50000 };

function setup(rules = RULES, { settle = true } = {}) {
  const guard = createGuard();
  guard.setRules(rules);
  guard.grantAccess('agent-a');
  guard.autoSettle = settle;
  return guard;
}

let counter = 0;
const intent = (guard, amountCents, token = guard.agentToken()) =>
  guard.attempt({ token, merchantId: 'grocer', item: `Item ${counter += 1}`, amountCents });

const execute = (guard, purchase, changes = {}, token = guard.agentToken()) => guard.checkout({
  token,
  purchaseId: purchase.id,
  merchantId: purchase.merchantId,
  item: purchase.item,
  amountCents: purchase.amountCents,
  ...changes,
});

const buy = (guard, amountCents, token) => execute(guard, intent(guard, amountCents, token), {}, token ?? guard.agentToken());
const logged = (guard, pattern) => guard.log.some((entry) => pattern.test(entry.message));
const totals = ({ allocation }) => [allocation.spentCents, allocation.heldCents, allocation.remainingCents];

test('the demo account has a credit limit, balance, and available credit', () => {
  const { credit } = createGuard().snapshot();
  assert.deepEqual(credit, { creditLimitCents: 500000, balanceCents: 120000, availableCents: 380000 });
});

test('the allocation can equal available credit but never exceed it', () => {
  const guard = createGuard();
  guard.setRules({ ...RULES, budgetCents: 380000 });
  assert.throws(() => guard.setRules({ ...RULES, budgetCents: 380001 }), /\$3800\.00 available credit/);
  assert.equal(guard.rules.budgetCents, 380000);
});

test('agent shares are validated against the allocation', () => {
  const guard = createGuard();
  guard.setRules({ ...RULES, agentShares: { 'agent-a': 30000, 'agent-b': 20000 } });
  assert.throws(() => guard.setRules({ ...RULES, agentShares: { 'agent-a': 30000, 'agent-b': 20001 } }), /add up to \$500\.01/);
  assert.throws(() => guard.setRules({ ...RULES, agentShares: { nobody: 100 } }), /known agents/);
  assert.throws(() => guard.setRules({ ...RULES, agentShares: { 'agent-a': -1 } }), /known agents/);
  assert.throws(() => guard.setRules({ ...RULES, agentShares: [] }), /not valid/);
  assert.deepEqual(guard.agentShares, { 'agent-a': 30000, 'agent-b': 20000 });
});

test('a cleared intent and a pending intent reserve nothing', () => {
  const guard = setup({ ...RULES, approvalCents: 5000 });
  assert.equal(intent(guard, 6000).status, 'pending');
  assert.equal(intent(guard, 1000).status, 'authorized');
  const snapshot = guard.snapshot();
  assert.deepEqual(snapshot.holds, []);
  assert.deepEqual(totals(snapshot), [0, 0, 50000]);
  assert.equal(logged(guard, /Placed a/), false);
});

test('approving an intent reserves nothing', () => {
  const guard = setup({ ...RULES, approvalCents: 5000 });
  guard.decide(intent(guard, 6000).id, true);
  assert.deepEqual(totals(guard.snapshot()), [0, 0, 50000]);
});

test('intents over the limit are accepted until they are executed', () => {
  const guard = setup({ ...RULES, budgetCents: 1000, approvalCents: 1000 });
  assert.equal(intent(guard, 900).status, 'authorized');
  assert.equal(intent(guard, 950).status, 'authorized');
});

test('executing a purchase places a hold with an expiry date', () => {
  const guard = setup(RULES, { settle: false });
  const held = execute(guard, intent(guard, 7000));
  assert.equal(held.status, 'held');
  const snapshot = guard.snapshot();
  assert.deepEqual(totals(snapshot), [0, 7000, 43000]);
  assert.deepEqual(snapshot.holds.map((h) => h.amountCents), [7000]);
  assert.ok(Date.parse(snapshot.holds[0].expiresAt) > Date.now());
  assert.ok(logged(guard, /Placed a \$70\.00 hold/));
});

test('settling turns the hold into a charge without releasing it', () => {
  const guard = setup(RULES, { settle: false });
  const held = execute(guard, intent(guard, 7000));
  assert.equal(guard.settleCharge(held.id).status, 'completed');
  assert.deepEqual(totals(guard.snapshot()), [7000, 0, 43000]);
  assert.equal(logged(guard, /Released/), false);
  assert.equal(guard.settleCharge(held.id), null);
});

test('a purchase over the allocation is declined at checkout with what is left', () => {
  const guard = setup(RULES, { settle: false });
  guard.settleCharge(buy(guard, 30000).id);
  buy(guard, 16000);
  const result = buy(guard, 4001);
  assert.equal(result.status, 'blocked');
  assert.equal(result.code, 'allocation');
  assert.equal(result.reason, 'Declined at checkout: your $500 agent limit has $40 left.');
  assert.ok(logged(guard, /Declined Item \d+ at checkout: your \$500 agent limit has \$40 left\./));
});

test('a purchase can use the allocation exactly', () => {
  const guard = setup();
  assert.equal(buy(guard, 50000).status, 'completed');
  assert.equal(buy(guard, 1).code, 'allocation');
});

test('a purchase over available credit is declined at checkout', () => {
  const guard = setup();
  guard.credit.balanceCents = 480000;
  const result = buy(guard, 20001);
  assert.equal(result.code, 'credit');
  assert.equal(result.reason, 'Declined at checkout: your $200 available credit has $200 left.');
});

test('an agent cannot go beyond its share, even with allocation left', () => {
  const guard = setup({ ...RULES, agentShares: { 'agent-a': 30000, 'agent-b': 20000 } });
  const b = linkAgent(guard.store, guard.user, 'agent-b');
  assert.equal(buy(guard, 29000).status, 'completed');
  const result = buy(guard, 1001);
  assert.equal(result.code, 'agent_share');
  assert.equal(result.reason, "Declined at checkout: ChatGPT's $300 share has $10 left.");
  assert.equal(buy(guard, 20000, b.token).status, 'completed');
});

test('once split, an agent without a share cannot spend', () => {
  const guard = setup({ ...RULES, agentShares: { 'agent-b': 20000 } });
  const result = buy(guard, 100);
  assert.equal(result.code, 'agent_share');
  assert.match(result.reason, /ChatGPT has no share of your \$500 agent limit/);
});

test('a purchase over the agent\'s consent budget is declined at checkout', () => {
  const guard = setup();
  const b = linkAgent(guard.store, guard.user, 'agent-b', { budgetCents: 1000 });
  const result = buy(guard, 1500, b.token);
  assert.equal(result.code, 'consent');
  assert.equal(result.reason, "Declined at checkout: Gemini's $10 consent budget has $10 left.");
});

test('an approved purchase can still fail if the limit is used up first', () => {
  const guard = setup({ ...RULES, approvalCents: 5000 });
  const approved = guard.decide(intent(guard, 40000).id, true);
  guard.decide(intent(guard, 30000).id, true);
  const other = guard.purchases.at(-1);
  assert.equal(execute(guard, other).status, 'completed');
  const result = execute(guard, approved);
  assert.equal(result.status, 'blocked');
  assert.equal(result.reason, 'Declined at checkout: your $500 agent limit has $200 left.');
});

test('an active hold counts against later purchases', () => {
  const guard = setup({ ...RULES, budgetCents: 1000 }, { settle: false });
  buy(guard, 800);
  assert.equal(buy(guard, 300).reason, 'Declined at checkout: your $10 agent limit has $2 left.');
});

test('a hold that never settles expires and is released', () => {
  const guard = setup(RULES, { settle: false });
  const held = execute(guard, intent(guard, 1000));
  guard.advanceDay();
  guard.advanceDay();
  guard.advanceDay();
  assert.equal(guard.getPurchase(held.id).status, 'canceled');
  assert.deepEqual(totals(guard.snapshot()), [0, 0, 50000]);
  assert.ok(logged(guard, /Released the \$10\.00 hold/));
});

test('a cleared intent that is never executed expires', () => {
  const guard = setup();
  const cleared = intent(guard, 1000);
  guard.advanceDay();
  guard.advanceDay();
  guard.advanceDay();
  assert.equal(guard.getPurchase(cleared.id).status, 'canceled');
});

test('revoking releases only that agent\'s holds', () => {
  const guard = setup(RULES, { settle: false });
  const b = linkAgent(guard.store, guard.user, 'agent-b');
  buy(guard, 1000);
  buy(guard, 2000, b.token);
  guard.revokeConnection(guard.connectionId);
  assert.deepEqual(totals(guard.snapshot()), [0, 2000, 48000]);
  assert.deepEqual(guard.snapshot().holds.map((h) => h.agentName), ['Gemini']);
});

test('a lower final price holds only the lower amount', () => {
  const guard = setup(RULES, { settle: false });
  const held = execute(guard, intent(guard, 10000), { amountCents: 7500 });
  assert.equal(held.amountCents, 7500);
  assert.deepEqual(totals(guard.snapshot()), [0, 7500, 42500]);
});

test('a blocked purchase never places a hold', () => {
  const guard = setup();
  guard.attempt({ token: 'not-a-token', merchantId: 'grocer', item: 'Blocked', amountCents: 100 });
  buy(guard, 60000);
  assert.equal(logged(guard, /Placed a/), false);
  assert.equal(logged(guard, /Released/), false);
});

test('a refund frees up allocation', () => {
  const guard = setup();
  const paid = buy(guard, 50000);
  assert.equal(buy(guard, 1).code, 'allocation');
  const { id } = guard.reportProblem(paid.id, { reason: 'other' });
  guard.advanceRefund(id);
  guard.advanceRefund(id);
  guard.advanceRefund(id, 'refunded');
  assert.equal(buy(guard, 50000).status, 'completed');
});

test('a charge past the allocation that slips through is flagged', () => {
  const guard = setup({ ...RULES, budgetCents: 10000 });
  assert.match(guard.recordUnclearedCharge(UNCLEARED_CHARGE).reason, /agent limit/);
  assert.equal(guard.paused, true);
});

test('spending by agent shows allocation, spent, on hold, and remaining', () => {
  const guard = setup({ ...RULES, agentShares: { 'agent-a': 30000, 'agent-b': 20000 } }, { settle: false });
  const b = linkAgent(guard.store, guard.user, 'agent-b');
  guard.settleCharge(buy(guard, 10000).id);
  buy(guard, 5000);
  buy(guard, 2000, b.token);
  const rows = guard.snapshot().spendingByAgent.map((r) => [r.name, r.allocationCents, r.spentCents, r.heldCents, r.remainingCents, r.shared]);
  assert.deepEqual(rows, [
    ['ChatGPT (OpenAI)', 30000, 10000, 5000, 15000, false],
    ['Gemini (Google)', 20000, 0, 2000, 18000, false],
  ]);
});

test('without a split, each agent shows the shared allocation', () => {
  const guard = setup();
  buy(guard, 10000);
  const [row] = guard.snapshot().spendingByAgent;
  assert.deepEqual([row.allocationCents, row.spentCents, row.remainingCents, row.shared], [50000, 10000, 40000, true]);
});

test('the mock agent settles its purchases after a delay, leaving holds visible until then', async () => {
  const guard = setup(RULES, { settle: false });
  const agent = new MockAgent(guard, { stepMs: 1, list: [{ merchantId: 'grocer', item: 'Delayed', amountCents: 1000 }] });
  await agent.run(guard.agentToken());
  assert.deepEqual(totals(guard.snapshot()), [0, 1000, 49000]);
  await new Promise((resolve) => { setTimeout(resolve, 20); });
  assert.deepEqual(totals(guard.snapshot()), [1000, 0, 49000]);
});

// Every purchase starts on its own timer turn, released together once all are waiting.
function fireTogether(count, fire) {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const purchases = Array.from({ length: count }, async (_, index) => {
    await gate;
    await new Promise((resolve) => { setImmediate(resolve); });
    return fire(index);
  });
  release();
  return Promise.all(purchases);
}

test('10 purchases executed at once can never exceed the allocation', async () => {
  const guard = setup(RULES, { settle: false });
  const intents = Array.from({ length: 10 }, () => intent(guard, 12000));
  assert.ok(intents.every((i) => i.status === 'authorized'));
  assert.deepEqual(totals(guard.snapshot()), [0, 0, 50000]);

  const results = await fireTogether(10, (index) => execute(guard, intents[index]));
  const held = results.filter((r) => r.status === 'held');
  assert.equal(held.length, 4);
  assert.ok(results.filter((r) => r.status === 'blocked').every((r) => r.code === 'allocation'));
  const { allocation } = guard.snapshot();
  assert.equal(allocation.heldCents, 48000);

  held.forEach((r) => guard.settleCharge(r.id));
  const settled = guard.snapshot().allocation;
  assert.equal(settled.spentCents, 48000);
  assert.ok(settled.spentCents + settled.heldCents <= settled.totalCents);
});

test('10 purchases executed at once that exactly fill the allocation all fit', async () => {
  const guard = setup(RULES, { settle: false });
  const intents = Array.from({ length: 10 }, () => intent(guard, 5000));
  const results = await fireTogether(10, (index) => execute(guard, intents[index]));
  assert.equal(results.filter((r) => r.status === 'held').length, 10);
  assert.equal(buy(guard, 1).code, 'allocation');
});

test('10 purchases executed at once across two agents respect every limit', async () => {
  const guard = setup({ ...RULES, agentShares: { 'agent-a': 30000, 'agent-b': 20000 } }, { settle: false });
  const b = linkAgent(guard.store, guard.user, 'agent-b');
  const token = (index) => (index % 2 ? b.token : guard.agentToken());
  const intents = Array.from({ length: 10 }, (_, index) => intent(guard, 11000, token(index)));
  const results = await fireTogether(10, (index) => execute(guard, intents[index], {}, token(index)));
  const held = results.filter((r) => r.status === 'held');
  assert.ok(held.reduce((sum, r) => sum + r.amountCents, 0) <= 50000);
  assert.equal(held.filter((r) => r.agentId === 'agent-a').length, 2);
  assert.equal(held.filter((r) => r.agentId === 'agent-b').length, 1);
});

test('checkout stays synchronous, so checking and placing a hold cannot interleave', () => {
  const guard = setup();
  assert.equal(guard.checkout.constructor.name, 'Function');
});

test('after a restart, intents are canceled and executed purchases settle', () => {
  const store = createStore();
  const user = createUser(store.db);
  const { token } = linkAgent(store, user, 'agent-a');
  const { guard } = new Wallets({ ...store, stepMs: 0, features: { agentVerification: false } }).get(user.id);
  guard.setRules({ ...RULES, budgetCents: 40000, agentShares: { 'agent-a': 30000 } });
  const held = guard.attempt({ token, merchantId: 'grocer', item: 'Executed', amountCents: 1000 });
  guard.checkout({ token, purchaseId: held.id, merchantId: 'grocer', item: 'Executed', amountCents: 1000 });
  const open = guard.attempt({ token, merchantId: 'grocer', item: 'Open', amountCents: 500 });

  const restored = new Wallets({ ...store, stepMs: 0, features: { agentVerification: false } }).get(user.id).guard;
  assert.equal(restored.getPurchase(open.id).status, 'canceled');
  assert.equal(restored.getPurchase(held.id).status, 'completed');
  const { allocation, agentShares, credit } = restored.snapshot();
  assert.deepEqual([allocation.totalCents, allocation.spentCents, allocation.heldCents], [40000, 1000, 0]);
  assert.deepEqual(agentShares, { 'agent-a': 30000 });
  assert.equal(credit.availableCents, 380000);
});

test('state saved by an older version still loads', () => {
  const store = createStore();
  const user = createUser(store.db);
  const wallets = new Wallets({ ...store, stepMs: 0, features: { agentVerification: false } });
  wallets.get(user.id).guard.setRules(RULES);
  const row = store.db.prepare('SELECT state_json FROM wallet_state WHERE user_id = ?').get(user.id);
  const { credit, agentShares, ...older } = JSON.parse(row.state_json);
  assert.ok(credit && agentShares);
  older.rules.allowedMerchantIds = ['grocer'];
  older.merchantAgents = { grocer: [] };
  store.db.prepare('UPDATE wallet_state SET state_json = ? WHERE user_id = ?').run(JSON.stringify(older), user.id);
  const restored = new Wallets({ ...store, stepMs: 0, features: { agentVerification: false } }).get(user.id).guard;
  assert.equal(restored.snapshot().credit.availableCents, 380000);
  assert.deepEqual(restored.agentShares, {});
});
