import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { mkdir, writeFile as fsWriteFile, stat as fsStat } from 'node:fs/promises';
import { readFile } from 'node:fs/promises';
import { randomBytes, timingSafeEqual, createHmac, scrypt as _scrypt } from 'node:crypto';
import net from 'node:net';

// Simple in-memory cache + polite rate limiting for Open Library
const OPENLIB_TTL_MS = 10 * 60 * 1000; // 10 minutes
const OPENLIB_MIN_INTERVAL_MS = 1000; // ~1 req/sec
const OPENLIB_UA = 'Bibliomanager2/0.0.6 (+https://example.invalid)';
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

// --- Auth & roles (file-based) ---
type UserRecord = { username: string; pass: string; roles: string[] };
type SessionClaims = { u: string; r: string[]; exp: number };

const dataDir = join(process.cwd(), 'data');
const usersPath = join(dataDir, 'users.json');
const secretPath = join(dataDir, 'auth_secret');

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

  if (method === 'GET' && url.pathname === '/health') {
    return sendJSON(res, 200, { status: 'ok' });
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
        // Require authenticated role (admin/import/loans)
        const cookies = parseCookies(req);
        const token = cookies['bm2_auth'] || '';
        const claims = token ? await verifyToken(token) : null;
        if (!claims || !Array.isArray(claims.r) || !claims.r.some((r) => r === 'admin' || r === 'import' || r === 'loans')) {
          return sendJSON(res, 401, { error: 'unauthorized' });
        }
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
        if (!username || !password) return sendJSON(res, 400, { error: 'missing_credentials' });
        const users = await readUsers();
        const u = users.find((x) => x.username === username);
        if (!u || !(await verifyPassword(u.pass, password))) return sendJSON(res, 401, { error: 'invalid_credentials' });
        const exp = Math.floor(Date.now() / 1000) + (60 * 60 * 12); // 12h
        const token = await signToken({ u: u.username, r: Array.isArray(u.roles) ? u.roles : [], exp });
        setCookie(res, 'bm2_auth', token, { httpOnly: true, sameSite: 'Lax', maxAge: 60 * 60 * 12 });
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
  // Users management (admin only)
  if (url.pathname.startsWith('/api/users')) {
    (async () => {
      const cookies = parseCookies(req);
      const token = cookies['bm2_auth'] || '';
      const claims = token ? await verifyToken(token) : null;
      if (!claims || !claims.r.includes('admin')) return sendJSON(res, 401, { error: 'unauthorized' });
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

  // ZPL print passthrough: POST /api/print/zpl { host, port?: 9100, zpl }
  if (method === 'POST' && url.pathname === '/api/print/zpl') {
    (async () => {
      try {
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
          const params: string[] = [];
          if (q) params.push(`q=${encodeURIComponent(q)}`);
          if (title) params.push(`title=${encodeURIComponent(title)}`);
          if (author) params.push(`author=${encodeURIComponent(author)}`);
          params.push('limit=1');
          const urlSearch = `https://openlibrary.org/search.json?${params.join('&')}`;
          const data: any = await fetchJsonPolite(urlSearch);
          const doc = data?.docs?.[0];
          if (doc) {
            const docIsbn: string | undefined = Array.isArray(doc.isbn) ? doc.isbn.find((x: string) => x && x.length >= 10) : undefined;
            result = {
              title: doc.title,
              authors: Array.isArray(doc.author_name) ? doc.author_name : undefined,
              isbn10: Array.isArray(doc.isbn) ? doc.isbn.find((x: string) => x.length === 10) : undefined,
              isbn13: Array.isArray(doc.isbn) ? doc.isbn.find((x: string) => x.length === 13) : undefined,
              coverUrl: doc.cover_i ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg` : docIsbn ? coverByIsbn(docIsbn) : undefined,
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
  return sendText(res, 200, 'Bibliomanager2');
}

export function makeServer() {
  return createServer(requestHandler);
}

export async function startServer(port: number) {
  const server = makeServer();
  await new Promise<void>((resolve) => server.listen(port, resolve));
  return server;
}
