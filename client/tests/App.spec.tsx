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
  it('shows ok when health returns ok', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'ok' }),
    } as Response);

    render(<App />);
    expect(await screen.findByText(/Statut serveur:/i)).toBeInTheDocument();
    expect(await screen.findByText(/ok$/i)).toBeInTheDocument();
  });

  it('shows error when health fails', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValue(new Error('network'));
    render(<App />);
    expect(await screen.findByText(/error$/i)).toBeInTheDocument();
  });
});

