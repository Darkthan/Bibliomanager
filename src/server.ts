import { createServer, IncomingMessage, ServerResponse } from 'node:http';

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
