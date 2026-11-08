import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MockAgent } from '../src/agent.js';
import { evaluate, Guard, GuardError } from '../src/guard.js';

const RULES = { budgetCents: 10000, allowedMerchantIds: ['grocer'], approvalCents: 5000 };

function activeGuard(rules = RULES) {
  const guard = new Guard();
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
  assert.equal(evaluate(RULES, 0, 'grocer', 5000).outcome, 'allow');
});

test('a purchase above the approval amount needs approval', () => {
  assert.equal(evaluate(RULES, 0, 'grocer', 5001).outcome, 'approval');
});

test('a merchant off the allowed list is blocked', () => {
  assert.equal(evaluate(RULES, 0, 'electronics', 100).outcome, 'block');
});

test('a purchase can use the budget exactly but not exceed it', () => {
  assert.equal(evaluate(RULES, 9000, 'grocer', 1000).outcome, 'allow');
  assert.equal(evaluate(RULES, 9000, 'grocer', 1001).outcome, 'block');
});

test('purchases that cannot be checked are blocked', () => {
  assert.equal(evaluate(null, 0, 'grocer', 100).outcome, 'block');
  assert.equal(evaluate({ ...RULES, budgetCents: 'lots' }, 0, 'grocer', 100).outcome, 'block');
  assert.equal(evaluate(RULES, 0, 'grocer', -100).outcome, 'block');
  assert.equal(evaluate(RULES, 0, 'grocer', Number.NaN).outcome, 'block');
});

test('invalid rules are refused and the old rules stay in place', () => {
  const guard = activeGuard();
  assert.throws(() => guard.setRules({ ...RULES, allowedMerchantIds: ['nowhere'] }), GuardError);
  assert.deepEqual(guard.rules, RULES);
});

test('an allowed purchase is charged and counted against the budget', () => {
  const guard = activeGuard();
  assert.equal(buy(guard, 2000).status, 'completed');
  assert.equal(guard.snapshot().spentCents, 2000);
  assert.equal(guard.snapshot().remainingCents, 8000);
});

test('a pending purchase holds budget so later purchases cannot overspend', () => {
  const guard = activeGuard();
  assert.equal(buy(guard, 6000).status, 'pending');
  assert.equal(buy(guard, 4001).status, 'blocked');
  assert.equal(guard.snapshot().heldCents, 6000);
});

test('approving charges the purchase and denying does not', () => {
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

test('approval rechecks rules that changed while the purchase waited', () => {
  const guard = activeGuard();
  const purchase = buy(guard, 6000);
  guard.setRules({ ...RULES, allowedMerchantIds: [] });
  assert.equal(guard.decide(purchase.id, true).status, 'blocked');
  assert.equal(guard.snapshot().spentCents, 0);
});

test('a purchase cannot be decided twice', () => {
  const guard = activeGuard();
  const purchase = buy(guard, 6000);
  guard.decide(purchase.id, true);
  assert.throws(() => guard.decide(purchase.id, true), (error) => error.status === 409);
  assert.equal(guard.snapshot().heldCents, 6000);
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
  assert.match(messages, /Mock Grocer/);
  assert.match(messages, /Mock Electronics/);
  assert.match(messages, /Blocked Item/);
});

async function untilPending(guard) {
  while (!guard.purchases.some((p) => p.status === 'pending')) {
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  return guard.purchases.find((p) => p.status === 'pending');
}

test('the mock agent exercises each outcome with the default rules', async () => {
  const guard = new Guard();
  guard.grantAccess();
  const run = new MockAgent(guard, { stepMs: 0 }).run();
  guard.decide((await untilPending(guard)).id, true);
  await run;

  assert.deepEqual(guard.purchases.map((p) => p.status), ['completed', 'completed', 'blocked', 'completed', 'completed', 'blocked']);
  assert.equal(guard.snapshot().spentCents, 18375);
  assert.equal(guard.agentStatus.running, false);
});

test('the mock agent stops after access is revoked mid-run', async () => {
  const guard = new Guard();
  guard.grantAccess();
  const run = new MockAgent(guard, { stepMs: 0 }).run();
  await untilPending(guard);
  guard.revokeAccess();
  await run;

  assert.equal(guard.purchases.at(-1).code, 'no_access');
  assert.equal(guard.purchases.length, 5);
  assert.equal(guard.snapshot().spentCents, 6075);
});

test('the mock agent cannot pay without access', async () => {
  const guard = new Guard();
  await new MockAgent(guard, { stepMs: 0 }).run();
  assert.equal(guard.purchases.length, 1);
  assert.equal(guard.purchases[0].status, 'blocked');
});
