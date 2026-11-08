import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { MockAgent } from '../engine/agent.js';
import { ASSET_PATHS, MERCHANTS, productFor } from '../engine/catalog.js';
import { createGuard } from '../testing/harness.js';

const RULES = { budgetCents: 10000, approvalCents: 5000 };

function heldPurchase() {
  const guard = createGuard();
  guard.setRules(RULES);
  guard.grantAccess();
  const purchase = guard.attempt({ token: guard.agentToken(), merchantId: 'grocer', item: 'USB charger', amountCents: 6000 });
  return { guard, id: purchase.id };
}

test('a new approval expires after 3 days and has no reminder yet', () => {
  const { guard, id } = heldPurchase();
  const purchase = guard.getPurchase(id);
  assert.equal(Date.parse(purchase.expiresAt) - Date.parse(purchase.at), 3 * 24 * 60 * 60 * 1000);
  assert.equal(purchase.reminder, null);
});

test('reminders count down on day 1 and day 2', () => {
  const { guard, id } = heldPurchase();
  guard.advanceDay();
  assert.equal(guard.getPurchase(id).reminder, 'Reminder 1 of 2 - this request expires in 2 days');
  guard.advanceDay();
  assert.equal(guard.getPurchase(id).reminder, 'Reminder 2 of 2 - this request expires in 1 day');
  assert.equal(guard.getPurchase(id).status, 'pending');
  assert.equal(guard.log.filter((entry) => entry.actor === 'reminder').length, 2);
});

test('checking again the same day does not repeat a reminder', () => {
  const { guard } = heldPurchase();
  guard.advanceDay();
  guard.checkApprovals();
  guard.checkApprovals();
  assert.equal(guard.log.filter((entry) => entry.actor === 'reminder').length, 1);
});

test('no decision by day 3 auto-denies, logs it, and releases the hold', () => {
  const { guard, id } = heldPurchase();
  guard.advanceDay();
  guard.advanceDay();
  guard.advanceDay();
  const purchase = guard.getPurchase(id);
  assert.equal(purchase.status, 'denied');
  assert.equal(purchase.code, 'expired');
  assert.match(purchase.reason, /Auto-denied/);
  assert.equal(guard.snapshot().heldCents, 0);
  assert.equal(guard.snapshot().spentCents, 0);
  assert.ok(guard.log.some((entry) => /Auto-denied USB charger/.test(entry.message)));
});

test('an expired approval cannot be approved', () => {
  const { guard, id } = heldPurchase();
  guard.advanceDay();
  guard.advanceDay();
  guard.advanceDay();
  assert.throws(() => guard.decide(id, true), (error) => error.status === 409);
});

test('a decided approval gets no more reminders and does not expire', () => {
  const { guard, id } = heldPurchase();
  guard.advanceDay();
  guard.decide(id, false);
  guard.advanceDay();
  guard.advanceDay();
  assert.equal(guard.getPurchase(id).code, null);
  assert.equal(guard.log.filter((entry) => entry.actor === 'reminder').length, 1);
});

test('a reset returns the clock to today', () => {
  const { guard } = heldPurchase();
  guard.advanceDay();
  guard.reset();
  assert.equal(guard.snapshot().simulatedDays, 0);
});

test('the mock agent moves on after an approval expires', async () => {
  const guard = createGuard();
  guard.grantAccess();
  const run = new MockAgent(guard, { stepMs: 0 }).run(guard.agentToken());
  let finished = false;
  run.then(() => { finished = true; });
  while (!finished) {
    if (guard.purchases.some((p) => p.status === 'pending')) {
      guard.advanceDay();
      guard.advanceDay();
      guard.advanceDay();
    }
    await new Promise((r) => setTimeout(r, 1));
  }
  assert.deepEqual(guard.purchases.map((p) => p.status), ['completed', 'completed', 'completed', 'denied', 'completed', 'denied']);
  assert.equal(guard.purchases[4].amountCents, 4200);
  assert.ok(guard.log.some((entry) => /Allowed lower final price for Blood pressure monitor/.test(entry.message)));
});

test('merchants have invented names, and purchases carry branding and product details', () => {
  assert.equal(MERCHANTS.length, 6);
  assert.equal(MERCHANTS.some((m) => /mock/i.test(m.name)), false);
  const { guard, id } = heldPurchase();
  const purchase = guard.getPurchase(id);
  assert.equal(purchase.merchantName, 'Thistlewick Pantry');
  assert.equal(purchase.merchantLogo, '/merchants/grocer.svg');
  assert.equal(purchase.image, '/products/usb-charger.svg');
  assert.equal(purchase.description, 'Compact two-port wall charger.');
  assert.equal(purchase.color, 'White');
  assert.equal(purchase.size, '30 W');
});

test('color and size are left out where they do not apply, and unknown items get a placeholder', () => {
  assert.equal(productFor('Gift cards').color, undefined);
  assert.equal(productFor('constructor').image, '/products/placeholder.svg');
});

test('every logo and product image is a self-contained SVG', () => {
  for (const path of ASSET_PATHS) {
    const svg = readFileSync(fileURLToPath(new URL(`../public${path}`, import.meta.url)), 'utf8');
    assert.match(svg, /^<svg /, path);
    assert.doesNotMatch(svg, /<image|<script|href=/, path);
  }
});
