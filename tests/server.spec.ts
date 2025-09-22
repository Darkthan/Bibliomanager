import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServer } from '../src/server';
import type { AddressInfo } from 'node:net';
import http from 'node:http';

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
    const json = await new Promise<any>((resolve, reject) => {
      http.get(`${baseURL}/health`, (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(e);
          }
        });
      }).on('error', reject);
    });
    expect(json).toEqual({ status: 'ok' });
  });

  it('serves root with default text', async () => {
    const text = await new Promise<string>((resolve, reject) => {
      http.get(`${baseURL}/`, (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => resolve(data));
      }).on('error', reject);
    });
    // App name was renamed to "Bibliomanager"
    expect(text).toContain('Bibliomanager');
  });
});
