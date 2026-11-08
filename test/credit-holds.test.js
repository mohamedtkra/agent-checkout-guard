import assert from 'node:assert/strict';
import { test } from 'node:test';
import { UNCLEARED_CHARGE } from '../src/agent.js';
import { Wallets } from '../src/wallets.js';
import { createGuard, createStore, createUser, linkAgent } from '../testing/harness.js';

const RULES = { budgetCents: 50000, allowedMerchantIds: ['grocer'], approvalCents: 50000 };

function setup(rules = RULES) {
  const guard = createGuard();
  guard.setRules(rules);
  guard.grantAccess('agent-a');
  return guard;
}

let counter = 0;
const intent = (guard, amountCents, token = guard.agentToken()) =>
  guard.attempt({ token, merchantId: 'grocer', item: `Item ${counter += 1}`, amountCents });

const finalize = (guard, purchase, changes = {}, token = guard.agentToken()) => guard.checkout({
  token,
  purchaseId: purchase.id,
  merchantId: purchase.merchantId,
  item: purchase.item,
  amountCents: purchase.amountCents,
  ...changes,
});

const logged = (guard, pattern) => guard.log.some((entry) => pattern.test(entry.message));

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

test('lowering the allocation below the shares is refused', () => {
  const guard = createGuard();
  guard.setRules({ ...RULES, agentShares: { 'agent-a': 30000 } });
  assert.throws(() => guard.setRules({ ...RULES, budgetCents: 20000 }), /more than your \$200\.00/);
});

test('both a held and a cleared intent place a hold immediately', () => {
  const guard = setup({ ...RULES, approvalCents: 5000 });
  const held = intent(guard, 6000);
  const cleared = intent(guard, 1000);
  assert.equal(held.status, 'pending');
  assert.equal(cleared.status, 'authorized');
  const { holds, allocation } = guard.snapshot();
  assert.deepEqual(holds.map((h) => h.amountCents), [6000, 1000]);
  assert.ok(holds.every((h) => h.expiresAt));
  assert.deepEqual([allocation.totalCents, allocation.spentCents, allocation.heldCents, allocation.remainingCents], [50000, 0, 7000, 43000]);
  assert.ok(logged(guard, /Placed a \$60\.00 hold/));
});

test('an intent over the allocation is blocked with the amount already used', () => {
  const guard = setup();
  finalize(guard, intent(guard, 30000));
  intent(guard, 13000);
  const result = intent(guard, 7001);
  assert.equal(result.status, 'blocked');
  assert.equal(result.code, 'allocation');
  assert.equal(result.reason, 'Blocked: would exceed your $500 agent limit ($430 already used or on hold)');
  assert.ok(logged(guard, /Blocked Item \d+: would exceed your \$500 agent limit/));
});

test('an intent can use the allocation exactly', () => {
  const guard = setup();
  assert.equal(intent(guard, 50000).status, 'authorized');
  assert.equal(intent(guard, 1).code, 'allocation');
});

test('an intent over available credit is blocked', () => {
  const guard = setup();
  guard.credit.balanceCents = 480000;
  const result = intent(guard, 20001);
  assert.equal(result.code, 'credit');
  assert.equal(result.reason, 'Blocked: would exceed your $200 available credit ($0 already used or on hold)');
});

test('an agent cannot go beyond its share, even with allocation left', () => {
  const guard = setup({ ...RULES, agentShares: { 'agent-a': 30000, 'agent-b': 20000 } });
  const b = linkAgent(guard.store, guard.user, 'agent-b');
  assert.equal(intent(guard, 30000).status, 'authorized');
  const result = intent(guard, 1);
  assert.equal(result.code, 'agent_share');
  assert.equal(result.reason, "Blocked: would exceed Demo Agent A's $300 share ($300 already used or on hold)");
  assert.equal(intent(guard, 20000, b.token).status, 'authorized');
  assert.deepEqual(guard.snapshot().allocation.shares.map((s) => s.remainingCents), [0, 0]);
});

test('once split, an agent without a share cannot spend', () => {
  const guard = setup({ ...RULES, agentShares: { 'agent-b': 20000 } });
  const result = intent(guard, 100);
  assert.equal(result.code, 'agent_share');
  assert.match(result.reason, /Demo Agent A has no share of your \$500 agent limit/);
});

test('a denied intent releases its hold', () => {
  const guard = setup({ ...RULES, approvalCents: 5000 });
  guard.decide(intent(guard, 6000).id, false);
  assert.equal(guard.snapshot().allocation.heldCents, 0);
  assert.deepEqual(guard.snapshot().holds, []);
  assert.ok(logged(guard, /Released the \$60\.00 hold/));
});

test('an expired approval releases its hold', () => {
  const guard = setup({ ...RULES, approvalCents: 5000 });
  intent(guard, 6000);
  guard.advanceDay();
  guard.advanceDay();
  assert.equal(guard.snapshot().allocation.heldCents, 6000);
  guard.advanceDay();
  assert.equal(guard.snapshot().allocation.heldCents, 0);
  assert.ok(logged(guard, /Released the \$60\.00 hold/));
});

test('a cleared intent that is never charged expires and releases its hold', () => {
  const guard = setup();
  const cleared = intent(guard, 1000);
  guard.advanceDay();
  guard.advanceDay();
  guard.advanceDay();
  assert.equal(guard.getPurchase(cleared.id).status, 'canceled');
  assert.equal(guard.snapshot().allocation.heldCents, 0);
});

test('revoking releases only that agent\'s holds', () => {
  const guard = setup();
  const b = linkAgent(guard.store, guard.user, 'agent-b');
  intent(guard, 1000);
  intent(guard, 2000, b.token);
  guard.revokeConnection(guard.connectionId);
  assert.equal(guard.snapshot().allocation.heldCents, 2000);
  assert.deepEqual(guard.snapshot().holds.map((h) => h.agentName), ['Demo Agent B']);
});

test('charging for less releases the difference', () => {
  const guard = setup();
  finalize(guard, intent(guard, 10000), { amountCents: 7500 });
  const { allocation } = guard.snapshot();
  assert.deepEqual([allocation.spentCents, allocation.heldCents, allocation.remainingCents], [7500, 0, 42500]);
  assert.ok(logged(guard, /Released \$25\.00 of the hold/));
});

test('a charge turns its hold into spend without releasing it', () => {
  const guard = setup();
  finalize(guard, intent(guard, 10000));
  const { allocation } = guard.snapshot();
  assert.deepEqual([allocation.spentCents, allocation.heldCents], [10000, 0]);
  assert.equal(logged(guard, /Released the \$100\.00 hold/), false);
});

test('a blocked intent never places a hold', () => {
  const guard = setup();
  guard.attempt({ token: guard.agentToken(), merchantId: 'audio', item: 'Blocked', amountCents: 100 });
  assert.equal(logged(guard, /Placed a/), false);
  assert.equal(logged(guard, /Released/), false);
});

test('limits are checked again at final charge', () => {
  const guard = setup();
  const first = intent(guard, 30000);
  const second = intent(guard, 20000);
  guard.setRules({ ...RULES, budgetCents: 40000 });
  // The first charge plus the second purchase's open hold would be $500 against a $400 limit.
  assert.equal(finalize(guard, first).code, 'allocation');
  assert.equal(finalize(guard, second).status, 'completed');
  assert.equal(guard.snapshot().spentCents, 20000);
  assert.equal(guard.snapshot().allocation.heldCents, 0);
});

test('a share lowered after clearance is enforced at final charge', () => {
  const guard = setup();
  const cleared = intent(guard, 20000);
  guard.setRules({ ...RULES, agentShares: { 'agent-a': 10000 } });
  assert.equal(finalize(guard, cleared).code, 'agent_share');
});

test('approval rechecks the limits', () => {
  const guard = setup({ ...RULES, approvalCents: 5000 });
  const held = intent(guard, 30000);
  guard.setRules({ ...RULES, budgetCents: 20000, approvalCents: 5000 });
  assert.equal(guard.decide(held.id, true).code, 'allocation');
});

test('a refund frees up allocation', () => {
  const guard = setup();
  const paid = finalize(guard, intent(guard, 50000));
  assert.equal(intent(guard, 1).code, 'allocation');
  const { id } = guard.reportProblem(paid.id, { reason: 'other' });
  guard.advanceRefund(id);
  guard.advanceRefund(id);
  guard.advanceRefund(id, 'refunded');
  assert.equal(intent(guard, 50000).status, 'authorized');
});

test('a charge past the allocation that slips through is flagged', () => {
  const guard = setup({ ...RULES, budgetCents: 10000 });
  const { amountCents } = UNCLEARED_CHARGE;
  assert.ok(amountCents > 10000);
  assert.match(guard.recordUnclearedCharge(UNCLEARED_CHARGE).reason, /agent limit/);
  assert.equal(guard.paused, true);
});

// Every intent starts on its own timer turn, released together once all ten are waiting.
function fireTogether(count, fire) {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const intents = Array.from({ length: count }, async (_, index) => {
    await gate;
    await new Promise((resolve) => { setImmediate(resolve); });
    return fire(index);
  });
  release();
  return Promise.all(intents);
}

test('10 simultaneous intents can never exceed the allocation', async () => {
  const guard = setup();
  const results = await fireTogether(10, () => intent(guard, 12000));
  const accepted = results.filter((r) => r.status === 'authorized');
  assert.equal(accepted.length, 4);
  assert.ok(results.filter((r) => r.status === 'blocked').every((r) => r.code === 'allocation'));
  assert.equal(guard.snapshot().allocation.heldCents, 48000);

  await fireTogether(accepted.length, (index) => finalize(guard, accepted[index]));
  const { allocation } = guard.snapshot();
  assert.equal(allocation.spentCents, 48000);
  assert.ok(allocation.spentCents + allocation.heldCents <= allocation.totalCents);
});

test('10 simultaneous intents that exactly fill the allocation all fit', async () => {
  const guard = setup();
  const results = await fireTogether(10, () => intent(guard, 5000));
  assert.equal(results.filter((r) => r.status === 'authorized').length, 10);
  assert.equal(intent(guard, 1).code, 'allocation');
});

test('10 simultaneous intents across two agents respect every limit', async () => {
  const guard = setup({ ...RULES, agentShares: { 'agent-a': 30000, 'agent-b': 20000 } });
  const b = linkAgent(guard.store, guard.user, 'agent-b');
  const results = await fireTogether(10, (index) => intent(guard, 11000, index % 2 ? b.token : guard.agentToken()));
  const accepted = results.filter((r) => r.status === 'authorized');
  const total = accepted.reduce((sum, r) => sum + r.amountCents, 0);
  assert.ok(total <= 50000);
  assert.equal(accepted.filter((r) => r.agentId === 'agent-a').length, 2);
  assert.equal(accepted.filter((r) => r.agentId === 'agent-b').length, 1);
});

test('the attempt never yields between checking limits and placing a hold', () => {
  const guard = setup();
  assert.equal(guard.attempt.constructor.name, 'Function');
  assert.equal(guard.checkout.constructor.name, 'Function');
});

test('allocation, shares, and holds are restored after a restart, and open holds release', () => {
  const store = createStore();
  const user = createUser(store.db);
  const { token } = linkAgent(store, user, 'agent-a');
  const { guard } = new Wallets({ ...store, stepMs: 0 }).get(user.id);
  guard.setRules({ ...RULES, budgetCents: 40000, agentShares: { 'agent-a': 30000 } });
  guard.attempt({ token, merchantId: 'grocer', item: 'Held', amountCents: 1000 });
  assert.equal(guard.snapshot().allocation.heldCents, 1000);

  const restored = new Wallets({ ...store, stepMs: 0 }).get(user.id).guard;
  const { allocation, agentShares, credit } = restored.snapshot();
  assert.equal(allocation.totalCents, 40000);
  assert.equal(allocation.heldCents, 0);
  assert.deepEqual(agentShares, { 'agent-a': 30000 });
  assert.equal(credit.availableCents, 380000);
});

test('state saved before allocations existed still loads', () => {
  const store = createStore();
  const user = createUser(store.db);
  const wallets = new Wallets({ ...store, stepMs: 0 });
  const { guard } = wallets.get(user.id);
  guard.setRules(RULES);
  const row = store.db.prepare('SELECT state_json FROM wallet_state WHERE user_id = ?').get(user.id);
  const { credit, agentShares, ...older } = JSON.parse(row.state_json);
  assert.ok(credit && agentShares);
  store.db.prepare('UPDATE wallet_state SET state_json = ? WHERE user_id = ?').run(JSON.stringify(older), user.id);
  const restored = new Wallets({ ...store, stepMs: 0 }).get(user.id).guard;
  assert.equal(restored.snapshot().credit.availableCents, 380000);
  assert.deepEqual(restored.agentShares, {});
});
