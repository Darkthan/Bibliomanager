import 'dotenv/config';
import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { mkdir, writeFile as fsWriteFile, stat as fsStat } from 'node:fs/promises';
import { readFile } from 'node:fs/promises';
import { randomBytes, timingSafeEqual, createHmac, scrypt as _scrypt, createHash } from 'node:crypto';
import net from 'node:net';
import { 
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import { isoBase64URL } from '@simplewebauthn/server/helpers';
import type {
  GenerateRegistrationOptionsOpts,
  GenerateAuthenticationOptionsOpts,
  VerifyRegistrationResponseOpts,
  VerifyAuthenticationResponseOpts,
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
} from '@simplewebauthn/server';

// Simple in-memory cache + polite rate limiting for Open Library
const OPENLIB_TTL_MS = 10 * 60 * 1000; // 10 minutes
const OPENLIB_MIN_INTERVAL_MS = 1000; // ~1 req/sec
const OPENLIB_UA = 'Bibliomanager/0.0.6 (+https://example.invalid)';
const cache = new Map<string, { expires: number; data: any }>();
const inflight = new Map<string, Promise<any>>();
let rateChain: Promise<void> = Promise.resolve();
let lastFetchAt = 0;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function rateLimit(): Promise<void> {
  // Chain sequentially to avoid concurrent bursts
  rateChain = rateChain.then(async () => {
    const now = Date.now();
    const wait = Math.max(0, OPENLIB_MIN_INTERVAL_MS - (now - lastFetchAt));
    if (wait > 0) await sleep(wait);
    lastFetchAt = Date.now();
  });
  return rateChain;
}

async function fetchJsonPolite(url: string): Promise<any> {
  const now = Date.now();
  const cached = cache.get(url);
  if (cached && cached.expires > now) return cached.data;
  const existing = inflight.get(url);
  if (existing) return existing;
  const p = (async () => {
    await rateLimit();
    const r = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': OPENLIB_UA } as any });
    if (!r.ok) throw new Error(String(r.status));
    const data = await r.json();
    cache.set(url, { expires: Date.now() + OPENLIB_TTL_MS, data });
    return data;
  })()
    .finally(() => inflight.delete(url));
  inflight.set(url, p);
  return p;
}

function sendJSON(res: ServerResponse, status: number, body: unknown) {
  const json = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Length', Buffer.byteLength(json));
  res.end(json);
}

function sendText(res: ServerResponse, status: number, body: string) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.end(body);
}

// --- API key handling ---
function getApiKeys(): string[] {
  const env = String(process.env.API_KEYS || process.env.API_KEY || '').trim();
  if (!env) return [];
  return env.split(',').map((s) => s.trim()).filter(Boolean);
}

function hasRequiredRole(roles: string[] | undefined | null, required: string[]): boolean {
  if (!required || required.length === 0) return Array.isArray(roles) && roles.length > 0;
  if (!Array.isArray(roles)) return false;
  if (roles.includes('admin')) return true;
  return required.some((r) => roles.includes(r));
}

// (moved below after dataDir initialization)

// --- Auth & roles (file-based) ---
type UserRecord = { username: string; pass: string; roles: string[] };
type SessionClaims = { u: string; r: string[]; exp: number };

// --- WebAuthn/Passkey types ---
type PasskeyRecord = {
  id: string;
  credentialID: string; // base64url encoded
  credentialPublicKey: string; // base64url encoded
  counter: number;
  credentialDeviceType: 'singleDevice' | 'multiDevice';
  credentialBackedUp: boolean;
  transports?: AuthenticatorTransport[];
  username: string;
  name: string;
  createdAt: number;
};

type ChallengeRecord = {
  challenge: string;
  username: string;
  expiresAt: number;
};

const dataDir = join(process.cwd(), 'data');
const usersPath = join(dataDir, 'users.json');
const secretPath = join(dataDir, 'auth_secret');
const passkeysPath = join(dataDir, 'passkeys.json');

// WebAuthn configuration - defaults from environment
const defaultRpID = process.env.RP_ID || 'localhost';
const defaultRpName = 'Bibliomanager';
const defaultRpOrigin = process.env.RP_ORIGIN || `http://localhost:${process.env.PORT || 3000}`;

// Get effective WebAuthn configuration (admin config takes precedence over env vars)
async function getWebAuthnConfig() {
  const adminConfig = await readWebAuthnConfig();
  return {
    rpID: adminConfig.rpId || defaultRpID,
    rpName: adminConfig.rpName || defaultRpName,
    rpOrigin: adminConfig.rpOrigin || defaultRpOrigin,
  };
}

// In-memory storage for challenges (in production, use Redis or similar)
const challenges = new Map<string, ChallengeRecord>();

// --- API keys persisted storage (after dataDir is defined) ---
type ApiKeyRecord = { id: string; label?: string; hash: string; createdAt: number; lastUsedAt?: number };
const apiKeysPath = join(dataDir, 'api_keys.json');

async function readApiKeys(): Promise<ApiKeyRecord[]> {
  try {
    const buf = await readFile(apiKeysPath);
    const arr = JSON.parse(buf.toString('utf-8')) as any[];
    if (Array.isArray(arr)) {
      return arr
        .map((k: any) => ({ id: String(k.id), label: typeof k.label === 'string' ? k.label : undefined, hash: String(k.hash || ''), createdAt: Number(k.createdAt || 0), lastUsedAt: k.lastUsedAt ? Number(k.lastUsedAt) : undefined }))
        .filter((x) => x.id && x.hash);
    }
  } catch {}
  return [];
}
async function writeApiKeys(keys: ApiKeyRecord[]) {
  await mkdir(dataDir, { recursive: true });
  await fsWriteFile(apiKeysPath, JSON.stringify(keys, null, 2));
}
function sha256Hex(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}
async function isApiKeyValid(provided: string | null | undefined): Promise<boolean> {
  const key = (provided || '').trim();
  if (!key) return false;
  const envs = getApiKeys();
  if (envs.includes(key)) return true;
  const list = await readApiKeys();
  const h = sha256Hex(key);
  return list.some((k) => k.hash === h);
}

async function ensureSecret(): Promise<Buffer> {
  await mkdir(dataDir, { recursive: true });
  try {
    const b = await readFile(secretPath);
    if (b && b.length >= 32) return b;
  } catch {}
  const s = randomBytes(48);
  await fsWriteFile(secretPath, s);
  return s;
}

async function readUsers(): Promise<UserRecord[]> {
  try {
    const buf = await readFile(usersPath);
    const arr = JSON.parse(buf.toString('utf-8')) as any[];
    if (Array.isArray(arr)) return arr.filter(Boolean) as UserRecord[];
  } catch {}
  return [];
}
async function writeUsers(users: UserRecord[]) {
  await mkdir(dataDir, { recursive: true });
  await fsWriteFile(usersPath, JSON.stringify(users, null, 2));
}

async function readPasskeys(): Promise<PasskeyRecord[]> {
  try {
    const buf = await readFile(passkeysPath);
    const arr = JSON.parse(buf.toString('utf-8')) as any[];
    console.log('Read passkeys from file:', arr.length, 'entries');
    if (Array.isArray(arr)) {
      return arr.map((p: any) => ({
        id: String(p.id),
        credentialID: String(p.credentialID),
        credentialPublicKey: String(p.credentialPublicKey),
        counter: Number(p.counter || 0),
        credentialDeviceType: p.credentialDeviceType || 'singleDevice',
        credentialBackedUp: Boolean(p.credentialBackedUp),
        transports: Array.isArray(p.transports) ? p.transports : undefined,
        username: String(p.username),
        name: String(p.name || ''),
        createdAt: Number(p.createdAt || Date.now()),
      }));
    }
  } catch (err) {
    console.log('Error reading passkeys file or file does not exist:', err instanceof Error ? err.message : String(err));
  }
  return [];
}

async function writePasskeys(passkeys: PasskeyRecord[]) {
  await mkdir(dataDir, { recursive: true });
  await fsWriteFile(passkeysPath, JSON.stringify(passkeys, null, 2));
}

// WebAuthn Configuration
const webauthnConfigPath = join(dataDir, 'webauthn_config.json');

async function readWebAuthnConfig(): Promise<{ rpId: string; rpOrigin: string; rpName: string }> {
  try {
    const data = await readFile(webauthnConfigPath, 'utf-8');
    const config = JSON.parse(data);
    return {
      rpId: String(config.rpId || '').trim(),
      rpOrigin: String(config.rpOrigin || '').trim(),
      rpName: String(config.rpName || 'Bibliomanager').trim(),
    };
  } catch {
    // Return default/empty config if file doesn't exist or can't be read
    return { rpId: '', rpOrigin: '', rpName: 'Bibliomanager' };
  }
}

async function writeWebAuthnConfig(config: { rpId: string; rpOrigin: string; rpName: string }) {
  await mkdir(dataDir, { recursive: true });
  await fsWriteFile(webauthnConfigPath, JSON.stringify(config, null, 2));
}

// Helper functions for base64url encoding/decoding
function uint8ArrayToBase64url(buffer: Uint8Array | any): string {
  if (buffer instanceof Uint8Array) {
    return isoBase64URL.fromBuffer(new Uint8Array(buffer));
  }
  return isoBase64URL.fromBuffer(new Uint8Array(buffer));
}

function base64urlToUint8Array(base64url: string): Uint8Array {
  return new Uint8Array(isoBase64URL.toBuffer(base64url));
}

function cleanExpiredChallenges() {
  const now = Date.now();
  for (const [key, value] of challenges) {
    if (value.expiresAt < now) {
      challenges.delete(key);
    }
  }
}

function parseCookies(req: IncomingMessage): Record<string, string> {
  const raw = (req.headers['cookie'] as string) || '';
  const out: Record<string, string> = {};
  raw.split(/;\s*/).forEach((p) => {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i)] = decodeURIComponent(p.slice(i + 1));
  });
  return out;
}

function setCookie(res: ServerResponse, name: string, val: string, opts: { httpOnly?: boolean; path?: string; maxAge?: number; sameSite?: 'Lax' | 'Strict' | 'None' } = {}) {
  const parts = [`${name}=${encodeURIComponent(val)}`];
  parts.push(`Path=${opts.path || '/'}`);
  parts.push('Secure');
  parts.push(`SameSite=${opts.sameSite || 'Lax'}`);
  if (opts.httpOnly !== false) parts.push('HttpOnly');
  if (opts.maxAge) parts.push(`Max-Age=${Math.floor(opts.maxAge)}`);
  const prev = res.getHeader('Set-Cookie');
  const header = Array.isArray(prev) ? [...prev, parts.join('; ')] : prev ? [String(prev), parts.join('; ')] : [parts.join('; ')];
  res.setHeader('Set-Cookie', header);
}

function clearCookie(res: ServerResponse, name: string) {
  setCookie(res, name, '', { maxAge: 0 });
}

function base64url(b: Buffer) {
  return b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function signToken(claims: SessionClaims): Promise<string> {
  const secret = await ensureSecret();
  const header = base64url(Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const payload = base64url(Buffer.from(JSON.stringify(claims)));
  const toSign = `${header}.${payload}`;
  const sig = createHmac('sha256', secret).update(toSign).digest();
  return `${toSign}.${base64url(sig)}`;
}

async function verifyToken(token: string): Promise<SessionClaims | null> {
  try {
    const secret = await ensureSecret();
    const [h, p, s] = token.split('.');
    if (!h || !p || !s) return null;
    const toSign = `${h}.${p}`;
    const expSig = createHmac('sha256', secret).update(toSign).digest();
    const gotSig = Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    if (expSig.length !== gotSig.length || !timingSafeEqual(expSig, gotSig)) return null;
    const claims = JSON.parse(Buffer.from(p.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8')) as SessionClaims;
    if (typeof claims.exp !== 'number' || Date.now() / 1000 >= claims.exp) return null;
    if (!Array.isArray(claims.r)) return null;
    return claims;
  } catch {
    return null;
  }
}

function scrypt(pass: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    _scrypt(pass, salt, 64, (err, derivedKey) => {
      if (err) reject(err); else resolve(derivedKey as Buffer);
    });
  });
}

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt);
  return `s2:${salt.toString('base64')}:${key.toString('base64')}`;
}

async function verifyPassword(stored: string, password: string): Promise<boolean> {
  try {
    const [tag, saltB64, keyB64] = stored.split(':');
    if (tag !== 's2') return false;
    const salt = Buffer.from(saltB64, 'base64');
    const key = Buffer.from(keyB64, 'base64');
    const got = await scrypt(password, salt);
    return got.length === key.length && timingSafeEqual(got, key);
  } catch { return false; }
}

export function requestHandler(req: IncomingMessage, res: ServerResponse) {
  const method = req.method || 'GET';
  const host = (req.headers.host as string) || 'localhost';
  const url = new URL(req.url || '/', `http://${host}`);
  const apiKeyFromReq = ((req.headers['x-api-key'] as string) || url.searchParams.get('api_key') || '').trim();

  if (method === 'GET' && url.pathname === '/health') {
    return sendJSON(res, 200, { status: 'ok' });
  }

  // API Keys management (admin session only; API key cannot manage keys)
  if (url.pathname.startsWith('/api/apikeys')) {
    (async () => {
      const cookies = parseCookies(req);
      const token = cookies['bm2_auth'] || '';
      const claims = token ? await verifyToken(token) : null;
      if (!claims || !claims.r.includes('admin')) return sendJSON(res, 401, { error: 'unauthorized' });

      if (method === 'GET' && url.pathname === '/api/apikeys') {
        const list = await readApiKeys();
        const safe = list.map((k) => ({ id: k.id, label: k.label, createdAt: k.createdAt }));
        return sendJSON(res, 200, { keys: safe });
      }
      if (method === 'POST' && url.pathname === '/api/apikeys') {
        try {
          const chunks: Buffer[] = [];
          await new Promise<void>((resolve, reject) => { req.on('data', (c) => chunks.push(c as Buffer)); req.on('end', resolve); req.on('error', reject); });
          const body = JSON.parse(Buffer.concat(chunks).toString('utf-8') || '{}');
          const label = String(body.label || '').trim();
          // Generate token (base32 Crockford 28 chars)
          const buf = randomBytes(20);
          const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
          let bits = 0, val = 0, out = '';
          for (let i = 0; i < buf.length; i++) {
            val = (val << 8) | buf[i];
            bits += 8;
            while (bits >= 5) { out += alphabet[(val >>> (bits - 5)) & 31]; bits -= 5; }
          }
          if (bits > 0) out += alphabet[(val << (5 - bits)) & 31];
          const token = out.slice(0, 28);
          const recs = await readApiKeys();
          const id = 'k_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
          recs.push({ id, label: label || undefined, hash: sha256Hex(token), createdAt: Date.now() });
          await writeApiKeys(recs);
          return sendJSON(res, 200, { id, token }); // Return token once
        } catch (e: any) {
          return sendJSON(res, 400, { error: 'create_failed', message: e?.message || String(e) });
        }
      }
      const m = /^\/api\/apikeys\/([^/]+)$/.exec(url.pathname);
      if (m) {
        const id = decodeURIComponent(m[1]);
        if (method === 'DELETE') {
          const recs = await readApiKeys();
          const idx = recs.findIndex((k) => k.id === id);
          if (idx < 0) return sendJSON(res, 404, { error: 'not_found' });
          recs.splice(idx, 1);
          await writeApiKeys(recs);
          return sendJSON(res, 200, { ok: true });
        }
      }
      return sendJSON(res, 405, { error: 'method_not_allowed' });
    })();
    return;
  }

  // Simple JSON storage for app state (books + loans)
  const dbPath = join(dataDir, 'db.json');

  async function readState(): Promise<{ books: any[]; loans: any[] }> {
    try {
      const buf = await readFile(dbPath);
      const parsed = JSON.parse(buf.toString('utf-8')) as any;
      const books = Array.isArray(parsed?.books) ? parsed.books : [];
      const loans = Array.isArray(parsed?.loans) ? parsed.loans : [];
      return { books, loans };
    } catch {
      return { books: [], loans: [] };
    }
  }
  async function writeState(state: { books: any[]; loans: any[] }) {
    await mkdir(dataDir, { recursive: true });
    const payload = JSON.stringify({ books: state.books, loans: state.loans }, null, 2);
    await fsWriteFile(dbPath, payload);
  }

  // GET current state
  if (method === 'GET' && url.pathname === '/api/state') {
    (async () => {
      try {
        // Require session or API key for reading state
        const cookies = parseCookies(req);
        const token = cookies['bm2_auth'] || '';
        const claims = token ? await verifyToken(token) : null;
        const apiValid = await isApiKeyValid(apiKeyFromReq);
        if (!claims && !apiValid) return sendJSON(res, 401, { error: 'unauthorized' });
        const state = await readState();
        return sendJSON(res, 200, state);
      } catch (e: any) {
        return sendJSON(res, 500, { error: 'read_state_failed', message: e?.message || String(e) });
      }
    })();
    return;
  }

  // Public read-only state (no auth required)
  if (method === 'GET' && url.pathname === '/api/state/public') {
    (async () => {
      try {
        const state = await readState();
        return sendJSON(res, 200, state);
      } catch (e: any) {
        return sendJSON(res, 500, { error: 'read_state_failed', message: e?.message || String(e) });
      }
    })();
    return;
  }

  // POST new state (replace)
  if (method === 'POST' && url.pathname === '/api/state') {
    (async () => {
      try {
        // Require authenticated role (admin/import/loans) or valid API key
        const cookies = parseCookies(req);
        const token = cookies['bm2_auth'] || '';
        const claims = token ? await verifyToken(token) : null;
        const apiValid = await isApiKeyValid(apiKeyFromReq);
        const ok = apiValid || hasRequiredRole(claims?.r, ['import', 'loans']);
        if (!ok) return sendJSON(res, 401, { error: 'unauthorized' });
        const chunks: Buffer[] = [];
        let size = 0;
        await new Promise<void>((resolve, reject) => {
          req.on('data', (c) => {
            chunks.push(c as Buffer);
            size += (c as Buffer).length;
            if (size > 1_000_000) { // 1MB limit
              reject(new Error('payload_too_large'));
              req.destroy();
            }
          });
          req.on('end', resolve);
          req.on('error', reject);
        });
        const raw = Buffer.concat(chunks).toString('utf-8');
        const body = JSON.parse(raw || '{}');
        const books = Array.isArray(body.books) ? body.books : [];
        const loans = Array.isArray(body.loans) ? body.loans : [];
        await writeState({ books, loans });
        return sendJSON(res, 200, { ok: true });
      } catch (e: any) {
        return sendJSON(res, 400, { error: 'write_state_failed', message: e?.message || String(e) });
      }
    })();
    return;
  }

  // Mark books as label printed: POST /api/books/mark-printed
  if (method === 'POST' && url.pathname === '/api/books/mark-printed') {
    (async () => {
      try {
        // Require authenticated role (admin/import/loans) or valid API key
        const cookies = parseCookies(req);
        const token = cookies['bm2_auth'] || '';
        const claims = token ? await verifyToken(token) : null;
        const apiValid = await isApiKeyValid(apiKeyFromReq);
        const ok = apiValid || hasRequiredRole(claims?.r, ['import', 'loans']);
        if (!ok) return sendJSON(res, 401, { error: 'unauthorized' });

        const chunks: Buffer[] = [];
        await new Promise<void>((resolve, reject) => {
          req.on('data', (c) => chunks.push(c as Buffer));
          req.on('end', resolve);
          req.on('error', reject);
        });
        const body = JSON.parse(Buffer.concat(chunks).toString('utf-8') || '{}');
        const bookIds = Array.isArray(body.bookIds) ? body.bookIds : [];

        if (bookIds.length === 0) {
          return sendJSON(res, 400, { error: 'no_book_ids' });
        }

        const state = await readState();
        let updated = 0;

        state.books = state.books.map(book => {
          if (bookIds.includes(book.id)) {
            updated++;
            return { ...book, labelPrinted: true, labelPrintedAt: Date.now() };
          }
          return book;
        });

        await writeState(state);
        return sendJSON(res, 200, { ok: true, updated });
      } catch (e: any) {
        return sendJSON(res, 400, { error: 'mark_printed_failed', message: e?.message || String(e) });
      }
    })();
    return;
  }

  // --- Auth endpoints ---
  if (url.pathname === '/api/auth/me') {
    (async () => {
      const cookies = parseCookies(req);
      const token = cookies['bm2_auth'] || '';
      const claims = token ? await verifyToken(token) : null;
      if (!claims) return sendJSON(res, 200, { user: null, roles: ['guest'] });
      return sendJSON(res, 200, { user: { username: claims.u }, roles: claims.r });
    })();
    return;
  }
  if (method === 'POST' && url.pathname === '/api/auth/login') {
    (async () => {
      try {
        const chunks: Buffer[] = [];
        await new Promise<void>((resolve, reject) => { req.on('data', (c) => chunks.push(c as Buffer)); req.on('end', resolve); req.on('error', reject); });
        const body = JSON.parse(Buffer.concat(chunks).toString('utf-8') || '{}');
        const username = String(body.username || '').trim();
        const password = String(body.password || '');
        const remember = !!body.remember;
        if (!username || !password) return sendJSON(res, 400, { error: 'missing_credentials' });
        const users = await readUsers();
        const u = users.find((x) => x.username === username);
        if (!u || !(await verifyPassword(u.pass, password))) return sendJSON(res, 401, { error: 'invalid_credentials' });
        const ttl = remember ? (60 * 60 * 24 * 30) : (60 * 60 * 12); // 30 jours ou 12h
        const exp = Math.floor(Date.now() / 1000) + ttl;
        const token = await signToken({ u: u.username, r: Array.isArray(u.roles) ? u.roles : [], exp });
        setCookie(res, 'bm2_auth', token, { httpOnly: true, sameSite: 'Lax', maxAge: ttl });
        return sendJSON(res, 200, { ok: true });
      } catch (e: any) {
        return sendJSON(res, 400, { error: 'login_failed', message: e?.message || String(e) });
      }
    })();
    return;
  }
  if (method === 'POST' && url.pathname === '/api/auth/logout') {
    clearCookie(res, 'bm2_auth');
    return sendJSON(res, 200, { ok: true });
  }

  // WebAuthn/Passkey endpoints
  if (method === 'POST' && url.pathname === '/api/auth/webauthn/register/begin') {
    (async () => {
      try {
        console.log('WebAuthn register/begin called');
        const chunks: Buffer[] = [];
        await new Promise<void>((resolve, reject) => { req.on('data', (c) => chunks.push(c as Buffer)); req.on('end', resolve); req.on('error', reject); });
        const body = JSON.parse(Buffer.concat(chunks).toString('utf-8') || '{}');
        console.log('Request body:', body);
        
        const cookies = parseCookies(req);
        const token = cookies['bm2_auth'] || '';
        const claims = token ? await verifyToken(token) : null;
        if (!claims) return sendJSON(res, 401, { error: 'unauthorized' });

        const username = claims.u;
        const passkeyName = String(body.name || '').trim() || 'New Passkey';
        
        const users = await readUsers();
        const user = users.find(u => u.username === username);
        if (!user) return sendJSON(res, 404, { error: 'user_not_found' });

        const passkeys = await readPasskeys();
        const userPasskeys = passkeys.filter(p => p.username === username);

        cleanExpiredChallenges();

        const webauthnConfig = await getWebAuthnConfig();
        console.log('WebAuthn RP Configuration:', webauthnConfig);

        const options = await generateRegistrationOptions({
          rpName: webauthnConfig.rpName,
          rpID: webauthnConfig.rpID,
          userID: Buffer.from(username, 'utf-8'),
          userName: username,
          userDisplayName: username,
          attestationType: 'none',
          excludeCredentials: userPasskeys.map(passkey => ({
            id: passkey.credentialID,
            transports: passkey.transports,
          } as any)),
          supportedAlgorithmIDs: [-7, -257], // ES256, RS256
          authenticatorSelection: {
            authenticatorAttachment: 'platform',
            userVerification: 'preferred',
            requireResidentKey: true, // Crée des discoverable credentials
            residentKey: 'required',
          },
        });

        const challengeKey = `${username}-${Date.now()}`;
        challenges.set(challengeKey, {
          challenge: options.challenge,
          username,
          expiresAt: Date.now() + 300000, // 5 minutes
        });

        return sendJSON(res, 200, { 
          options,
          challengeKey,
          name: passkeyName 
        });
      } catch (e: any) {
        return sendJSON(res, 500, { error: 'registration_failed', message: e?.message || String(e) });
      }
    })();
    return;
  }

  if (method === 'POST' && url.pathname === '/api/auth/webauthn/register/finish') {
    (async () => {
      try {
        const chunks: Buffer[] = [];
        await new Promise<void>((resolve, reject) => { req.on('data', (c) => chunks.push(c as Buffer)); req.on('end', resolve); req.on('error', reject); });
        const body = JSON.parse(Buffer.concat(chunks).toString('utf-8') || '{}');
        
        const cookies = parseCookies(req);
        const token = cookies['bm2_auth'] || '';
        const claims = token ? await verifyToken(token) : null;
        if (!claims) return sendJSON(res, 401, { error: 'unauthorized' });

        const { challengeKey, name, response } = body;
        console.log('Registration response received:', {
          challengeKey,
          name,
          responseId: response?.id,
          responseRawId: response?.rawId
        });
        if (!challengeKey || !response) return sendJSON(res, 400, { error: 'missing_data' });

        const challengeRecord = challenges.get(challengeKey);
        if (!challengeRecord || challengeRecord.expiresAt < Date.now()) {
          challenges.delete(challengeKey);
          return sendJSON(res, 400, { error: 'invalid_challenge' });
        }

        if (challengeRecord.username !== claims.u) {
          return sendJSON(res, 403, { error: 'unauthorized' });
        }

        const webauthnConfig = await getWebAuthnConfig();
        const verification = await verifyRegistrationResponse({
          response: response as RegistrationResponseJSON,
          expectedChallenge: challengeRecord.challenge,
          expectedOrigin: webauthnConfig.rpOrigin,
          expectedRPID: webauthnConfig.rpID,
        });

        if (!verification.verified || !verification.registrationInfo) {
          return sendJSON(res, 400, { error: 'verification_failed' });
        }

        const { registrationInfo } = verification;
        console.log('Full registrationInfo:', JSON.stringify(registrationInfo, null, 2));
        console.log('registrationInfo.credential:', registrationInfo.credential);
        console.log('registrationInfo keys:', Object.keys(registrationInfo));

        const passkeys = await readPasskeys();
        console.log('Current passkeys before adding:', passkeys.length);

        const credentialID = registrationInfo.credential.id; // Déjà une chaîne base64url
        console.log('Using credentialID:', credentialID);

        const newPasskey: PasskeyRecord = {
          id: randomBytes(16).toString('hex'),
          credentialID,
          credentialPublicKey: uint8ArrayToBase64url(registrationInfo.credential.publicKey),
          counter: registrationInfo.credential.counter,
          credentialDeviceType: registrationInfo.credentialDeviceType,
          credentialBackedUp: registrationInfo.credentialBackedUp,
          transports: response.response?.transports,
          username: claims.u,
          name: String(name || 'New Passkey'),
          createdAt: Date.now(),
        };

        passkeys.push(newPasskey);
        console.log('New passkey created:', { id: newPasskey.id, credentialID: newPasskey.credentialID, username: newPasskey.username });
        console.log('Total passkeys after adding:', passkeys.length);

        await writePasskeys(passkeys);
        console.log('Passkeys written to file successfully');

        challenges.delete(challengeKey);

        return sendJSON(res, 200, { 
          ok: true, 
          passkey: {
            id: newPasskey.id,
            name: newPasskey.name,
            createdAt: newPasskey.createdAt
          }
        });
      } catch (e: any) {
        return sendJSON(res, 500, { error: 'registration_failed', message: e?.message || String(e) });
      }
    })();
    return;
  }

  // Usernameless WebAuthn authentication (discoverable credentials)
  if (method === 'POST' && url.pathname === '/api/auth/webauthn/authenticate/usernameless/begin') {
    (async () => {
      try {
        cleanExpiredChallenges();

        const webauthnConfig = await getWebAuthnConfig();
        console.log('WebAuthn Usernameless Auth Configuration:', webauthnConfig);

        const options = await generateAuthenticationOptions({
          rpID: webauthnConfig.rpID,
          allowCredentials: [], // Vide pour permettre la découverte automatique
          userVerification: 'preferred',
        });

        const challengeKey = `usernameless-auth-${Date.now()}`;
        challenges.set(challengeKey, {
          challenge: options.challenge,
          username: '', // Pas de nom d'utilisateur spécifié
          expiresAt: Date.now() + 300000, // 5 minutes
        });

        return sendJSON(res, 200, { options, challengeKey });
      } catch (e: any) {
        console.error('Usernameless auth begin error:', e);
        return sendJSON(res, 500, { error: 'auth_begin_failed', message: e?.message || String(e) });
      }
    })();
    return;
  }


  // Usernameless WebAuthn authentication finish
  if (method === 'POST' && url.pathname === '/api/auth/webauthn/authenticate/usernameless/finish') {
    (async () => {
      try {
        const chunks: Buffer[] = [];
        await new Promise<void>((resolve, reject) => { req.on('data', (c) => chunks.push(c as Buffer)); req.on('end', resolve); req.on('error', reject); });
        const body = JSON.parse(Buffer.concat(chunks).toString('utf-8') || '{}');

        const { challengeKey, response } = body;
        console.log('Usernameless auth finish - challengeKey:', challengeKey, 'response.id:', response?.id);
        if (!challengeKey || !response) {
          console.log('Missing data - challengeKey:', !!challengeKey, 'response:', !!response);
          return sendJSON(res, 400, { error: 'missing_data' });
        }

        const challengeRecord = challenges.get(challengeKey);
        if (!challengeRecord || challengeRecord.expiresAt < Date.now()) {
          console.log('Invalid challenge - found:', !!challengeRecord, 'expired:', challengeRecord ? challengeRecord.expiresAt < Date.now() : 'N/A');
          challenges.delete(challengeKey);
          return sendJSON(res, 400, { error: 'invalid_challenge' });
        }

        const passkeys = await readPasskeys();
        console.log('Total passkeys:', passkeys.length);

        // Pour usernameless auth, on cherche dans toutes les passkeys
        const credentialID = response.id;
        console.log('Looking for credentialID:', credentialID);
        const passkey = passkeys.find(p => p.credentialID === credentialID);

        if (!passkey) {
          console.log('Credential not found. Available credentials:', passkeys.map(p => p.credentialID));
          return sendJSON(res, 400, {
            error: 'credential_not_found',
            debug: {
              requestedId: credentialID,
              availableIds: passkeys.map(p => p.credentialID)
            }
          });
        }
        console.log('Found passkey for user:', passkey.username);

        const webauthnConfig = await getWebAuthnConfig();
        console.log('WebAuthn config for verification:', webauthnConfig);
        console.log('Expected challenge:', challengeRecord.challenge);
        console.log('Response ID:', response.id);
        console.log('Response raw:', JSON.stringify(response, null, 2));

        const verification = await verifyAuthenticationResponse({
          response: response as AuthenticationResponseJSON,
          expectedChallenge: challengeRecord.challenge,
          expectedOrigin: webauthnConfig.rpOrigin,
          expectedRPID: webauthnConfig.rpID,
          credential: {
            id: passkey.credentialID,
            publicKey: base64urlToUint8Array(passkey.credentialPublicKey) as any,
            counter: passkey.counter,
            transports: passkey.transports,
          },
        });

        console.log('Verification result:', verification.verified);
        if (!verification.verified) {
          console.log('Verification failed:', verification);
          return sendJSON(res, 400, {
            error: 'verification_failed',
            debug: {
              verified: verification.verified,
              rpID: webauthnConfig.rpID,
              rpOrigin: webauthnConfig.rpOrigin
            }
          });
        }

        // Update counter
        passkey.counter = verification.authenticationInfo.newCounter;
        await writePasskeys(passkeys);

        // Create session for the discovered user
        const username = passkey.username;
        const users = await readUsers();
        const u = users.find((x) => x.username === username);
        if (!u) {
          return sendJSON(res, 400, { error: 'user_not_found' });
        }

        const ttl = 60 * 60 * 12; // 12h
        const exp = Math.floor(Date.now() / 1000) + ttl;
        const token = await signToken({ u: u.username, r: Array.isArray(u.roles) ? u.roles : [], exp });
        setCookie(res, 'bm2_auth', token, { httpOnly: true, sameSite: 'Lax', maxAge: ttl });

        challenges.delete(challengeKey);
        return sendJSON(res, 200, { success: true, username });
      } catch (e: any) {
        console.error('Usernameless auth finish error:', e);
        return sendJSON(res, 500, { error: 'authentication_failed', message: e?.message || String(e) });
      }
    })();
    return;
  }

  // Users management (admin only)
  if (url.pathname.startsWith('/api/users')) {
    (async () => {
      const cookies = parseCookies(req);
      const token = cookies['bm2_auth'] || '';
      const claims = token ? await verifyToken(token) : null;
      const apiValid = await isApiKeyValid(apiKeyFromReq);
      if (!apiValid && (!claims || !claims.r.includes('admin'))) return sendJSON(res, 401, { error: 'unauthorized' });
      const users = await readUsers();
      if (method === 'GET' && url.pathname === '/api/users') {
        const safe = users.map((u) => ({ username: u.username, roles: u.roles || [] }));
        return sendJSON(res, 200, { users: safe });
      }
      if (method === 'POST' && url.pathname === '/api/users') {
        const chunks: Buffer[] = [];
        await new Promise<void>((resolve, reject) => { req.on('data', (c) => chunks.push(c as Buffer)); req.on('end', resolve); req.on('error', reject); });
        const body = JSON.parse(Buffer.concat(chunks).toString('utf-8') || '{}');
        const username = String(body.username || '').trim();
        const password = String(body.password || '');
        const roles = Array.isArray(body.roles) ? body.roles.filter((r: any) => typeof r === 'string') : [];
        if (!username || !password) return sendJSON(res, 400, { error: 'missing_fields' });
        if (users.some((u) => u.username === username)) return sendJSON(res, 409, { error: 'exists' });
        const pass = await hashPassword(password);
        users.push({ username, pass, roles });
        await writeUsers(users);
        return sendJSON(res, 200, { ok: true });
      }
      const m = /^\/api\/users\/([^/]+)$/.exec(url.pathname);
      if (m) {
        const uname = decodeURIComponent(m[1]);
        const idx = users.findIndex((u) => u.username === uname);
        if (idx < 0) return sendJSON(res, 404, { error: 'not_found' });
        if (method === 'PUT') {
          const chunks: Buffer[] = [];
          await new Promise<void>((resolve, reject) => { req.on('data', (c) => chunks.push(c as Buffer)); req.on('end', resolve); req.on('error', reject); });
          const body = JSON.parse(Buffer.concat(chunks).toString('utf-8') || '{}');
          if (typeof body.password === 'string' && body.password) {
            users[idx].pass = await hashPassword(body.password);
          }
          if (Array.isArray(body.roles)) {
            users[idx].roles = body.roles.filter((r: any) => typeof r === 'string');
          }
          await writeUsers(users);
          return sendJSON(res, 200, { ok: true });
        }
        if (method === 'DELETE') {
          users.splice(idx, 1);
          await writeUsers(users);
          return sendJSON(res, 200, { ok: true });
        }
      }
      return sendJSON(res, 405, { error: 'method_not_allowed' });
    })();
    return;
  }

  // Passkey management endpoints
  if (url.pathname.startsWith('/api/passkeys')) {
    (async () => {
      const cookies = parseCookies(req);
      const token = cookies['bm2_auth'] || '';
      const claims = token ? await verifyToken(token) : null;
      if (!claims) return sendJSON(res, 401, { error: 'unauthorized' });

      // List user's passkeys: GET /api/passkeys
      if (method === 'GET' && url.pathname === '/api/passkeys') {
        const passkeys = await readPasskeys();
        const userPasskeys = passkeys
          .filter(p => p.username === claims.u)
          .map(p => ({
            id: p.id,
            name: p.name,
            createdAt: p.createdAt,
            credentialDeviceType: p.credentialDeviceType,
            credentialBackedUp: p.credentialBackedUp,
          }));
        return sendJSON(res, 200, { passkeys: userPasskeys });
      }

      // Delete user's passkey: DELETE /api/passkeys/:id
      const deleteMatch = /^\/api\/passkeys\/([^/]+)$/.exec(url.pathname);
      if (method === 'DELETE' && deleteMatch) {
        const passkeyId = decodeURIComponent(deleteMatch[1]);
        const passkeys = await readPasskeys();
        const idx = passkeys.findIndex(p => p.id === passkeyId && p.username === claims.u);
        if (idx < 0) return sendJSON(res, 404, { error: 'not_found' });
        
        passkeys.splice(idx, 1);
        await writePasskeys(passkeys);
        return sendJSON(res, 200, { ok: true });
      }

      // Rename user's passkey: PUT /api/passkeys/:id
      const renameMatch = /^\/api\/passkeys\/([^/]+)$/.exec(url.pathname);
      if (method === 'PUT' && renameMatch) {
        const passkeyId = decodeURIComponent(renameMatch[1]);
        const chunks: Buffer[] = [];
        await new Promise<void>((resolve, reject) => { req.on('data', (c) => chunks.push(c as Buffer)); req.on('end', resolve); req.on('error', reject); });
        const body = JSON.parse(Buffer.concat(chunks).toString('utf-8') || '{}');
        
        const newName = String(body.name || '').trim();
        if (!newName) return sendJSON(res, 400, { error: 'missing_name' });
        
        const passkeys = await readPasskeys();
        const idx = passkeys.findIndex(p => p.id === passkeyId && p.username === claims.u);
        if (idx < 0) return sendJSON(res, 404, { error: 'not_found' });
        
        passkeys[idx].name = newName;
        await writePasskeys(passkeys);
        return sendJSON(res, 200, { ok: true });
      }

      return sendJSON(res, 405, { error: 'method_not_allowed' });
    })();
    return;
  }

  // Admin passkey management endpoints
  if (url.pathname.startsWith('/api/admin/passkeys')) {
    (async () => {
      const cookies = parseCookies(req);
      const token = cookies['bm2_auth'] || '';
      const claims = token ? await verifyToken(token) : null;
      if (!claims || !claims.r.includes('admin')) return sendJSON(res, 401, { error: 'unauthorized' });

      // List all passkeys: GET /api/admin/passkeys
      if (method === 'GET' && url.pathname === '/api/admin/passkeys') {
        const passkeys = await readPasskeys();
        const allPasskeys = passkeys.map(p => ({
          id: p.id,
          username: p.username,
          name: p.name,
          createdAt: p.createdAt,
          credentialDeviceType: p.credentialDeviceType,
          credentialBackedUp: p.credentialBackedUp,
        }));
        return sendJSON(res, 200, { passkeys: allPasskeys });
      }

      // Delete any passkey: DELETE /api/admin/passkeys/:id
      const deleteMatch = /^\/api\/admin\/passkeys\/([^/]+)$/.exec(url.pathname);
      if (method === 'DELETE' && deleteMatch) {
        const passkeyId = decodeURIComponent(deleteMatch[1]);
        const passkeys = await readPasskeys();
        const idx = passkeys.findIndex(p => p.id === passkeyId);
        if (idx < 0) return sendJSON(res, 404, { error: 'not_found' });
        
        passkeys.splice(idx, 1);
        await writePasskeys(passkeys);
        return sendJSON(res, 200, { ok: true });
      }

      // Delete all passkeys for a user: DELETE /api/admin/passkeys/user/:username
      const deleteUserMatch = /^\/api\/admin\/passkeys\/user\/([^/]+)$/.exec(url.pathname);
      if (method === 'DELETE' && deleteUserMatch) {
        const username = decodeURIComponent(deleteUserMatch[1]);
        const passkeys = await readPasskeys();
        const filtered = passkeys.filter(p => p.username !== username);
        await writePasskeys(filtered);
        return sendJSON(res, 200, { ok: true, deleted: passkeys.length - filtered.length });
      }

      return sendJSON(res, 405, { error: 'method_not_allowed' });
    })();
    return;
  }

  // WebAuthn Debug: GET /api/admin/webauthn-debug
  if (method === 'GET' && url.pathname === '/api/admin/webauthn-debug') {
    (async () => {
      const cookies = parseCookies(req);
      const token = cookies['bm2_auth'] || '';
      const claims = token ? await verifyToken(token) : null;
      if (!claims || !claims.r.includes('admin')) return sendJSON(res, 401, { error: 'unauthorized' });

      const adminConfig = await readWebAuthnConfig();
      const effectiveConfig = await getWebAuthnConfig();
      const passkeys = await readPasskeys();

      return sendJSON(res, 200, {
        adminConfig,
        effectiveConfig,
        environmentDefaults: {
          rpID: defaultRpID,
          rpName: defaultRpName,
          rpOrigin: defaultRpOrigin,
        },
        passeysCount: passkeys.length,
        passkeys: passkeys.map(p => ({
          id: p.id,
          username: p.username,
          name: p.name,
          createdAt: p.createdAt,
        })),
      });
    })();
    return;
  }

  // WebAuthn Configuration: GET/POST /api/admin/webauthn-config
  if (url.pathname === '/api/admin/webauthn-config') {
    (async () => {
      const cookies = parseCookies(req);
      const token = cookies['bm2_auth'] || '';
      const claims = token ? await verifyToken(token) : null;
      if (!claims || !claims.r.includes('admin')) return sendJSON(res, 401, { error: 'unauthorized' });

      if (method === 'GET') {
        const config = await readWebAuthnConfig();
        return sendJSON(res, 200, config);
      }

      if (method === 'POST') {
        try {
          const chunks: Buffer[] = [];
          await new Promise<void>((resolve, reject) => { req.on('data', (c) => chunks.push(c as Buffer)); req.on('end', resolve); req.on('error', reject); });
          const body = JSON.parse(Buffer.concat(chunks).toString('utf-8') || '{}');

          const config = {
            rpId: String(body.rpId || '').trim(),
            rpOrigin: String(body.rpOrigin || '').trim(),
            rpName: String(body.rpName || '').trim(),
          };

          await writeWebAuthnConfig(config);
          return sendJSON(res, 200, { success: true, config });
        } catch (err: any) {
          return sendJSON(res, 400, { error: err.message || 'Invalid JSON' });
        }
      }

      return sendJSON(res, 405, { error: 'method_not_allowed' });
    })();
    return;
  }

  // ZPL print passthrough: POST /api/print/zpl { host, port?: 9100, zpl }
  if (method === 'POST' && url.pathname === '/api/print/zpl') {
    (async () => {
      try {
        // Require authenticated role (admin/import) or valid API key
        const cookies = parseCookies(req);
        const token = cookies['bm2_auth'] || '';
        const claims = token ? await verifyToken(token) : null;
        const apiValid = await isApiKeyValid(apiKeyFromReq);
        const ok = apiValid || hasRequiredRole(claims?.r, ['import']);
        if (!ok) return sendJSON(res, 401, { error: 'unauthorized' });
        const chunks: Buffer[] = [];
        await new Promise<void>((resolve, reject) => {
          req.on('data', (c) => chunks.push(c as Buffer));
          req.on('end', resolve);
          req.on('error', reject);
        });
        const body = JSON.parse(Buffer.concat(chunks).toString('utf-8') || '{}');
        const host = String(body.host || '').trim();
        const port = Number(body.port || 9100);
        const zpl = String(body.zpl || '');
        if (!host || !zpl) return sendJSON(res, 400, { error: 'missing_params' });
        await new Promise<void>((resolve, reject) => {
          const socket = net.createConnection({ host, port }, () => {
            socket.write(zpl, 'utf8');
            socket.end();
          });
          socket.setTimeout(7000);
          socket.on('timeout', () => { socket.destroy(); reject(new Error('timeout')); });
          socket.on('error', reject);
          socket.on('close', () => resolve());
        });
        return sendJSON(res, 200, { ok: true });
      } catch (e: any) {
        return sendJSON(res, 500, { error: 'zpl_failed', message: e?.message || String(e) });
      }
    })();
    return;
  }

  // Serve local agent (Windows PowerShell script)
  if (method === 'GET' && url.pathname === '/agent/zebra-agent.ps1') {
    const agentPath = join(process.cwd(), 'assets', 'zebra-agent.ps1');
    if (existsSync(agentPath)) {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      return createReadStream(agentPath).pipe(res);
    }
    return sendText(res, 404, 'agent_missing');
  }

  // Serve local agent EXE if present
  if (method === 'GET' && url.pathname === '/agent/zebra-agent.exe') {
    const exePath = join(process.cwd(), 'assets', 'zebra-agent.exe');
    if (existsSync(exePath)) {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Disposition', 'attachment; filename="zebra-agent.exe"');
      return createReadStream(exePath).pipe(res);
    }
    return sendText(res, 404, 'agent_exe_missing');
  }

  // Open book data proxy: /api/books/lookup?isbn=&barcode=&title=&author=&q=
  if (method === 'GET' && url.pathname === '/api/books/lookup') {
    (async () => {
      try {
        // Require login or API key
        const cookies = parseCookies(req);
        const token = cookies['bm2_auth'] || '';
        const claims = token ? await verifyToken(token) : null;
        const apiValid = await isApiKeyValid(apiKeyFromReq);
        if (!claims && !apiValid) return sendJSON(res, 401, { error: 'unauthorized' });
        const qp = url.searchParams;
        const rawIsbn = (qp.get('isbn') || '').replace(/[^0-9Xx]/g, '').toUpperCase();
        const barcode = (qp.get('barcode') || '').trim();
        const title = (qp.get('title') || '').trim();
        const author = (qp.get('author') || '').trim();
        const q = (qp.get('q') || '').trim();

        function coverByIsbn(i: string) {
          return `https://covers.openlibrary.org/b/isbn/${encodeURIComponent(i)}-M.jpg`;
        }
        function inferIsbnFromBarcode(bar: string) {
          const digits = String(bar).replace(/\D/g, '');
          if (digits.length === 13 && (digits.startsWith('978') || digits.startsWith('979'))) return digits;
          return '';
        }

        type LookupResult = {
          title?: string;
          authors?: string[];
          isbn10?: string;
          isbn13?: string;
          pages?: number;
          publishDate?: string;
          subjects?: string[];
          coverUrl?: string;
          source?: 'openlibrary';
        };

        let result: LookupResult | null = null;
        let isbn = rawIsbn;
        if (!isbn && barcode) isbn = inferIsbnFromBarcode(barcode);

        if (isbn) {
          // Try OpenLibrary ISBN endpoint
          try {
            const data: any = await fetchJsonPolite(`https://openlibrary.org/isbn/${encodeURIComponent(isbn)}.json`);
            result = {
              title: data.title,
              authors: Array.isArray(data.authors)
                ? await (async () => {
                    const names: string[] = [];
                    for (const a of data.authors) {
                      if (a && a.key) {
                        try {
                          const ad = await fetchJsonPolite(`https://openlibrary.org${a.key}.json`);
                          if (ad && ad.name) names.push(ad.name);
                        } catch {
                          // ignore
                        }
                      }
                    }
                    return names;
                  })()
                : undefined,
              isbn10: Array.isArray(data.isbn_10) ? data.isbn_10[0] : undefined,
              isbn13: Array.isArray(data.isbn_13) ? data.isbn_13[0] : isbn,
              pages: typeof data.number_of_pages === 'number' ? data.number_of_pages : undefined,
              publishDate: data.publish_date,
              subjects: Array.isArray(data.subjects) ? data.subjects.map((s: any) => (typeof s === 'string' ? s : s?.name)).filter(Boolean) : undefined,
              coverUrl: coverByIsbn(isbn),
              source: 'openlibrary',
            };
          } catch {
            // fallback to search
          }
        }

        if (!result) {
          // Fallback search: prefer ISBN search when available, else use q/title/author
          let data: any = null;
          if (isbn) {
            // Direct ISBN search endpoint often succeeds even when ISBN JSON endpoint misses
            data = await fetchJsonPolite(`https://openlibrary.org/search.json?isbn=${encodeURIComponent(isbn)}&limit=1`);
          } else {
            const params: string[] = [];
            if (q) params.push(`q=${encodeURIComponent(q)}`);
            if (title) params.push(`title=${encodeURIComponent(title)}`);
            if (author) params.push(`author=${encodeURIComponent(author)}`);
            params.push('limit=1');
            const urlSearch = `https://openlibrary.org/search.json?${params.join('&')}`;
            data = await fetchJsonPolite(urlSearch);
          }
          const doc = data?.docs?.[0];
          if (doc) {
            const docIsbn: string | undefined = Array.isArray(doc.isbn) ? doc.isbn.find((x: string) => x && x.length >= 10) : undefined;
            result = {
              title: doc.title,
              authors: Array.isArray(doc.author_name) ? doc.author_name : undefined,
              isbn10: Array.isArray(doc.isbn) ? doc.isbn.find((x: string) => x.length === 10) : undefined,
              isbn13: Array.isArray(doc.isbn) ? doc.isbn.find((x: string) => x.length === 13) : (isbn || undefined),
              coverUrl: doc.cover_i ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg` : docIsbn ? coverByIsbn(docIsbn) : (isbn ? coverByIsbn(isbn) : undefined),
              source: 'openlibrary',
            };
          }
        }

        if (!result) return sendJSON(res, 404, { error: 'not_found' });
        return sendJSON(res, 200, result);
      } catch (e: any) {
        return sendJSON(res, 500, { error: 'lookup_failed', message: e?.message || String(e) });
      }
    })();
    return;
  }

  // Search multiple books suggestions
  if (method === 'GET' && url.pathname === '/api/books/search') {
    (async () => {
      try {
        const cookies = parseCookies(req);
        const token = cookies['bm2_auth'] || '';
        const claims = token ? await verifyToken(token) : null;
        const apiValid = await isApiKeyValid(apiKeyFromReq);
        if (!claims && !apiValid) return sendJSON(res, 401, { error: 'unauthorized' });
        const q = (url.searchParams.get('q') || '').trim();
        if (!q) return sendJSON(res, 400, { error: 'missing_q' });

        const isIsbn = /^(97[89])?\d{9}[\dXx]$/.test(q.replace(/[^0-9Xx]/g, ''));
        const params = new URLSearchParams();
        if (isIsbn) params.set('isbn', q.replace(/[^0-9Xx]/g, ''));
        else params.set('q', q);
        params.set('limit', '5');

        const data: any = await fetchJsonPolite(`https://openlibrary.org/search.json?${params.toString()}`);
        const docs: any[] = Array.isArray(data.docs) ? data.docs.slice(0, 5) : [];
        const out = docs.map((doc: any) => {
          const isbn13 = Array.isArray(doc.isbn) ? doc.isbn.find((x: string) => /^\d{13}$/.test(x)) : undefined;
          const isbn10 = Array.isArray(doc.isbn) ? doc.isbn.find((x: string) => /^\d{10}$/.test(x)) : undefined;
          const workKey = typeof doc.key === 'string' && doc.key.startsWith('/works/') ? (doc.key as string).slice('/works/'.length) : undefined;
          return {
            title: doc.title as string | undefined,
            authors: Array.isArray(doc.author_name) ? (doc.author_name as string[]) : undefined,
            isbn13: isbn13 as string | undefined,
            isbn10: isbn10 as string | undefined,
            coverUrl: doc.cover_i ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg` : (isbn13 ? `https://covers.openlibrary.org/b/isbn/${isbn13}-M.jpg` : undefined),
            _editionKey: Array.isArray(doc.edition_key) ? doc.edition_key[0] : undefined,
            workKey,
            source: 'openlibrary' as const,
          };
        });
        // Enrich up to 3 items missing ISBN by fetching their first edition details
        let enriched = 0;
        for (let idx = 0; idx < out.length; idx++) {
          const item = out[idx] as any;
          if (enriched >= 3) break;
          if ((item.isbn13 || item.isbn10) || !docs[idx] || !item._editionKey) continue;
          try {
            const edData: any = await fetchJsonPolite(`https://openlibrary.org/books/${encodeURIComponent(item._editionKey as string)}.json`);
            if (Array.isArray(edData.isbn_13) && edData.isbn_13[0]) item.isbn13 = String(edData.isbn_13[0]);
            if (!item.isbn13 && Array.isArray(edData.isbn_10) && edData.isbn_10[0]) item.isbn10 = String(edData.isbn_10[0]);
            if (!item.coverUrl && item.isbn13) item.coverUrl = `https://covers.openlibrary.org/b/isbn/${item.isbn13}-M.jpg`;
            enriched++;
          } catch {
            // ignore
          }
        }
        const finalOut = out.map(({ _editionKey, ...rest }) => rest);
        return sendJSON(res, 200, { results: finalOut });
      } catch (e: any) {
        return sendJSON(res, 500, { error: 'search_failed', message: e?.message || String(e) });
      }
    })();
    return;
  }

  // Editions listing for a work: /api/books/editions?work=OL82563W&limit=30
  if (method === 'GET' && url.pathname === '/api/books/editions') {
    (async () => {
      try {
        const cookies = parseCookies(req);
        const token = cookies['bm2_auth'] || '';
        const claims = token ? await verifyToken(token) : null;
        const apiValid = await isApiKeyValid(apiKeyFromReq);
        if (!claims && !apiValid) return sendJSON(res, 401, { error: 'unauthorized' });
        const work = (url.searchParams.get('work') || '').trim();
        const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '20', 10) || 20, 1), 50);
        if (!work) return sendJSON(res, 400, { error: 'missing_work' });
        const data: any = await fetchJsonPolite(`https://openlibrary.org/works/${encodeURIComponent(work)}/editions.json?limit=${limit}`);
        const arr: any[] = Array.isArray(data.entries) ? data.entries : [];
        const results = arr.map((ed: any) => {
          const isbn13 = Array.isArray(ed.isbn_13) ? ed.isbn_13 : undefined;
          const isbn10 = Array.isArray(ed.isbn_10) ? ed.isbn_10 : undefined;
          const publishers = Array.isArray(ed.publishers) ? ed.publishers : undefined;
          const editionKey = typeof ed.key === 'string' && ed.key.startsWith('/books/') ? ed.key.slice('/books/'.length) : undefined;
          const coverUrl = ed.covers && ed.covers[0]
            ? `https://covers.openlibrary.org/b/id/${ed.covers[0]}-M.jpg`
            : (isbn13 && isbn13[0] ? `https://covers.openlibrary.org/b/isbn/${isbn13[0]}-M.jpg` : undefined);
          return {
            editionKey,
            title: ed.title as string | undefined,
            publishers: publishers as string[] | undefined,
            publishDate: ed.publish_date as string | undefined,
            pages: typeof ed.number_of_pages === 'number' ? ed.number_of_pages : undefined,
            isbn13: isbn13 as string[] | undefined,
            isbn10: isbn10 as string[] | undefined,
            coverUrl,
          };
        });
        return sendJSON(res, 200, { results });
      } catch (e: any) {
        return sendJSON(res, 500, { error: 'editions_failed', message: e?.message || String(e) });
      }
    })();
    return;
  }

  // Serve static client build if present (but never intercept API or cover routes)
  const clientDir = join(process.cwd(), 'dist', 'client');
  if (
    method === 'GET' &&
    existsSync(clientDir) &&
    !url.pathname.startsWith('/api/') &&
    !url.pathname.startsWith('/covers/')
  ) {
    const reqPath = url.pathname === '/' ? '/index.html' : url.pathname;
    // Prevent path traversal
    const safePath = normalize(reqPath).replace(/^\/+/, '');
    const filePath = join(clientDir, safePath);
    if (existsSync(filePath) && statSync(filePath).isFile()) {
      const ext = extname(filePath).toLowerCase();
      const type =
        ext === '.html' ? 'text/html' :
        ext === '.js' ? 'application/javascript' :
        ext === '.css' ? 'text/css' :
        ext === '.json' ? 'application/json' :
        ext === '.svg' ? 'image/svg+xml' :
        ext === '.ico' ? 'image/x-icon' :
        'application/octet-stream';
      res.statusCode = 200;
      res.setHeader('Content-Type', type);
      return createReadStream(filePath).pipe(res);
    }
    // SPA fallback to index.html
    const indexPath = join(clientDir, 'index.html');
    if (existsSync(indexPath)) {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return createReadStream(indexPath).pipe(res);
    }
  }

  // Dynamic cover caching: /covers/isbn/:isbn?s=M|S|L
  if (method === 'GET' && url.pathname.startsWith('/covers/isbn/')) {
    (async () => {
      try {
        const parts = url.pathname.split('/');
        const raw = parts[parts.length - 1] || '';
        const isbn = raw.replace(/[^0-9Xx]/g, '').toUpperCase();
        if (!isbn || isbn.length < 10) return sendText(res, 400, 'bad isbn');
        const size = (url.searchParams.get('s') || 'M').toUpperCase();
        const s = size === 'S' || size === 'L' ? size : 'M';
        const cacheDir = join(process.cwd(), 'cache', 'covers');
        const filePath = join(cacheDir, `${isbn}-${s}.jpg`);
        const force = url.searchParams.get('force') === '1';
        try {
          const st = await fsStat(filePath);
          if (!force && st && st.isFile()) {
            res.statusCode = 200;
            res.setHeader('Content-Type', 'image/jpeg');
            return createReadStream(filePath).pipe(res);
          }
        } catch {}
        await mkdir(cacheDir, { recursive: true });
        const remote = `https://covers.openlibrary.org/b/isbn/${encodeURIComponent(isbn)}-${s}.jpg?default=false`;
        const r = await fetch(remote, { headers: { 'User-Agent': OPENLIB_UA } as any });
        if (!r.ok) return sendText(res, 404, 'not found');
        const buf = Buffer.from(await r.arrayBuffer());
        await fsWriteFile(filePath, buf);
        res.statusCode = 200;
        res.setHeader('Content-Type', 'image/jpeg');
        res.setHeader('Content-Length', String(buf.length));
        return res.end(buf);
      } catch (e: any) {
        return sendText(res, 500, 'cover error');
      }
    })();
    return;
  }

  // Default route
  return sendText(res, 200, 'Bibliomanager');
}

export function makeServer() {
  return createServer(requestHandler);
}

export async function startServer(port: number) {
  // Ensure there is at least one admin user on first run
  async function ensureDefaultAdmin() {
    try {
      const users = await readUsers();
      const hasAdmin = users.some((u) => Array.isArray(u.roles) && u.roles.includes('admin'));
      if (!hasAdmin) {
        const pass = await hashPassword('admin');
        users.push({ username: 'admin', pass, roles: ['admin', 'import', 'loans'] });
        await writeUsers(users);
        // eslint-disable-next-line no-console
        console.log('[auth] Default admin created: username="admin" password="admin" (please change it)');
      }
    } catch {
      // ignore bootstrap error
    }
  }

  await ensureDefaultAdmin();
  const server = makeServer();
  await new Promise<void>((resolve) => server.listen(port, resolve));
  return server;
}
