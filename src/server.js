import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { UNCLEARED_CHARGE } from '../engine/agent.js';
import { Auth, SESSION_MS } from './auth.js';
import { ASSET_PATHS, DEMO_AGENTS } from '../engine/catalog.js';
import { Connections, demoAgent, loadSigner } from './connections.js';
import { openDatabase } from './db.js';
import { GuardError } from '../engine/errors.js';
import { Wallets } from './wallets.js';

const HOST = '127.0.0.1';
const PORT = Number(process.env.PORT ?? 4321);
const DATABASE_PATH = resolve(process.env.DATABASE_PATH ?? fileURLToPath(new URL('../data/agent-checkout-guard.sqlite', import.meta.url)));
const MAX_BODY_BYTES = 10_000;
const APPROVAL_CHECK_MS = 60_000;
const SESSION_COOKIE = 'acg_session';

const STATIC_FILES = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/styles.css': ['styles.css', 'text/css; charset=utf-8'],
  ...Object.fromEntries(ASSET_PATHS.map((path) => [path, [path.slice(1), 'image/svg+xml']])),
};

const db = openDatabase(DATABASE_PATH);
const auth = new Auth(db);
const connections = new Connections(db, loadSigner(`${dirname(DATABASE_PATH)}/consent-signing-key.pem`));
const wallets = new Wallets({ db, connections });

function sendJson(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(body));
}

async function readJson(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > MAX_BODY_BYTES) throw new GuardError('Request is too large.', 413);
  }
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    throw new GuardError('Request is not valid JSON.');
  }
}

function assertSameOrigin(req) {
  const { origin, host } = req.headers;
  if (origin && (origin === 'null' || new URL(origin).host !== host)) throw new GuardError('Cross-origin request refused.', 403);
}

function sessionToken(req) {
  const match = (req.headers.cookie ?? '').match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([a-f0-9]+)`));
  return match?.[1] ?? null;
}

function sessionCookie(value, maxAgeSeconds) {
  return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSeconds}`;
}

function streamEvents(req, res, { guard, token, session }) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
  const send = (state) => {
    if (auth.session(token)) res.write(`data: ${JSON.stringify(state)}\n\n`);
    else res.end();
  };
  send(guard.snapshot());
  const unsubscribe = guard.subscribe(send);
  const expiry = setTimeout(() => res.end(), session.expiresAt - Date.now());
  req.on('close', () => {
    unsubscribe();
    clearTimeout(expiry);
  });
}

function handleAuth(req, res, pathname, body) {
  if (pathname === '/api/auth/code') {
    const { email, demoCode, expiresAt } = auth.requestSignInCode(body.email);
    sendJson(res, 200, { email, demoCode, expiresAt });
    return true;
  }
  if (pathname === '/api/auth/verify') {
    const { sessionToken: token, user } = auth.verifySignIn(body.email, body.code);
    wallets.get(user.id).guard.recordEvent('security', 'Signed in with a one-time code.');
    sendJson(res, 200, { user }, { 'Set-Cookie': sessionCookie(token, SESSION_MS / 1000) });
    return true;
  }
  return false;
}

function startStepUp(user, token, body) {
  let subject;
  let agent;
  if (body.connectionId) {
    const agentId = connections.agentIdFor(user.id, body.connectionId);
    if (!agentId) throw new GuardError('Connection not found.', 404);
    subject = `edit:${body.connectionId}`;
    agent = demoAgent(agentId);
  } else {
    agent = demoAgent(body.agentId);
    if (!agent) throw new GuardError('Agent not found.', 404);
    if (connections.hasActive(user.id, agent.id)) throw new GuardError('This agent is already connected.', 409);
    subject = `connect:${agent.id}`;
  }
  const challenge = auth.createStepUp({ userId: user.id, sessionToken: token, subject });
  wallets.get(user.id).guard.recordEvent('security', `Started step-up verification for ${agent.shortName}.`);
  return { ...challenge, agent };
}

function agentTokenFor(user, connectionId) {
  const token = connections.mockAgentToken(user.id, connectionId);
  if (!token) throw new GuardError('Choose a connected agent.', 409);
  return token;
}

function handleConnections(res, pathname, body, { user, token, guard }) {
  const grantFor = () => auth.stepUpGrant({ challengeId: body.challengeId, userId: user.id, sessionToken: token });

  if (pathname === '/api/connections/step-up') return sendJson(res, 200, startStepUp(user, token, body));
  if (pathname === '/api/connections/step-up/verify') {
    auth.verifyStepUp({ challengeId: body.challengeId, userId: user.id, sessionToken: token, code: body.code });
    guard.recordEvent('security', 'Step-up verification passed.');
    return sendJson(res, 200, { verified: true });
  }
  if (pathname === '/api/connections/preview') {
    return sendJson(res, 200, wallets.previewConsent({ user, grant: grantFor(), input: body.permissions }));
  }
  if (pathname === '/api/connections/allow') {
    const grant = grantFor();
    wallets.allowConsent({ user, grant, input: body.permissions });
    auth.consumeStepUp(grant.challengeId);
    return sendJson(res, 200, guard.snapshot());
  }
  if (pathname === '/api/connections/cancel') {
    const grant = grantFor();
    auth.consumeStepUp(grant.challengeId);
    guard.recordEvent('security', 'Canceled the consent screen. Nothing was changed.');
    return sendJson(res, 200, guard.snapshot());
  }
  return undefined;
}

function handleWallet(res, pathname, body, { user, guard, agent }) {
  const decision = pathname.match(/^\/api\/purchases\/([\w-]+)\/decision$/);
  const report = pathname.match(/^\/api\/purchases\/([\w-]+)\/report$/);
  const refundStep = pathname.match(/^\/api\/refunds\/([\w-]+)\/advance$/);
  const revoke = pathname.match(/^\/api\/connections\/([\w-]+)\/revoke$/);

  if (pathname === '/api/rules') {
    guard.setRules(body);
  } else if (revoke) {
    guard.revokeConnection(revoke[1]);
  } else if (pathname === '/api/agent/run') {
    if (!agent.run(agentTokenFor(user, body.connectionId))) throw new GuardError('The agent is already shopping.', 409);
  } else if (pathname === '/api/agent/overreach') {
    if (!agent.simulateOverreach(agentTokenFor(user, body.connectionId))) throw new GuardError('The agent is already shopping.', 409);
  } else if (pathname === '/api/agent/resume') {
    guard.resumeAgent();
  } else if (pathname === '/api/simulate/uncleared-charge') {
    guard.recordUnclearedCharge(UNCLEARED_CHARGE);
  } else if (pathname === '/api/simulate/next-day') {
    guard.advanceDay();
  } else if (decision) {
    guard.decide(decision[1], body.approve === true);
  } else if (report) {
    guard.reportProblem(report[1], body);
  } else if (refundStep) {
    guard.advanceRefund(refundStep[1], body.outcome);
  } else if (pathname === '/api/reset') {
    agent.stop();
    guard.reset();
  } else {
    throw new GuardError('Not found.', 404);
  }
  sendJson(res, 200, guard.snapshot());
}

function requireSession(req) {
  const token = sessionToken(req);
  const session = auth.session(token);
  if (!session) throw new GuardError('Your session has expired. Sign in again.', 401);
  return { token, session, user: session.user, ...wallets.get(session.user.id) };
}

async function handlePost(req, res, pathname) {
  assertSameOrigin(req);
  const body = await readJson(req);
  if (handleAuth(req, res, pathname, body)) return;

  const context = requireSession(req);
  if (pathname === '/api/auth/signout') {
    context.guard.recordEvent('security', 'Signed out.');
    auth.signOut(context.token);
    sendJson(res, 200, {}, { 'Set-Cookie': sessionCookie('', 0) });
    return;
  }
  if (/^\/api\/connections\/(step-up|step-up\/verify|preview|allow|cancel)$/.test(pathname)) {
    handleConnections(res, pathname, body, context);
    return;
  }
  handleWallet(res, pathname, body, context);
}

async function handle(req, res) {
  const { pathname } = new URL(req.url, 'http://localhost');
  if (req.method === 'POST') return handlePost(req, res, pathname);
  if (req.method !== 'GET') throw new GuardError('Method not allowed.', 405);
  if (pathname === '/api/session') {
    const { user, session } = requireSession(req);
    return sendJson(res, 200, { user, expiresAt: session.expiresAt, agents: DEMO_AGENTS });
  }
  if (pathname === '/api/state') return sendJson(res, 200, requireSession(req).guard.snapshot());
  if (pathname === '/api/events') return streamEvents(req, res, requireSession(req));
  if (pathname === '/favicon.ico') return res.writeHead(204).end();

  const file = STATIC_FILES[pathname];
  if (!file) throw new GuardError('Not found.', 404);
  const content = await readFile(fileURLToPath(new URL(`../public/${file[0]}`, import.meta.url)));
  res.writeHead(200, {
    'Content-Type': file[1],
    'Cache-Control': 'no-cache',
    'Content-Security-Policy': "default-src 'self'",
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(content);
}

setInterval(() => wallets.sweepApprovals(), APPROVAL_CHECK_MS);

createServer((req, res) => {
  handle(req, res).catch((error) => {
    if (!(error instanceof GuardError)) console.error(error);
    const status = error instanceof GuardError ? error.status : 500;
    sendJson(res, status, { error: error instanceof GuardError ? error.message : 'Something went wrong.' });
  });
}).listen(PORT, HOST, () => {
  console.log(`Agent Checkout Guard is running at http://localhost:${PORT}`);
});
