import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MockAgent, UNCLEARED_CHARGE } from '../engine/agent.js';
import { createGuard } from '../testing/harness.js';

const RULES = { budgetCents: 10000, approvalCents: 5000 };

function activeGuard() {
  const guard = createGuard();
  guard.setRules(RULES);
  guard.grantAccess();
  return guard;
}

const attempt = (guard, amountCents = 2000, item = 'Item') =>
  guard.attempt({ token: guard.agentToken(), merchantId: 'grocer', item, amountCents });

const finalize = (guard, purchase, changes = {}) => guard.checkout({
  token: guard.agentToken(),
  purchaseId: purchase.id,
  merchantId: purchase.merchantId,
  item: purchase.item,
  amountCents: purchase.amountCents,
  ...changes,
});

function chargedPurchase(guard) {
  return finalize(guard, attempt(guard));
}

function settledGuardWithFlag() {
  const guard = activeGuard();
  const purchase = guard.recordUnclearedCharge(UNCLEARED_CHARGE);
  return { guard, purchase };
}

const logged = (guard, pattern) => guard.log.some((entry) => pattern.test(entry.message));

test('clearing a purchase does not charge it', () => {
  const guard = activeGuard();
  assert.equal(attempt(guard).status, 'authorized');
  assert.equal(guard.snapshot().spentCents, 0);
  assert.equal(guard.snapshot().heldCents, 0);
});

test('a final price above the cleared price is blocked and logged', () => {
  const guard = activeGuard();
  const result = finalize(guard, attempt(guard), { amountCents: 2001 });
  assert.equal(result.status, 'blocked');
  assert.equal(result.code, 'mismatch');
  assert.match(result.reason, /higher than/);
  assert.equal(guard.snapshot().spentCents, 0);
  assert.equal(guard.snapshot().heldCents, 0);
  assert.ok(logged(guard, /Blocked Item: Final price \$20\.01/));
});

test('a final price above what the customer approved is blocked', () => {
  const guard = activeGuard();
  const approved = guard.decide(attempt(guard, 6000).id, true);
  const result = finalize(guard, approved, { amountCents: 7000 });
  assert.equal(result.status, 'blocked');
  assert.match(result.reason, /you approved/);
  assert.equal(guard.snapshot().spentCents, 0);
});

test('a lower final price is charged at that price and logged', () => {
  const guard = activeGuard();
  const result = finalize(guard, attempt(guard), { amountCents: 1500 });
  assert.equal(result.status, 'completed');
  assert.equal(result.amountCents, 1500);
  assert.equal(result.originalCents, 2000);
  assert.equal(guard.snapshot().spentCents, 1500);
  assert.equal(guard.snapshot().heldCents, 0);
  assert.equal(guard.paused, false);
  assert.ok(logged(guard, /Allowed lower final price for Item: \$15\.00 instead of the \$20\.00/));
});

test('a lower final price is allowed on a customer-approved purchase', () => {
  const guard = activeGuard();
  const approved = guard.decide(attempt(guard, 6000).id, true);
  assert.equal(finalize(guard, approved, { amountCents: 5500 }).status, 'completed');
  assert.ok(logged(guard, /instead of the \$60\.00 you approved/));
  assert.equal(guard.paused, false);
});

test('a final price that cannot be checked is blocked rather than treated as lower', () => {
  const guard = activeGuard();
  for (const [index, amountCents] of [0, -100, Number.NaN, 10.5, '100'].entries()) {
    const result = finalize(guard, attempt(guard, 100 + index, `Item ${index}`), { amountCents });
    assert.equal(result.status, 'blocked');
    assert.equal(result.code, 'mismatch');
  }
  assert.equal(guard.snapshot().spentCents, 0);
});

test('a lower final price still has to fit the current rules', () => {
  const guard = activeGuard();
  const cleared = attempt(guard);
  guard.setRules({ ...RULES, budgetCents: 500 });
  assert.equal(finalize(guard, cleared, { amountCents: 1000 }).code, 'allocation');
  assert.equal(guard.getPurchase(cleared.id).amountCents, 2000);
});

test('a different final merchant or item is blocked', () => {
  const guard = activeGuard();
  assert.equal(finalize(guard, attempt(guard, 100, 'A'), { merchantId: 'pharmacy' }).code, 'mismatch');
  assert.equal(finalize(guard, attempt(guard, 200, 'B'), { item: 'Gift cards' }).code, 'mismatch');
  assert.equal(guard.snapshot().spentCents, 0);
});

test('charging the same purchase twice is blocked and leaves the first charge alone', () => {
  const guard = activeGuard();
  const paid = chargedPurchase(guard);
  const replay = finalize(guard, paid);
  assert.equal(replay.status, 'blocked');
  assert.equal(replay.code, 'duplicate');
  assert.equal(guard.getPurchase(paid.id).status, 'completed');
  assert.equal(guard.snapshot().spentCents, 2000);
});

test('a new purchase matching a recent one is blocked as a duplicate', () => {
  const guard = activeGuard();
  chargedPurchase(guard);
  const again = attempt(guard);
  assert.equal(again.status, 'blocked');
  assert.equal(again.code, 'duplicate');
});

test('a purchase can be retried after the first attempt was blocked', () => {
  const guard = activeGuard();
  finalize(guard, attempt(guard), { amountCents: 2500 });
  assert.equal(attempt(guard).status, 'authorized');
});

test('a held purchase cannot be charged before approval', () => {
  const guard = activeGuard();
  const held = attempt(guard, 6000);
  assert.equal(finalize(guard, held).code, 'not_cleared');
  assert.equal(guard.getPurchase(held.id).status, 'pending');
  assert.equal(guard.snapshot().spentCents, 0);
});

test('a denied purchase cannot be charged', () => {
  const guard = activeGuard();
  const denied = guard.decide(attempt(guard, 6000).id, false);
  assert.equal(finalize(guard, denied).code, 'not_cleared');
  assert.equal(guard.snapshot().spentCents, 0);
});

test('final checkout rechecks rules that changed after clearance', () => {
  const guard = activeGuard();
  const cleared = attempt(guard);
  guard.setRules({ ...RULES, budgetCents: 500 });
  const result = finalize(guard, cleared);
  assert.equal(result.status, 'blocked');
  assert.equal(result.code, 'allocation');
});

test('final checkout requires approval if the approval amount dropped after clearance', () => {
  const guard = activeGuard();
  const cleared = attempt(guard);
  guard.setRules({ ...RULES, approvalCents: 1000 });
  assert.equal(finalize(guard, cleared).code, 'approval_required');
});

test('revoking cancels cleared purchases and a stale token cannot check out', () => {
  const guard = activeGuard();
  const token = guard.agentToken();
  const cleared = attempt(guard);
  guard.revokeAccess();
  assert.equal(guard.getPurchase(cleared.id).status, 'canceled');
  assert.equal(finalize(guard, cleared, { token }).status, 'blocked');
  assert.equal(guard.snapshot().spentCents, 0);
});

test('normal charges are not flagged and do not pause the agent', () => {
  const guard = activeGuard();
  chargedPurchase(guard);
  assert.equal(guard.paused, false);
  assert.deepEqual(guard.alerts, []);
  assert.equal(guard.log.some((entry) => entry.flagged), false);
});

test('a charge outside the rules is flagged, pauses the agent, and alerts the customer', () => {
  const { guard, purchase } = settledGuardWithFlag();
  assert.equal(purchase.status, 'completed');
  assert.equal(purchase.flagged, true);
  assert.equal(guard.paused, true);
  assert.equal(guard.alerts.length, 1);
  assert.equal(guard.alerts[0].purchaseId, purchase.id);
  assert.ok(guard.log.some((entry) => entry.flagged && /Flagged charge/.test(entry.message)));
});

test('a paused agent cannot buy until the customer resumes it', () => {
  const { guard } = settledGuardWithFlag();
  assert.equal(attempt(guard).code, 'paused');
  guard.resumeAgent();
  assert.equal(guard.paused, false);
  assert.deepEqual(guard.alerts, []);
  guard.setRules({ ...RULES, budgetCents: 50000 });
  assert.equal(attempt(guard, 2100).status, 'authorized');
});

test('a flagged charge cancels purchases still in progress', () => {
  const guard = activeGuard();
  const held = attempt(guard, 6000);
  guard.recordUnclearedCharge(UNCLEARED_CHARGE);
  assert.equal(guard.getPurchase(held.id).status, 'canceled');
});

test('a flagged charge mid-run stops the mock agent', async () => {
  const guard = createGuard();
  guard.grantAccess();
  const run = new MockAgent(guard, { stepMs: 0 }).run(guard.agentToken());
  while (!guard.purchases.some((p) => p.status === 'pending')) await new Promise((r) => setTimeout(r, 1));
  guard.recordUnclearedCharge(UNCLEARED_CHARGE);
  await run;
  assert.equal(guard.purchases.at(-1).code, 'paused');
  assert.equal(guard.agentStatus.running, false);
});

test('every overreach scenario is stopped and nothing is charged', async () => {
  const guard = activeGuard();
  chargedPurchase(guard);
  const agent = new MockAgent(guard, { stepMs: 0 });
  for (let press = 0; press < 5; press += 1) await agent.simulateOverreach(guard.agentToken());

  const attempts = guard.purchases.filter((p) => p.overreach);
  assert.equal(attempts.length, 5);
  assert.ok(attempts.every((p) => p.status === 'blocked'));
  assert.deepEqual(attempts.map((p) => p.code), ['not_cleared', 'mismatch', 'mismatch', 'mismatch', 'duplicate']);
  assert.equal(guard.snapshot().spentCents, 2000);
  assert.equal(guard.paused, false);
});

test('the first overreach press is blocked with nothing charged yet', async () => {
  const guard = createGuard();
  guard.grantAccess();
  await new MockAgent(guard, { stepMs: 0 }).simulateOverreach(guard.agentToken());
  assert.equal(guard.purchases[0].status, 'blocked');
});

test('a refund request moves through each stage with dates', () => {
  const guard = activeGuard();
  const paid = chargedPurchase(guard);
  const { id, timeline } = guard.reportProblem(paid.id, { reason: 'overcharged', note: ' Too much ' });
  const refund = guard.refunds[0];

  assert.equal(refund.note, 'Too much');
  assert.equal(refund.reasonLabel, 'Charged more than approved');
  assert.deepEqual(timeline.map((step) => step.label), ['Submitted', 'Under review', 'Merchant contacted', 'Refunded or Declined']);
  assert.ok(Date.parse(refund.expectedResolveAt) > Date.parse(refund.createdAt));

  guard.advanceRefund(id);
  guard.advanceRefund(id);
  assert.throws(() => guard.advanceRefund(id), /Refunded or Declined/);
  guard.advanceRefund(id, 'refunded');

  assert.ok(refund.timeline.every((step) => step.at));
  assert.equal(refund.timeline[3].label, 'Refunded');
  assert.equal(refund.outcome, 'refunded');
  assert.throws(() => guard.advanceRefund(id, 'refunded'), (error) => error.status === 409);
});

test('a refund returns the money to the budget and a decline does not', () => {
  const guard = activeGuard();
  const refunded = chargedPurchase(guard);
  const declined = finalize(guard, attempt(guard, 3000, 'Other'));
  const resolve = (purchase, outcome) => {
    const { id } = guard.reportProblem(purchase.id, { reason: 'wrong_item' });
    guard.advanceRefund(id);
    guard.advanceRefund(id);
    guard.advanceRefund(id, outcome);
  };
  resolve(refunded, 'refunded');
  resolve(declined, 'declined');
  assert.equal(guard.getPurchase(refunded.id).status, 'refunded');
  assert.equal(guard.getPurchase(declined.id).status, 'completed');
  assert.equal(guard.snapshot().spentCents, 3000);
});

test('a purchase with no charge can be reported but cannot be refunded', () => {
  const guard = activeGuard();
  const blocked = guard.attempt({ token: 'not-a-token', merchantId: 'grocer', item: 'Item', amountCents: 100 });
  const { id, amountCents } = guard.reportProblem(blocked.id, { reason: 'unauthorized' });
  assert.equal(amountCents, 0);
  guard.advanceRefund(id);
  guard.advanceRefund(id);
  guard.advanceRefund(id, 'refunded');
  assert.equal(guard.refunds[0].outcome, 'declined');
  assert.match(guard.refunds[0].declineReason, /Nothing was charged/);
  assert.equal(guard.getPurchase(blocked.id).status, 'blocked');
});

test('reports are validated and limited to one per purchase', () => {
  const guard = activeGuard();
  const paid = chargedPurchase(guard);
  assert.throws(() => guard.reportProblem(paid.id, { reason: 'nope' }), /Choose a reason/);
  assert.throws(() => guard.reportProblem(paid.id, { reason: 'constructor' }), /Choose a reason/);
  assert.throws(() => guard.reportProblem(paid.id, { reason: 'other', note: 'x'.repeat(501) }), /500/);
  assert.throws(() => guard.reportProblem('missing', { reason: 'other' }), (error) => error.status === 404);
  guard.reportProblem(paid.id, { reason: 'other' });
  assert.throws(() => guard.reportProblem(paid.id, { reason: 'other' }), (error) => error.status === 409);
});

test('reset clears flags, alerts, and refunds', () => {
  const { guard, purchase } = settledGuardWithFlag();
  guard.reportProblem(purchase.id, { reason: 'unauthorized' });
  guard.reset();
  assert.equal(guard.paused, false);
  assert.deepEqual(guard.alerts, []);
  assert.deepEqual(guard.refunds, []);
});
