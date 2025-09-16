import React, { useEffect, useState } from 'react';

export function App() {
  const [status, setStatus] = useState<'loading' | 'ok' | 'error'>('loading');

  useEffect(() => {
    fetch('/health')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(() => setStatus('ok'))
      .catch(() => setStatus('error'));
  }, []);

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: 24 }}>
      <h1>Bibliomanager2</h1>
      <p>Statut serveur: {status === 'loading' ? 'chargement…' : status}</p>
    </main>
  );
}

