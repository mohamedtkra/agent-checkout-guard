import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MockAgent } from '../engine/agent.js';
import { checkoutPayload } from '../engine/agent-directory.js';
import { createAgentDirectory } from '../src/agent-directory.js';
import { approveAll, createGuard } from '../testing/harness.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const RULES = { budgetCents: 50000, approvalCents: 5000 };

function setup() {
  const guard = createGuard();
  guard.setRules(RULES);
  guard.grantAccess();
  return guard;
}

let counter = 0;
const intent = (guard, amountCents = 1000) => guard.attempt({ token: guard.agentToken(), merchantId: 'grocer', item: `Item ${counter += 1}`, amountCents });
const execute = (guard, purchase, extra = {}) => guard.checkout({ token: guard.agentToken(), purchaseId: purchase.id, merchantId: purchase.merchantId, item: purchase.item, amountCents: purchase.amountCents, ...extra });

test('a forged or missing signature is refused and nothing is charged', () => {
  const guard = setup();
  for (const signature of ['forged', 12345]) {
    const result = execute(guard, intent(guard), { signature });
    assert.equal(result.code, 'unverified_agent');
    assert.equal(result.reason, 'The merchant could not verify this agent.');
  }
  assert.equal(guard.snapshot().spentCents, 0);
  assert.deepEqual(guard.snapshot().holds, []);
});

test('a signature made for different details is refused', () => {
  const guard = setup();
  const purchase = intent(guard);
  const details = { purchaseId: purchase.id, merchantId: purchase.merchantId, item: purchase.item, amountCents: 999 };
  const signature = guard.agentDirectory.sign(purchase.agentId, checkoutPayload(details));
  assert.equal(execute(guard, purchase, { signature }).code, 'unverified_agent');
});

test('the real directory accepts its own signatures and rejects others', () => {
  const directory = createAgentDirectory();
  const signature = directory.sign('agent-a', 'payload');
  assert.equal(directory.verify('agent-a', 'payload', signature), true);
  assert.equal(directory.verify('agent-a', 'changed', signature), false);
  assert.equal(directory.verify('agent-b', 'payload', signature), false);
  assert.equal(directory.verify('agent-a', 'payload', undefined), false);
});

test('a charged purchase carries a transaction signal and a full trail', () => {
  const guard = setup();
  const approved = guard.decide(intent(guard, 6000).id, true);
  const paid = execute(guard, approved);
  assert.deepEqual(paid.signal, { agent: 'ChatGPT', agentVerified: true, customerPresent: true, consentVersion: 1 });
  assert.deepEqual(paid.trail.map((step) => step.label), ['Your rules', 'Your consent', 'You approved', 'Agent verified', 'Hold placed', 'Charged']);
  assert.ok(guard.log.some((entry) => /verified ChatGPT's signature/.test(entry.message)));
});

test('a purchase needing no approval says so in its trail', () => {
  const guard = setup();
  const paid = execute(guard, intent(guard));
  assert.equal(paid.signal.customerPresent, false);
  assert.ok(paid.trail.some((step) => step.label === 'No approval needed'));
});

test('a declined purchase records why in its trail', () => {
  const guard = setup();
  guard.setRules({ ...RULES, budgetCents: 500 });
  const result = execute(guard, intent(guard, 1000));
  assert.equal(result.trail.at(-1).label, 'Declined');
  assert.match(result.trail.at(-1).detail, /agent limit has/);
});

test('a refund request keeps the trail as evidence', () => {
  const guard = setup();
  const paid = execute(guard, intent(guard));
  const refund = guard.reportProblem(paid.id, { reason: 'other' });
  assert.deepEqual(refund.evidence.map((s) => s.label), paid.trail.map((s) => s.label));
});

test('stop all agents cancels open purchases, blocks new ones, and can be undone', () => {
  const guard = setup();
  const held = intent(guard, 6000);
  guard.stopAllAgents();
  assert.equal(guard.getPurchase(held.id).status, 'canceled');
  const blocked = intent(guard);
  assert.equal(blocked.code, 'paused');
  assert.equal(blocked.reason, 'You stopped all agents.');
  assert.deepEqual(guard.snapshot().alerts, []);
  assert.equal(guard.snapshot().connections[0].status, 'active');
  guard.resumeAgent();
  assert.equal(guard.snapshot().pauseReason, null);
  assert.equal(intent(guard, 1100).status, 'authorized');
});

test('buy it myself ends the purchase and the agent moves on', async () => {
  const guard = setup();
  const held = intent(guard, 6000);
  const result = guard.takeOver(held.id);
  assert.equal(result.status, 'denied');
  assert.equal(result.code, 'handed_off');
  assert.throws(() => guard.takeOver(held.id), (error) => error.status === 409);
  assert.throws(() => guard.takeOver('missing'), (error) => error.status === 404);
});

test('the plan lists what the agent intends to buy, with a total', () => {
  const guard = setup();
  const plan = new MockAgent(guard, { stepMs: 0 }).plan();
  assert.equal(plan.items.length, 6);
  assert.equal(plan.totalCents, 65874);
  assert.ok(plan.ask && plan.items.every((i) => i.why && i.merchantName));
});

test('the agent only buys the items the customer kept in the plan', async () => {
  const guard = setup();
  await approveAll(guard, new MockAgent(guard, { stepMs: 0 }).run(guard.agentToken(), { items: [0, 2] }));
  assert.deepEqual(guard.purchases.map((p) => p.item), ['Weekly groceries', 'USB charger']);
  assert.ok(guard.purchases[0].why && guard.purchases[0].ask);
});

const permissions = (trustLevel, approvalCents = 2000) => ({ budgetCents: 10000, approvalCents, trustLevel, connectionExpiresOn: new Date(Date.now() + 5 * DAY_MS).toISOString().slice(0, 10) });

test('trust levels set the approval amount', () => {
  const guard = setup();
  assert.equal(guard.validatePermissions(permissions('every_time')).approvalCents, 0);
  assert.equal(guard.validatePermissions(permissions('above')).approvalCents, 2000);
  assert.equal(guard.validatePermissions(permissions('routine')).approvalCents, 5000);
  assert.equal(guard.validatePermissions(permissions('nonsense')).trustLevel, 'above');
  assert.equal(guard.validatePermissions(permissions('constructor')).trustLevel, 'above');
});
