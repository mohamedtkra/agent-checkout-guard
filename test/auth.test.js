import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Auth, SESSION_MS } from '../src/auth.js';
import { createStore, createUser } from '../testing/harness.js';

function setup() {
  const { db } = createStore();
  const clock = { ms: 1_800_000_000_000 };
  return { db, clock, auth: new Auth(db, { now: () => clock.ms }) };
}

function signIn(auth, email = 'demo@example.com') {
  const { demoCode } = auth.requestSignInCode(email);
  return auth.verifySignIn(email, demoCode);
}

function stepUp(auth, db, subject = 'connect:agent-a') {
  const user = createUser(db);
  const sessionToken = 'session-token';
  const { challengeId, demoCode } = auth.createStepUp({ userId: user.id, sessionToken, subject });
  return { user, sessionToken, challengeId, demoCode };
}

test('a correct one-time code creates a user and a session', () => {
  const { auth } = setup();
  const { demoCode } = auth.requestSignInCode('  Demo@Example.com ');
  assert.match(demoCode, /^\d{6}$/);
  const { sessionToken, user } = auth.verifySignIn('demo@example.com', demoCode);
  assert.equal(user.email, 'demo@example.com');
  assert.equal(auth.session(sessionToken).user.id, user.id);
});

test('signing in again reuses the same user', () => {
  const { auth } = setup();
  assert.equal(signIn(auth).user.id, signIn(auth).user.id);
});

test('invalid email addresses are refused', () => {
  const { auth } = setup();
  for (const email of ['', 'nope', 'a@b', null, 42]) assert.throws(() => auth.requestSignInCode(email), /email/);
});

test('a wrong code fails and is limited to five attempts', () => {
  const { auth } = setup();
  const { demoCode } = auth.requestSignInCode('demo@example.com');
  const wrong = demoCode === '000000' ? '000001' : '000000';
  for (let i = 0; i < 5; i += 1) assert.throws(() => auth.verifySignIn('demo@example.com', wrong), /not correct/);
  assert.throws(() => auth.verifySignIn('demo@example.com', demoCode), (error) => error.status === 429);
});

test('a code expires after five minutes', () => {
  const { auth, clock } = setup();
  const { demoCode } = auth.requestSignInCode('demo@example.com');
  clock.ms += 5 * 60 * 1000;
  assert.throws(() => auth.verifySignIn('demo@example.com', demoCode), /expired/);
});

test('a code cannot be used twice, and a new request replaces the old code', () => {
  const { auth } = setup();
  const first = auth.requestSignInCode('demo@example.com').demoCode;
  const second = auth.requestSignInCode('demo@example.com').demoCode;
  if (first !== second) assert.throws(() => auth.verifySignIn('demo@example.com', first), /not correct/);
  auth.verifySignIn('demo@example.com', second);
  assert.throws(() => auth.verifySignIn('demo@example.com', second), /new code/);
});

test('codes and session tokens are stored only as hashes', () => {
  const { auth, db } = setup();
  const { demoCode } = auth.requestSignInCode('demo@example.com');
  const { sessionToken } = auth.verifySignIn('demo@example.com', demoCode);
  const stored = JSON.stringify([db.prepare('SELECT * FROM one_time_codes').all(), db.prepare('SELECT * FROM sessions').all()]);
  assert.equal(stored.includes(demoCode), false);
  assert.equal(stored.includes(sessionToken), false);
});

test('a session expires after 30 minutes', () => {
  const { auth, clock } = setup();
  const { sessionToken } = signIn(auth);
  clock.ms += SESSION_MS - 1;
  assert.ok(auth.session(sessionToken));
  clock.ms += 1;
  assert.equal(auth.session(sessionToken), null);
  assert.equal(SESSION_MS, 30 * 60 * 1000);
});

test('signing out ends the session', () => {
  const { auth } = setup();
  const { sessionToken } = signIn(auth);
  auth.signOut(sessionToken);
  assert.equal(auth.session(sessionToken), null);
});

test('consent needs a verified step-up', () => {
  const { auth, db } = setup();
  const { user, sessionToken, challengeId, demoCode } = stepUp(auth, db);
  assert.throws(() => auth.stepUpGrant({ challengeId, userId: user.id, sessionToken }), (error) => error.status === 403);
  auth.verifyStepUp({ challengeId, userId: user.id, sessionToken, code: demoCode });
  assert.equal(auth.stepUpGrant({ challengeId, userId: user.id, sessionToken }).subject, 'connect:agent-a');
});

test('a step-up grant works once and belongs to one session', () => {
  const { auth, db } = setup();
  const { user, sessionToken, challengeId, demoCode } = stepUp(auth, db);
  auth.verifyStepUp({ challengeId, userId: user.id, sessionToken, code: demoCode });
  assert.throws(() => auth.stepUpGrant({ challengeId, userId: user.id, sessionToken: 'other-session' }), (error) => error.status === 403);
  assert.throws(() => auth.stepUpGrant({ challengeId, userId: 'someone-else', sessionToken }), (error) => error.status === 403);
  auth.consumeStepUp(challengeId);
  assert.throws(() => auth.stepUpGrant({ challengeId, userId: user.id, sessionToken }), (error) => error.status === 403);
});

test('a step-up grant lapses after ten minutes', () => {
  const { auth, db, clock } = setup();
  const { user, sessionToken, challengeId, demoCode } = stepUp(auth, db);
  auth.verifyStepUp({ challengeId, userId: user.id, sessionToken, code: demoCode });
  clock.ms += 10 * 60 * 1000;
  assert.throws(() => auth.stepUpGrant({ challengeId, userId: user.id, sessionToken }), (error) => error.status === 403);
});
