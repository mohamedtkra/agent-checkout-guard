import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MockAgent } from '../engine/agent.js';
import { Guard } from '../engine/guard.js';
import { MemoryConnections } from '../engine/memory-connections.js';
import { approveAll } from '../testing/harness.js';
import { configForScenario, configWarnings, decodeConfig, effectiveShares, encodeConfig, FEATURE_BLOCKS, normalizeConfig } from '../workbench/config.js';
import { AGENTS, buildCatalog, SCENARIO_IDS, SCENARIOS, shoppingList } from '../workbench/scenarios.js';
import { buildSpec, specToMarkdown } from '../workbench/spec.js';

const allFeatures = (config, changes) => ({ ...config, features: { ...config.features, ...changes } });

test('the five scenario templates exist', () => {
  assert.deepEqual(SCENARIO_IDS.map((id) => SCENARIOS[id].name), ['Travel', 'Restaurants', 'Subscriptions', 'Small business', 'Family card']);
});

test('the agents use real names and letter badges', () => {
  assert.deepEqual(AGENTS.map((a) => a.name), ['ChatGPT (OpenAI)', 'Gemini (Google)']);
  assert.ok(AGENTS.every((a) => a.icon.startsWith('data:image/svg+xml,')));
});

test('all merchants are invented sample businesses', () => {
  for (const id of SCENARIO_IDS) {
    assert.ok(SCENARIOS[id].merchants.every(([, name]) => name.startsWith('Sample ')), id);
  }
});

for (const id of SCENARIO_IDS) {
  test(`the ${SCENARIOS[id].name} scenario runs on the engine and ends with a checkout decline`, async () => {
    const config = configForScenario(id);
    const scenario = SCENARIOS[id];
    const catalog = buildCatalog(scenario, config.agents);
    const connections = new MemoryConnections(catalog.agents);
    const guard = new Guard({ connections, catalog, features: config.features });
    guard.credit = { creditLimitCents: config.creditLimit * 100, balanceCents: 0 };
    guard.setRules({ budgetCents: config.allocation * 100, approvalCents: config.approval * 100 });
    const { token } = connections.link('agent-a', { budgetCents: 1e9, approvalCents: 1e9, connectionExpiresAt: new Date(Date.now() + 1e10).toISOString() }, Date.now());
    await approveAll(guard, new MockAgent(guard, { stepMs: 0, list: shoppingList(scenario) }).run(token));

    const statuses = guard.purchases.map((p) => p.status);
    assert.deepEqual(statuses.slice(0, -1), Array(scenario.purchases.length - 1).fill('completed'));
    assert.equal(statuses.at(-1), 'blocked');
    assert.match(guard.purchases.at(-1).reason, /^Declined at checkout: your \$[\d,]+ agent limit has/);
    assert.ok(guard.purchases.some((p) => p.originalCents), 'a lower final price');
    assert.ok(guard.purchases.some((p) => p.customerApproved), 'an approval');
  });
}

test('a config survives the share link round trip', () => {
  const config = allFeatures(configForScenario('business'), { refunds: false, overreach: false });
  config.shares = { 'agent-a': 1000, 'agent-b': 500 };
  config.agents = ['agent-b', 'agent-a'];
  const decoded = decodeConfig(encodeConfig(normalizeConfig(config)));
  assert.equal(decoded.scenario, 'business');
  assert.equal(decoded.features.refunds, false);
  assert.equal(decoded.features.approvals, true);
  assert.deepEqual(decoded.shares, { 'agent-a': 1000, 'agent-b': 500 });
});

test('the share link is safe to put in a URL', () => {
  assert.match(encodeConfig(configForScenario('travel')), /^[A-Za-z0-9_-]+$/);
});

test('bad share links are rejected or cleaned up', () => {
  assert.equal(decodeConfig('not base64 $$$'), null);
  assert.equal(decodeConfig(btoa('{bad json')), null);
  const decoded = decodeConfig(btoa(JSON.stringify({
    scenario: 'nowhere', agents: ['evil', 'agent-b'], creditLimit: -5, allocation: 'lots', approval: 1e12, features: { hacked: true, refunds: false }, shares: { evil: 5, 'agent-b': 'x' },
  })));
  assert.equal(decoded.scenario, 'travel');
  assert.deepEqual(decoded.agents, ['agent-b']);
  assert.equal(decoded.creditLimit, SCENARIOS.travel.creditLimit);
  assert.equal(decoded.approval, 1_000_000);
  assert.equal('hacked' in decoded.features, false);
  assert.equal(decoded.features.refunds, false);
  assert.deepEqual(decoded.shares, {});
});

test('the allocation can never exceed the credit limit', () => {
  const config = normalizeConfig({ scenario: 'travel', creditLimit: 500, allocation: 900, approval: 10 });
  assert.equal(config.allocation, 500);
});

test('split by agent turns off with credit allocation', () => {
  assert.equal(normalizeConfig(allFeatures(configForScenario('travel'), { creditHolds: false })).features.splitByAgent, false);
});

test('shares over the allocation are ignored and warned about', () => {
  const config = normalizeConfig({ ...configForScenario('family'), shares: { 'agent-a': 400, 'agent-b': 400 } });
  assert.deepEqual(effectiveShares(config), {});
  assert.match(configWarnings(config)[0], /more than the allocation/);
});

test('shares that fit apply, and no agents selected warns', () => {
  const config = normalizeConfig({ ...configForScenario('family'), shares: { 'agent-a': 300, 'agent-b': 300 } });
  assert.deepEqual(effectiveShares(config), { 'agent-a': 300, 'agent-b': 300 });
  assert.match(configWarnings(normalizeConfig({ ...config, agents: [] }))[0], /at least one agent/);
});

test('the feature blocks are offered', () => {
  assert.deepEqual(FEATURE_BLOCKS.map((b) => b.label), [
    'Step-up verification and consent',
    'Approval with 3-day expiry and reminders',
    'Credit allocation and checkout holds',
    'Split by agent',
    'Report and refund tracking',
    'Overreach detection and auto-pause',
    'Verified agent at checkout',
  ]);
});

test('the spec has every section and reflects the setup', () => {
  const spec = buildSpec(configForScenario('travel'));
  assert.deepEqual(spec.sections.map((s) => s.heading), ['Problem', 'Enabled features', 'Rules', 'User flow', 'Key metrics']);
  const text = JSON.stringify(spec);
  assert.match(text, /Agent allocation: \$2,000/);
  assert.match(text, /above \$300/);
  assert.match(text, /Limit breaches/);
});

test('disabled features leave the spec', () => {
  const none = Object.fromEntries(FEATURE_BLOCKS.map((b) => [b.id, false]));
  const text = JSON.stringify(buildSpec(normalizeConfig({ ...configForScenario('travel'), features: none })));
  for (const phrase of ['allocation', 'Refund rate', 'Approval response', 'Overreach attempts', 'step-up']) {
    assert.equal(text.includes(phrase), false, phrase);
  }
});

test('the exported Markdown has the banner, sections, and share link', () => {
  const markdown = specToMarkdown(buildSpec(configForScenario('restaurants')), 'https://example.test/?c=abc');
  assert.match(markdown, /^# Agent Checkout Guard: Restaurants/);
  assert.match(markdown, /> Demo - no real accounts or payments/);
  assert.match(markdown, /## User flow\n\n1\. /);
  assert.match(markdown, /\(https:\/\/example\.test\/\?c=abc\)/);
});
