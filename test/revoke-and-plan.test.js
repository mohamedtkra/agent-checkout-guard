import assert from 'node:assert/strict';
import test from 'node:test';
import { MockAgent } from '../engine/agent.js';
import { createGuard } from '../testing/harness.js';

const AGENT_A = 'agent-a';
const LIMITS = { budgetCents: 40000, approvalCents: 5000 };
const STEP_MS = 5;

const LIST = [
  { merchantId: 'grocer', item: 'Weekly groceries', amountCents: 4250 },
  { merchantId: 'pharmacy', item: 'Allergy medicine', amountCents: 1825 },
  { merchantId: 'electronics', item: 'USB charger', amountCents: 2499 },
];

function setup(permissions = LIMITS, agentId = AGENT_A) {
  const guard = createGuard();
  guard.grantAccess(agentId, permissions);
  return guard;
}

function firstQuote(guard, quote = LIST[0]) {
  return guard.attempt({ token: guard.agentToken(), ...quote });
}

const waitFor = async (check) => {
  while (!check()) await new Promise((resolve) => { setTimeout(resolve, 1); });
};

test('revoking reports every ongoing purchase it stopped, and the holds it released', () => {
  const guard = setup({ budgetCents: 40000, approvalCents: 4000 });
  guard.autoSettle = false;
  const token = guard.agentToken();
  const waiting = firstQuote(guard);
  const cleared = guard.attempt({ token, ...LIST[1] });
  const onHold = guard.attempt({ token, ...LIST[2] });
  guard.checkout({ token, purchaseId: onHold.id, ...LIST[2] });

  const result = guard.revokeConnection(guard.connectionId);

  assert.equal(result.agentName, 'ChatGPT');
  assert.equal(result.releasedCents, 2499);
  assert.deepEqual(result.canceled.map((p) => p.id).sort(), [waiting.id, cleared.id, onHold.id].sort());
  assert.ok(guard.purchases.every((p) => p.status === 'canceled'));
  assert.equal(guard.snapshot().heldCents, 0);
});

test('a revoked agent\'s completed purchases stay in its history', () => {
  const guard = setup();
  const token = guard.agentToken();
  const bought = guard.attempt({ token, ...LIST[1] });
  guard.checkout({ token, purchaseId: bought.id, ...LIST[1] });
  guard.revokeConnection(guard.connectionId);

  const history = guard.snapshot().purchases.filter((p) => p.connectionId === guard.connectionId);
  assert.deepEqual(history.map((p) => p.status), ['completed']);
  assert.equal(guard.snapshot().spentCents, 1825);
});

test('revoking twice fails rather than reporting a second removal', () => {
  const guard = setup();
  guard.revokeConnection(guard.connectionId);
  assert.throws(() => guard.revokeConnection(guard.connectionId), /Connection not found/);
});

test('a purchase stopped by revoking can no longer be approved', () => {
  const guard = setup({ budgetCents: 40000, approvalCents: 0 });
  const waiting = firstQuote(guard);
  guard.revokeConnection(guard.connectionId);
  assert.throws(() => guard.decide(waiting.id, true), /already been decided/);
});

test('revoking mid-run stops the agent with no further attempts', async () => {
  const guard = setup({ budgetCents: 40000, approvalCents: 0 });
  const run = new MockAgent(guard, { stepMs: STEP_MS, list: LIST }).run(guard.agentToken());
  await waitFor(() => guard.purchases.some((p) => p.status === 'pending'));

  guard.revokeConnection(guard.connectionId);
  await run;

  assert.equal(guard.purchases.length, 1);
  assert.equal(guard.purchases[0].status, 'canceled');
  assert.ok(guard.purchases.every((p) => p.agentName !== 'Unknown agent'));
  assert.equal(guard.snapshot().agent.running, false);
});

test('revoking while the agent is between purchases also ends the run', async () => {
  const guard = setup();
  const run = new MockAgent(guard, { stepMs: 40, list: LIST }).run(guard.agentToken());
  guard.revokeConnection(guard.connectionId);
  await run;
  assert.equal(guard.purchases.length, 0);
  assert.match(guard.snapshot().agent.message, /Access was revoked/);
});

test('the plan says which items will come back to the customer', () => {
  const guard = setup();
  const agent = new MockAgent(guard, { stepMs: 0, list: LIST });
  assert.deepEqual(agent.plan(guard.connectionId).items.map((item) => item.willAsk), [false, false, false]);

  const strict = setup({ budgetCents: 40000, approvalCents: 2000 });
  const strictAgent = new MockAgent(strict, { stepMs: 0, list: LIST });
  assert.deepEqual(strictAgent.plan(strict.connectionId).items.map((item) => item.willAsk), [true, false, true]);
});

test('without a connection the plan makes no promise about approvals', () => {
  const guard = setup();
  assert.deepEqual(new MockAgent(guard, { stepMs: 0, list: LIST }).plan().items.map((item) => item.willAsk), [null, null, null]);
});

test('an item on the reviewed plan goes ahead as usual', () => {
  const guard = setup();
  guard.startPlan(guard.agentToken(), LIST);
  const purchase = firstQuote(guard, LIST[1]);
  assert.equal(purchase.status, 'authorized');
  assert.equal(purchase.offPlan, false);
});

test('a purchase off the reviewed plan needs approval, even under the approval amount', () => {
  const guard = setup();
  guard.startPlan(guard.agentToken(), LIST.slice(0, 1));
  const purchase = firstQuote(guard, { merchantId: 'grocer', item: 'Gift cards', amountCents: 999 });
  assert.equal(purchase.status, 'pending');
  assert.equal(purchase.offPlan, true);
  assert.match(purchase.reason, /not on the plan/);
});

test('a planned item at a higher price counts as off the plan', () => {
  const guard = setup();
  guard.startPlan(guard.agentToken(), LIST);
  const purchase = firstQuote(guard, { ...LIST[1], amountCents: 1826 });
  assert.equal(purchase.status, 'pending');
  assert.equal(purchase.offPlan, true);
});

test('with no active plan, the approval amount alone decides', () => {
  const guard = setup();
  assert.equal(firstQuote(guard, { merchantId: 'grocer', item: 'Gift cards', amountCents: 999 }).status, 'authorized');
});

test('a planted instruction reaches the customer, and denying it charges nothing', async () => {
  const guard = setup();
  const run = new MockAgent(guard, { stepMs: 0, list: LIST }).simulateInjection(guard.agentToken());
  await waitFor(() => guard.purchases.some((p) => p.status === 'pending'));

  const [purchase] = guard.purchases;
  assert.equal(purchase.item, 'Gift cards');
  assert.equal(purchase.offPlan, true);
  guard.decide(purchase.id, false);
  await run;

  assert.equal(guard.getPurchase(purchase.id).status, 'denied');
  assert.equal(guard.snapshot().spentCents, 0);
  assert.equal(guard.snapshot().agent.running, false);
});

test('the plan ends with the run, so later overreach tests are unaffected', async () => {
  const guard = setup();
  const agent = new MockAgent(guard, { stepMs: 0, list: LIST });
  await agent.run(guard.agentToken());
  assert.equal(firstQuote(guard, { merchantId: 'grocer', item: 'Phone case', amountCents: 100 }).status, 'authorized');
});
