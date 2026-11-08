import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MockAgent } from '../src/agent.js';
import { AGENT_COMPANIES, MERCHANTS } from '../src/catalog.js';
import { Guard } from '../src/guard.js';

const RULES = { budgetCents: 10000, allowedMerchantIds: ['grocer', 'wellness'], approvalCents: 5000 };

function activeGuard() {
  const guard = new Guard();
  guard.setRules(RULES);
  guard.grantAccess();
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
  const guard = activeGuard();
  guard.setAgentCompany('zephwick');
  const result = attempt(guard, 'wellness');
  assert.equal(result.status, 'blocked');
  assert.equal(result.code, 'merchant_agent');
  assert.equal(result.reason, 'Larkmoss Wellness does not accept agents from Zephwick Agents.');
  assert.ok(guard.log.some((entry) => /Blocked Item: Larkmoss Wellness does not accept/.test(entry.message)));
});

test('a merchant that accepts the agent company allows the purchase', () => {
  const guard = activeGuard();
  guard.setAgentCompany('zephwick');
  assert.equal(attempt(guard, 'grocer').status, 'authorized');
});

test('the customer rule is reported first when both would block', () => {
  const guard = activeGuard();
  guard.setAgentCompany('pennowl');
  assert.equal(attempt(guard, 'electronics').code, 'rules');
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

test('the agent company cannot be unknown or change mid-run', async () => {
  const guard = activeGuard();
  assert.throws(() => guard.setAgentCompany('nobody'), (error) => error.status === 404);
  const run = new MockAgent(guard, { stepMs: 0 }).run();
  assert.throws(() => guard.setAgentCompany('pennowl'), (error) => error.status === 409);
  while (guard.agentStatus.running) {
    guard.purchases.filter((p) => p.status === 'pending').forEach((p) => guard.decide(p.id, false));
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  await run;
  assert.equal(guard.agentCompanyId, AGENT_COMPANIES[0].id);
});

test('a purchase records the agent company that made it', () => {
  const guard = activeGuard();
  guard.setAgentCompany('zephwick');
  const paid = finalize(guard, attempt(guard));
  assert.equal(paid.agentCompanyName, 'Zephwick Agents');
  guard.setAgentCompany('pennowl');
  assert.equal(guard.getPurchase(paid.id).agentCompanyName, 'Zephwick Agents');
});

test('a reset restores the default merchant settings and agent company', () => {
  const guard = activeGuard();
  guard.setAgentCompany('pennowl');
  guard.setMerchantAgents('grocer', []);
  guard.reset();
  assert.equal(guard.agentCompanyId, 'quillhop');
  assert.ok(guard.merchantAgents.grocer.includes('quillhop'));
  assert.ok(MERCHANTS.find((m) => m.id === 'grocer').acceptedAgents.includes('zephwick'));
});
