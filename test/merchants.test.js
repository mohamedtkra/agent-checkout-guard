import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MERCHANTS } from '../src/catalog.js';
import { createGuard } from '../testing/harness.js';

const RULES = { budgetCents: 10000, allowedMerchantIds: ['grocer', 'wellness'], approvalCents: 5000 };

function activeGuard(agentId = 'agent-a') {
  const guard = createGuard();
  guard.setRules(RULES);
  guard.grantAccess(agentId);
  return guard;
}

const attempt = (guard, merchantId = 'grocer', amountCents = 2000) =>
  guard.attempt({ token: guard.agentToken(), merchantId, item: 'Item', amountCents });

const finalize = (guard, purchase) => guard.checkout({
  token: guard.agentToken(),
  purchaseId: purchase.id,
  merchantId: purchase.merchantId,
  item: purchase.item,
  amountCents: purchase.amountCents,
});

test('every category has more than one merchant, with information to show', () => {
  const categories = [...new Set(MERCHANTS.map((m) => m.category))];
  assert.deepEqual(categories, ['Groceries', 'Health', 'Gadgets']);
  assert.ok(categories.every((category) => MERCHANTS.filter((m) => m.category === category).length === 2));
  for (const merchant of MERCHANTS) {
    assert.ok(merchant.about && merchant.location && merchant.returns);
    assert.match(merchant.support, /\.example$/);
  }
});

test('a merchant that does not accept the agent company blocks the purchase', () => {
  const guard = activeGuard('agent-c');
  const result = attempt(guard, 'wellness');
  assert.equal(result.status, 'blocked');
  assert.equal(result.code, 'merchant_agent');
  assert.equal(result.reason, 'Larkmoss Wellness does not accept agents from Zephwick Agents.');
  assert.ok(guard.log.some((entry) => /Blocked Item: Larkmoss Wellness does not accept/.test(entry.message)));
});

test('a merchant that accepts the agent company allows the purchase', () => {
  assert.equal(attempt(activeGuard('agent-c'), 'grocer').status, 'authorized');
});

test('the customer rule is reported first when both would block', () => {
  assert.equal(attempt(activeGuard('agent-b'), 'electronics').code, 'rules');
});

test('a merchant withdrawing acceptance blocks at final checkout', () => {
  const guard = activeGuard();
  const cleared = attempt(guard);
  guard.setMerchantAgents('grocer', ['pennowl']);
  assert.equal(finalize(guard, cleared).code, 'merchant_agent');
  assert.equal(guard.snapshot().spentCents, 0);
});

test('a merchant withdrawing acceptance blocks at approval', () => {
  const guard = activeGuard();
  const held = attempt(guard, 'grocer', 6000);
  guard.setMerchantAgents('grocer', []);
  assert.equal(guard.decide(held.id, true).code, 'merchant_agent');
});

test('merchant changes are validated and logged', () => {
  const guard = activeGuard();
  assert.throws(() => guard.setMerchantAgents('nowhere', []), (error) => error.status === 404);
  assert.throws(() => guard.setMerchantAgents('constructor', []), (error) => error.status === 404);
  assert.throws(() => guard.setMerchantAgents('grocer', ['nobody']), /known companies/);
  assert.throws(() => guard.setMerchantAgents('grocer', 'quillhop'), /known companies/);
  guard.setMerchantAgents('grocer', ['pennowl', 'pennowl']);
  assert.deepEqual(guard.merchantAgents.grocer, ['pennowl']);
  assert.ok(guard.log.some((entry) => entry.actor === 'merchant' && /Thistlewick Pantry now accepts agents from: Pennowl Agents/.test(entry.message)));
});

test('a reset restores the default merchant settings', () => {
  const guard = activeGuard();
  guard.setMerchantAgents('grocer', []);
  guard.reset();
  assert.ok(guard.merchantAgents.grocer.includes('quillhop'));
  assert.ok(MERCHANTS.find((m) => m.id === 'grocer').acceptedAgents.includes('zephwick'));
});
