import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';

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

        async function fetchJson(u: string) {
          const r = await fetch(u, { headers: { 'Accept': 'application/json' } });
          if (!r.ok) throw new Error(String(r.status));
          return r.json();
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
            const data: any = await fetchJson(`https://openlibrary.org/isbn/${encodeURIComponent(isbn)}.json`);
            result = {
              title: data.title,
              authors: Array.isArray(data.authors)
                ? await (async () => {
                    const names: string[] = [];
                    for (const a of data.authors) {
                      if (a && a.key) {
                        try {
                          const ad = await fetchJson(`https://openlibrary.org${a.key}.json`);
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
          const data: any = await fetchJson(urlSearch);
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
        params.set('limit', '6');

        const r = await fetch(`https://openlibrary.org/search.json?${params.toString()}`, { headers: { Accept: 'application/json' } });
        if (!r.ok) throw new Error(String(r.status));
        const data: any = await r.json();
        const out = Array.isArray(data.docs)
          ? data.docs.slice(0, 6).map((doc: any) => {
              const isbn13 = Array.isArray(doc.isbn) ? doc.isbn.find((x: string) => /^\d{13}$/.test(x)) : undefined;
              const isbn10 = Array.isArray(doc.isbn) ? doc.isbn.find((x: string) => /^\d{10}$/.test(x)) : undefined;
              return {
                title: doc.title,
                authors: Array.isArray(doc.author_name) ? doc.author_name : undefined,
                isbn13,
                isbn10,
                coverUrl: doc.cover_i ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg` : (isbn13 ? `https://covers.openlibrary.org/b/isbn/${isbn13}-M.jpg` : undefined),
                source: 'openlibrary' as const,
              };
            })
          : [];
        return sendJSON(res, 200, { results: out });
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
