import { startServer } from './server.js';

export function hello(name: string) {
  return `Hello, ${name}!`;
}

if (process.env.NODE_ENV !== 'test') {
  const port = Number(process.env.PORT || 3000);
  // eslint-disable-next-line no-console
  startServer(port).then(() => console.log(`HTTP server listening on http://localhost:${port}`));
}
