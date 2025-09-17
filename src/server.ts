import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';

// Simple in-memory cache + polite rate limiting for Open Library
const OPENLIB_TTL_MS = 10 * 60 * 1000; // 10 minutes
const OPENLIB_MIN_INTERVAL_MS = 1000; // ~1 req/sec
const OPENLIB_UA = 'Bibliomanager2/0.0.3 (+https://example.invalid)';
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

export function requestHandler(req: IncomingMessage, res: ServerResponse) {
  const method = req.method || 'GET';
  const host = (req.headers.host as string) || 'localhost';
  const url = new URL(req.url || '/', `http://${host}`);

  if (method === 'GET' && url.pathname === '/health') {
    return sendJSON(res, 200, { status: 'ok' });
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
          return {
            title: doc.title as string | undefined,
            authors: Array.isArray(doc.author_name) ? (doc.author_name as string[]) : undefined,
            isbn13: isbn13 as string | undefined,
            isbn10: isbn10 as string | undefined,
            coverUrl: doc.cover_i ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg` : (isbn13 ? `https://covers.openlibrary.org/b/isbn/${isbn13}-M.jpg` : undefined),
            _editionKey: Array.isArray(doc.edition_key) ? doc.edition_key[0] : undefined,
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

  // Serve static client build if present
  const clientDir = join(process.cwd(), 'dist', 'client');
  if (method === 'GET' && existsSync(clientDir)) {
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
