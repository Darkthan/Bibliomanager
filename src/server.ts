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
