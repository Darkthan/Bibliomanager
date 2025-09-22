import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { App } from '../src/App';

declare global {
  // eslint-disable-next-line no-var
  var fetch: typeof fetch;
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('App', () => {
  it('renders header and navigation', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ status: 'ok' }) } as Response);
    render(<App />);
    // App title
    expect(await screen.findByText(/Bibliomanager/i)).toBeInTheDocument();
    // Settings button
    expect(screen.getByLabelText(/Paramètres/i)).toBeInTheDocument();
    // Login button present when logged out
    expect(screen.getByText(/Se connecter/i)).toBeInTheDocument();
  });

  it('renders even if health check fails', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValue(new Error('network'));
    render(<App />);
    const titles = await screen.findAllByText(/Bibliomanager/i);
    expect(titles.length).toBeGreaterThan(0);
  });
});
