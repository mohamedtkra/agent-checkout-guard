import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MockAgent } from '../src/agent.js';
import { evaluate, GuardError } from '../src/guard.js';
import { approveAll, createGuard } from '../testing/harness.js';

const RULES = { budgetCents: 10000, approvalCents: 5000 };

function activeGuard(rules = RULES) {
  const guard = createGuard();
  guard.setRules(rules);
  guard.grantAccess();
  return guard;
}

const checkout = (guard, purchase) => guard.checkout({
  token: guard.agentToken(),
  purchaseId: purchase.id,
  merchantId: purchase.merchantId,
  item: purchase.item,
  amountCents: purchase.amountCents,
});

function buy(guard, amountCents, merchantId = 'grocer') {
  const purchase = guard.attempt({ token: guard.agentToken(), merchantId, item: 'Item', amountCents });
  return purchase.status === 'authorized' ? checkout(guard, purchase) : purchase;
}

test('a purchase exactly at the approval amount is allowed', () => {
  assert.equal(evaluate(RULES, 5000).outcome, 'allow');
});

test('a purchase above the approval amount needs approval', () => {
  assert.equal(evaluate(RULES, 5001).outcome, 'approval');
});

test('purchases that cannot be checked are blocked', () => {
  assert.equal(evaluate(null, 100).outcome, 'block');
  assert.equal(evaluate({ ...RULES, budgetCents: 'lots' }, 100).outcome, 'block');
  assert.equal(evaluate(RULES, -100).outcome, 'block');
  assert.equal(evaluate(RULES, Number.NaN).outcome, 'block');
});

test('invalid rules are refused and the old rules stay in place', () => {
  const guard = activeGuard();
  assert.throws(() => guard.setRules({ ...RULES, approvalCents: -1 }), GuardError);
  assert.deepEqual(guard.rules, RULES);
});

test('any merchant can be bought from, whatever its category', () => {
  const guard = activeGuard();
  for (const merchantId of ['grocer', 'market', 'pharmacy', 'wellness', 'electronics', 'audio']) {
    assert.equal(buy(guard, 100 + merchantId.length, merchantId).status, 'completed', merchantId);
  }
});

test('an allowed purchase is charged and counted against the allocation', () => {
  const guard = activeGuard();
  assert.equal(buy(guard, 2000).status, 'completed');
  assert.equal(guard.snapshot().spentCents, 2000);
  assert.equal(guard.snapshot().remainingCents, 8000);
});

test('approving does not charge the purchase, and denying ends it', () => {
  const guard = activeGuard();
  const approved = guard.decide(buy(guard, 6000).id, true);
  assert.equal(guard.snapshot().spentCents, 0);
  assert.equal(checkout(guard, approved).status, 'completed');
  assert.equal(guard.snapshot().spentCents, 6000);

  const second = activeGuard();
  const denied = second.decide(buy(second, 6000).id, false);
  assert.equal(denied.status, 'denied');
  assert.equal(second.snapshot().spentCents, 0);
  assert.equal(second.snapshot().heldCents, 0);
});

test('a purchase cannot be decided twice', () => {
  const guard = activeGuard();
  const purchase = buy(guard, 6000);
  guard.decide(purchase.id, true);
  assert.throws(() => guard.decide(purchase.id, true), (error) => error.status === 409);
  assert.equal(guard.snapshot().spentCents, 0);
});

test('revoking blocks the old token and cancels pending purchases', () => {
  const guard = activeGuard();
  const token = guard.agentToken();
  const pending = buy(guard, 6000);
  guard.revokeAccess();

  assert.equal(guard.purchases.find((p) => p.id === pending.id).status, 'canceled');
  assert.throws(() => guard.decide(pending.id, true), (error) => error.status === 409);
  const attempt = guard.attempt({ token, merchantId: 'grocer', item: 'Item', amountCents: 100 });
  assert.equal(attempt.status, 'blocked');
  assert.equal(attempt.code, 'no_access');
  assert.equal(guard.snapshot().spentCents, 0);
});

test('a token from before revocation fails after access is given again', () => {
  const guard = activeGuard();
  const oldToken = guard.agentToken();
  guard.revokeAccess();
  guard.grantAccess();
  const attempt = guard.attempt({ token: oldToken, merchantId: 'grocer', item: 'Item', amountCents: 100 });
  assert.equal(attempt.status, 'blocked');
});

test('every attempt appears in the log', () => {
  const guard = activeGuard();
  buy(guard, 2000);
  buy(guard, 100, 'electronics');
  const messages = guard.log.map((entry) => entry.message).join('\n');
  assert.match(messages, /Thistlewick Pantry/);
  assert.match(messages, /Voltwren Gadgets/);
});

async function untilPending(guard) {
  while (!guard.purchases.some((p) => p.status === 'pending')) {
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  return guard.purchases.find((p) => p.status === 'pending');
}

test('the mock agent exercises each outcome with the default rules', async () => {
  const guard = createGuard();
  guard.grantAccess();
  await approveAll(guard, new MockAgent(guard, { stepMs: 0 }).run(guard.agentToken()));

  assert.deepEqual(guard.purchases.map((p) => p.status), ['completed', 'completed', 'completed', 'completed', 'completed', 'blocked']);
  assert.equal(guard.purchases[5].reason, 'Declined at checkout: your $500 agent limit has $294.26 left.');
  assert.equal(guard.snapshot().spentCents, 20574);
  assert.equal(guard.agentStatus.running, false);
});

test('the mock agent stops after access is revoked mid-run', async () => {
  const guard = createGuard();
  guard.grantAccess();
  const run = new MockAgent(guard, { stepMs: 0 }).run(guard.agentToken());
  await untilPending(guard);
  guard.revokeAccess();
  await run;

  assert.equal(guard.purchases.at(-1).code, 'no_access');
  assert.equal(guard.purchases.length, 5);
  assert.equal(guard.snapshot().spentCents, 8574);
});

test('the mock agent cannot pay without access', async () => {
  const guard = createGuard();
  await new MockAgent(guard, { stepMs: 0 }).run(guard.agentToken());
  assert.equal(guard.purchases.length, 1);
  assert.equal(guard.purchases[0].status, 'blocked');
});
