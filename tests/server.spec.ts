import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServer } from '../src/server';
import type { AddressInfo } from 'node:net';

let baseURL = '';
let server: Awaited<ReturnType<typeof startServer>>;

beforeAll(async () => {
  server = await startServer(0);
  const addr = server.address() as AddressInfo;
  baseURL = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('HTTP server', () => {
  it('responds on /health with status ok', async () => {
    const res = await fetch(`${baseURL}/health`);
    expect(res.ok).toBe(true);
    const json = await res.json();
    expect(json).toEqual({ status: 'ok' });
  });

  it('serves root with default text', async () => {
    const res = await fetch(`${baseURL}/`);
    expect(res.ok).toBe(true);
    const text = await res.text();
    expect(text).toContain('Bibliomanager2');
  });
});

