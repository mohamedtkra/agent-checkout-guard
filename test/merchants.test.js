import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CATEGORY_ICONS, DEMO_AGENTS, MERCHANTS } from '../engine/catalog.js';
import { createGuard } from '../testing/harness.js';

function activeGuard() {
  const guard = createGuard();
  guard.setRules({ budgetCents: 50000, approvalCents: 50000 });
  guard.grantAccess();
  return guard;
}

function buy(guard, merchantId, amountCents = 2000, item = `Item at ${merchantId}`) {
  const token = guard.agentToken();
  const purchase = guard.attempt({ token, merchantId, item, amountCents });
  return guard.checkout({ token, purchaseId: purchase.id, merchantId, item, amountCents });
}

test('agents use their real names, with no official logos', () => {
  assert.deepEqual(DEMO_AGENTS.slice(0, 2).map((a) => a.name), ['ChatGPT (OpenAI)', 'Gemini (Google)']);
});

test('every merchant has a name, a category with an icon, and information to show', () => {
  for (const merchant of MERCHANTS) {
    assert.ok(merchant.name && CATEGORY_ICONS[merchant.category], merchant.id);
    assert.ok(merchant.about && merchant.location && merchant.returns);
    assert.match(merchant.support, /\.example$/);
  }
});

test('categories never decide whether a purchase goes through', () => {
  const guard = activeGuard();
  const results = MERCHANTS.map((merchant) => buy(guard, merchant.id));
  assert.ok(results.every((r) => r.status === 'completed'));
  assert.equal('allowedMerchantIds' in guard.rules, false);
});

test('an unknown merchant is labeled Other', () => {
  const guard = activeGuard();
  const result = buy(guard, 'somewhere-new');
  assert.equal(result.status, 'completed');
  assert.equal(result.merchantName, 'Unknown merchant');
  assert.equal(result.category, 'Other');
  assert.equal(result.categoryIcon, '/categories/other.svg');
});

test('purchases carry their category and icon', () => {
  const result = buy(activeGuard(), 'pharmacy');
  assert.equal(result.category, 'Health');
  assert.equal(result.categoryIcon, '/categories/health.svg');
});

test('spending by category separates charges from holds and hides empty categories', () => {
  const guard = activeGuard();
  buy(guard, 'grocer', 3000);
  buy(guard, 'market', 1000);
  guard.autoSettle = false;
  buy(guard, 'pharmacy', 500);
  assert.deepEqual(guard.snapshot().spendingByCategory.map((r) => [r.category, r.spentCents, r.heldCents]), [
    ['Groceries', 4000, 0],
    ['Health', 0, 500],
  ]);
});

test('a refund comes out of spending by category', () => {
  const guard = activeGuard();
  const paid = buy(guard, 'grocer', 3000);
  const { id } = guard.reportProblem(paid.id, { reason: 'other' });
  guard.advanceRefund(id);
  guard.advanceRefund(id);
  guard.advanceRefund(id, 'refunded');
  assert.deepEqual(guard.snapshot().spendingByCategory, []);
});

test('a reset clears spending', () => {
  const guard = activeGuard();
  buy(guard, 'grocer');
  guard.reset();
  assert.deepEqual(guard.snapshot().spendingByCategory, []);
});
