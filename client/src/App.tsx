import React, { useEffect, useMemo, useState } from 'react';

type Book = {
  id: number;
  title: string;
  author: string;
  read: boolean;
  createdAt: number;
  isbn?: string;
  barcode?: string;
};

type Loan = {
  id: number;
  bookId: number;
  borrower: string;
  startDate: string; // YYYY-MM-DD
  dueDate: string; // YYYY-MM-DD
  returnedAt?: string; // YYYY-MM-DD
};

export function App() {
  const [status, setStatus] = useState<'loading' | 'ok' | 'error'>('loading');
  const [books, setBooks] = useState<Book[]>([]);
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [isbn, setIsbn] = useState('');
  const [barcode, setBarcode] = useState('');
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'read' | 'unread'>('all');
  const [sortBy, setSortBy] = useState<'recent' | 'title' | 'author'>('recent');
  const [loans, setLoans] = useState<Loan[]>([]);
  const [loanBookId, setLoanBookId] = useState<number | ''>('');
  const [loanBookQuery, setLoanBookQuery] = useState('');
  const [showBookSuggestions, setShowBookSuggestions] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState<number>(-1);
  const [loanBorrower, setLoanBorrower] = useState('');
  const [loanStartDate, setLoanStartDate] = useState('');
  const [loanDueDate, setLoanDueDate] = useState('');
  const [loanFilter, setLoanFilter] = useState<'active' | 'overdue' | 'returned' | 'all'>('active');
  const [bookLookupLoading, setBookLookupLoading] = useState(false);
  const [bookLookupError, setBookLookupError] = useState<string | null>(null);
  const [editingBookId, setEditingBookId] = useState<number | null>(null);
  const [loanListQuery, setLoanListQuery] = useState('');
  const [route, setRoute] = useState('/livres/disponibles');
  // Suggestions pour l'ajout (base ouverte)
  const [addQuery, setAddQuery] = useState('');
  const [showAddSuggestions, setShowAddSuggestions] = useState(false);
  const [addSuggestions, setAddSuggestions] = useState<Array<{ title: string; authors?: string[]; isbn13?: string; isbn10?: string; coverUrl?: string }>>([]);
  const [addHighlightIndex, setAddHighlightIndex] = useState(-1);
  const [addLoading, setAddLoading] = useState(false);
  useEffect(() => {
    const sync = () => setRoute(window.location.pathname || '/');
    window.addEventListener('popstate', sync);
    sync();
    return () => window.removeEventListener('popstate', sync);
  }, []);
  function navigate(to: string) {
    if (to === route) return;
    window.history.pushState({}, '', to);
    setRoute(to);
  }
  const isAddDisabled = useMemo(() => title.trim().length === 0 || author.trim().length === 0, [title, author]);

  // Health check
  useEffect(() => {
    fetch('/health')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(() => setStatus('ok'))
      .catch(() => setStatus('error'));
  }, []);

  // Persistence: load once
  useEffect(() => {
    try {
      const raw = localStorage.getItem('bm2/books');
      if (raw) {
        const parsed = JSON.parse(raw) as Book[];
        if (Array.isArray(parsed)) setBooks(parsed);
      }
    } catch {
      // ignore
    }
    try {
      const rawLoans = localStorage.getItem('bm2/loans');
      if (rawLoans) {
        const parsed = JSON.parse(rawLoans) as Loan[];
        if (Array.isArray(parsed)) setLoans(parsed);
      }
    } catch {
      // ignore
    }
    // initialize loan dates
    const today = new Date();
    const toISO = (d: Date) => d.toISOString().slice(0, 10);
    const inDays = (n: number) => {
      const d = new Date(today);
      d.setDate(d.getDate() + n);
      return d;
    };
    setLoanStartDate(toISO(today));
    setLoanDueDate(toISO(inDays(14)));
  }, []);

  // Persistence: save on change
  useEffect(() => {
    try {
      localStorage.setItem('bm2/books', JSON.stringify(books));
    } catch {
      // ignore
    }
  }, [books]);

  useEffect(() => {
    try {
      localStorage.setItem('bm2/loans', JSON.stringify(loans));
    } catch {
      // ignore
    }
  }, [loans]);

  function addBook() {
    if (isAddDisabled) return;
    const cleanIsbn = isbn.replace(/[^0-9Xx]/g, '').toUpperCase();
    setBooks((prev) => [
      {
        id: Date.now(),
        title: title.trim(),
        author: author.trim(),
        read: false,
        createdAt: Date.now(),
        isbn: cleanIsbn || undefined,
        barcode: barcode.trim() || undefined,
      },
      ...prev,
    ]);
    setTitle('');
    setAuthor('');
    setIsbn('');
    setBarcode('');
  }

  function removeBook(id: number) {
    setBooks((prev) => prev.filter((b) => b.id !== id));
  }

  function saveBookEdit(id: number, patch: Partial<Book>) {
    setBooks((prev) => prev.map((b) => (b.id === id ? { ...b, ...patch } : b)));
    setEditingBookId(null);
  }

  function toggleRead(id: number) {
    setBooks((prev) => prev.map((b) => (b.id === id ? { ...b, read: !b.read } : b)));
  }

  const stats = useMemo(() => {
    const total = books.length;
    const read = books.filter((b) => b.read).length;
    return { total, read, unread: total - read };
  }, [books]);

  const visibleBooks = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = books.filter((b) => {
      const matchesQuery = q === '' || b.title.toLowerCase().includes(q) || b.author.toLowerCase().includes(q);
      const matchesStatus =
        statusFilter === 'all' ? true : statusFilter === 'read' ? b.read : !b.read;
      return matchesQuery && matchesStatus;
    });
    list = list.sort((a, b) => {
      if (sortBy === 'recent') return b.createdAt - a.createdAt;
      if (sortBy === 'title') return a.title.localeCompare(b.title);
      return a.author.localeCompare(b.author);
    });
    return list;
  }, [books, query, statusFilter, sortBy]);

  const bookSuggestions = useMemo(() => {
    const raw = loanBookQuery.trim();
    const q = raw.toLowerCase();
    if (!q) return [];
    const qDigits = raw.replace(/[^0-9xX]/g, '').toLowerCase();
    const norm = (s: string) => s.toLowerCase();
    type Scored = { book: Book; score: number };
    const scored: Scored[] = [];
    for (const b of books) {
      const t = norm(b.title);
      const a = norm(b.author);
      const i = (b.isbn || '').toLowerCase();
      const cb = (b.barcode || '').toLowerCase();
      let score = 0;
      if (qDigits) {
        if (i.startsWith(qDigits)) score = Math.max(score, 100);
        if (cb.startsWith(qDigits)) score = Math.max(score, 95);
        if (i.includes(qDigits)) score = Math.max(score, 60);
        if (cb.includes(qDigits)) score = Math.max(score, 55);
      }
      if (t.startsWith(q)) score = Math.max(score, 90);
      if (a.startsWith(q)) score = Math.max(score, 85);
      if (t.includes(q)) score = Math.max(score, 70);
      if (a.includes(q)) score = Math.max(score, 65);
      if (score > 0) scored.push({ book: b, score });
    }
    scored.sort((x, y) => (y.score - x.score) || (y.book.createdAt - x.book.createdAt));
    return scored.slice(0, 8).map((s) => s.book);
  }, [books, loanBookQuery]);

  useEffect(() => {
    // Reset highlighted suggestion when query or list opens/changes
    setHighlightIndex(bookSuggestions.length > 0 ? 0 : -1);
  }, [loanBookQuery, showBookSuggestions, books.length]);

  function selectLoanBook(b: Book) {
    setLoanBookId(b.id);
    const parts = [b.title, b.author].filter(Boolean).join(' — ');
    const codes = [b.isbn ? `ISBN ${b.isbn}` : null, b.barcode ? `CB ${b.barcode}` : null].filter(Boolean).join(' · ');
    setLoanBookQuery(codes ? `${parts} (${codes})` : parts);
    setShowBookSuggestions(false);
  }

  function escapeRegExp(s: string) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  function highlight(text: string, query: string) {
    if (!query) return <>{text}</>;
    try {
      const re = new RegExp(escapeRegExp(query), 'ig');
      const parts: Array<string | JSX.Element> = [];
      let lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text))) {
        const start = m.index;
        if (start > lastIndex) parts.push(text.slice(lastIndex, start));
        const matched = text.slice(start, start + m[0].length);
        parts.push(
          <mark key={start} style={{ background: '#FEF3C7', padding: 0 }}>{matched}</mark>
        );
        lastIndex = start + m[0].length;
      }
      if (lastIndex < text.length) parts.push(text.slice(lastIndex));
      return <>{parts}</>;
    } catch {
      return <>{text}</>;
    }
  }

  // ISBN helpers
  function normalizeISBN(input: string) {
    return input.replace(/[^0-9Xx]/g, '').toUpperCase();
  }
  function validateIsbn10(isbn10: string) {
    if (!/^\d{9}[\dX]$/.test(isbn10)) return false;
    let sum = 0;
    for (let i = 0; i < 9; i++) sum += (i + 1) * Number(isbn10[i]);
    const check = isbn10[9] === 'X' ? 10 : Number(isbn10[9]);
    sum += 10 * check;
    return sum % 11 === 0;
  }
  function validateIsbn13(isbn13: string) {
    if (!/^\d{13}$/.test(isbn13)) return false;
    let sum = 0;
    for (let i = 0; i < 12; i++) sum += Number(isbn13[i]) * (i % 2 === 0 ? 1 : 3);
    const check = (10 - (sum % 10)) % 10;
    return check === Number(isbn13[12]);
  }
  function inferIsbnFromBarcode(bar: string) {
    const digits = bar.replace(/\D/g, '');
    if (digits.length === 13 && (digits.startsWith('978') || digits.startsWith('979'))) return digits;
    return '';
  }

  // Auto-renseigner ISBN à partir du code-barres si possible
  useEffect(() => {
    if (!isbn && barcode) {
      const inferred = inferIsbnFromBarcode(barcode);
      if (inferred) setIsbn(inferred);
    }
  }, [barcode]);

  const isbnValidityHint = useMemo(() => {
    const n = normalizeISBN(isbn);
    if (!n) return null;
    if (n.length === 10) return validateIsbn10(n) ? null : "ISBN-10 invalide";
    if (n.length === 13) return validateIsbn13(n) ? null : "ISBN-13 invalide";
    return "Longueur d'ISBN attendue: 10 ou 13";
  }, [isbn]);

  // Recherche suggestions pour l'ajout
  useEffect(() => {
    if (!showAddSuggestions) return;
    const q = addQuery.trim();
    if (q.length < 3) {
      setAddSuggestions([]);
      setAddHighlightIndex(-1);
      return;
    }
    let active = true;
    const t = setTimeout(async () => {
      try {
        setAddLoading(true);
        const r = await fetch(`/api/books/search?q=${encodeURIComponent(q)}`);
        if (!r.ok) throw new Error('Erreur recherche');
        const data = (await r.json()) as any;
        if (!active) return;
        const list = Array.isArray(data.results) ? data.results : [];
        setAddSuggestions(list);
        setAddHighlightIndex(list.length > 0 ? 0 : -1);
      } catch {
        if (!active) return;
        setAddSuggestions([]);
        setAddHighlightIndex(-1);
      } finally {
        if (active) setAddLoading(false);
      }
    }, 200);
    return () => { active = false; clearTimeout(t); };
  }, [addQuery, showAddSuggestions]);

  function addBookDirect(t: string, a: string, isbnVal?: string, barcodeVal?: string) {
    if (t.trim().length === 0 || a.trim().length === 0) return;
    const cleanIsbn = (isbnVal || '').replace(/[^0-9Xx]/g, '').toUpperCase();
    const cleanBarcode = (barcodeVal || '').trim();
    setBooks((prev) => [
      {
        id: Date.now(),
        title: t.trim(),
        author: a.trim(),
        read: false,
        createdAt: Date.now(),
        isbn: cleanIsbn || undefined,
        barcode: cleanBarcode || undefined,
      },
      ...prev,
    ]);
    setTitle('');
    setAuthor('');
    setIsbn('');
    setBarcode('');
  }

  async function addFromSuggestion(s: { title: string; authors?: string[]; isbn13?: string; isbn10?: string }) {
    const t = s.title || '';
    const a = Array.isArray(s.authors) && s.authors[0] ? s.authors[0] : '';
    let i = s.isbn13 || s.isbn10 || '';
    // Si pas d'ISBN fourni par la suggestion, tenter un lookup ciblé puis seulement pré-remplir
    if (!i && t) {
      try {
        const params = new URLSearchParams();
        params.set('title', t);
        if (a) params.set('author', a);
        const r = await fetch(`/api/books/lookup?${params.toString()}`);
        if (r.ok) {
          const d = (await r.json()) as any;
          i = d.isbn13 || d.isbn10 || '';
        }
      } catch {
        // ignore si lookup échoue
      }
    }
    // Pré-remplir le petit formulaire, laisser l'utilisateur valider avec le bouton Ajouter
    setTitle(t);
    setAuthor(a);
    setIsbn(i);
    setShowAddSuggestions(false);
    setAddQuery('');
  }

  async function lookupBookInfo() {
    setBookLookupError(null);
    setBookLookupLoading(true);
    try {
      const params = new URLSearchParams();
      const nIsbn = normalizeISBN(isbn);
      if (nIsbn) params.set('isbn', nIsbn);
      else if (barcode) params.set('barcode', barcode);
      else if (title || author) {
        // Pour les recherches par titre/auteur, proposer 5 résultats au choix
        const q = `${title || ''} ${author || ''}`.trim();
        if (q.length >= 3) {
          setAddQuery(q);
          setShowAddSuggestions(true);
          return; // ne pas choisir automatiquement un résultat
        }
      } else {
        throw new Error("Renseignez un ISBN, un code-barres ou un titre/auteur");
      }
      const res = await fetch(`/api/books/lookup?${params.toString()}`);
      if (!res.ok) throw new Error('Recherche impossible');
      const data = (await res.json()) as any;
      if (data.title) setTitle(data.title);
      if (Array.isArray(data.authors) && data.authors[0]) setAuthor(data.authors[0]);
      if (!isbn && data.isbn13) setIsbn(data.isbn13);
    } catch (e: any) {
      setBookLookupError(e?.message || 'Erreur de récupération');
    } finally {
      setBookLookupLoading(false);
    }
  }

  function addLoan() {
    if (!loanBookId || loanBorrower.trim() === '' || loanStartDate === '' || loanDueDate === '') return;
    setLoans((prev) => [
      {
        id: Date.now(),
        bookId: loanBookId as number,
        borrower: loanBorrower.trim(),
        startDate: loanStartDate,
        dueDate: loanDueDate,
      },
      ...prev,
    ]);
    setLoanBorrower('');
    setLoanBookId('');
  }

  function returnLoan(id: number) {
    const today = new Date().toISOString().slice(0, 10);
    setLoans((prev) => prev.map((l) => (l.id === id ? { ...l, returnedAt: today } : l)));
  }

  const loanUtils = {
    isReturned: (l: Loan) => !!l.returnedAt,
    isOverdue: (l: Loan) => !l.returnedAt && new Date(l.dueDate) < new Date(new Date().toDateString()),
    daysLeft: (l: Loan) => {
      const ms = new Date(l.dueDate).getTime() - new Date(new Date().toDateString()).getTime();
      return Math.ceil(ms / (1000 * 60 * 60 * 24));
    },
  };

  const visibleLoans = useMemo(() => {
    const q = loanListQuery.trim().toLowerCase();
    const qDigits = loanListQuery.replace(/[^0-9xX]/g, '').toLowerCase();
    return loans
      .filter((l) => {
        if (loanFilter === 'all') return true;
        if (loanFilter === 'returned') return loanUtils.isReturned(l);
        if (loanFilter === 'overdue') return loanUtils.isOverdue(l);
        return !loanUtils.isReturned(l);
      })
      .filter((l) => {
        if (!q) return true;
        const book = books.find((b) => b.id === l.bookId);
        const borrower = l.borrower.toLowerCase();
        const title = (book?.title || '').toLowerCase();
        const author = (book?.author || '').toLowerCase();
        const isbn = (book?.isbn || '').toLowerCase();
        const barcode = (book?.barcode || '').toLowerCase();
        return (
          borrower.includes(q) ||
          title.includes(q) ||
          author.includes(q) ||
          isbn.includes(qDigits) ||
          barcode.includes(q) ||
          barcode.includes(qDigits)
        );
      });
  }, [loans, loanFilter, books, loanListQuery]);

  const availableBooks = useMemo(() => {
    const activeIds = new Set(loans.filter((l) => !loanUtils.isReturned(l)).map((l) => l.bookId));
    const q = query.trim().toLowerCase();
    let list = books.filter((b) => !activeIds.has(b.id));
    if (q) {
      list = list.filter((b) =>
        b.title.toLowerCase().includes(q) ||
        b.author.toLowerCase().includes(q) ||
        (b.isbn || '').toLowerCase().includes(q) ||
        (b.barcode || '').toLowerCase().includes(q)
      );
    }
    list = list.sort((a, b) => {
      if (sortBy === 'recent') return b.createdAt - a.createdAt;
      if (sortBy === 'title') return a.title.localeCompare(b.title);
      return a.author.localeCompare(b.author);
    });
    return list;
  }, [books, loans, query, sortBy]);

  return (
    <main
      style={{
        fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
        padding: 24,
        display: 'grid',
        gap: 16,
        maxWidth: 960,
        margin: '0 auto',
      }}
    >
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h1 style={{ margin: 0 }}>Bibliomanager2</h1>
        <span
          aria-live="polite"
          title={status === 'loading' ? 'Vérification…' : status === 'ok' ? 'Serveur OK' : 'Serveur indisponible'}
          style={{
            padding: '4px 10px',
            borderRadius: 999,
            fontSize: 14,
            background:
              status === 'ok' ? '#E7F7EE' : status === 'error' ? '#FDECEA' : 'rgba(0,0,0,0.06)',
            color: status === 'ok' ? '#0E7A4D' : status === 'error' ? '#8A1F12' : '#333',
            border: '1px solid ' + (status === 'ok' ? '#BDEBD3' : status === 'error' ? '#F5C6C1' : '#ddd'),
          }}
        >
          Statut serveur: {status === 'loading' ? 'chargement…' : status}
        </span>
      </header>

      {route !== '/' && (
        <nav aria-label="Navigation principale" style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {[
            { to: '/livres/disponibles', label: 'Livres disponibles' },
            { to: '/livres/nouveau', label: 'Ajouter un livre' },
            { to: '/prets', label: 'Prêts' },
          ].map((item) => (
            <a
              key={item.to}
              href={item.to}
              onClick={(e) => { e.preventDefault(); navigate(item.to); }}
              style={{
                padding: '12px 16px',
                border: '2px solid ' + (route === item.to ? '#2563eb' : '#ddd'),
                background: route === item.to ? '#EFF6FF' : '#fff',
                color: '#111',
                borderRadius: 10,
                minWidth: 160,
                textAlign: 'center',
                fontSize: 16,
              }}
            >
              {item.label}
            </a>
          ))}
        </nav>
      )}

      {route === '/' && (
        <section style={{ padding: 8 }}>
          <div
            style={{
              display: 'grid',
              gap: 16,
              gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
            }}
          >
            <button
              onClick={() => navigate('/livres/disponibles')}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'flex-start',
                justifyContent: 'space-between',
                padding: 20,
                borderRadius: 16,
                border: '2px solid #e5e7eb',
                background: '#ffffff',
                minHeight: 140,
                textAlign: 'left',
                fontSize: 18,
                cursor: 'pointer',
              }}
            >
              <div style={{ fontSize: 28 }}>📚</div>
              <div>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>Livres disponibles</div>
                <div style={{ color: '#555', fontSize: 14 }}>Consulter et prêter rapidement</div>
              </div>
            </button>

            <button
              onClick={() => navigate('/livres/nouveau')}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'flex-start',
                justifyContent: 'space-between',
                padding: 20,
                borderRadius: 16,
                border: '2px solid #e5e7eb',
                background: '#ffffff',
                minHeight: 140,
                textAlign: 'left',
                fontSize: 18,
                cursor: 'pointer',
              }}
            >
              <div style={{ fontSize: 28 }}>➕</div>
              <div>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>Ajouter un livre</div>
                <div style={{ color: '#555', fontSize: 14 }}>Saisie rapide avec ISBN/CB</div>
              </div>
            </button>

            <button
              onClick={() => navigate('/prets')}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'flex-start',
                justifyContent: 'space-between',
                padding: 20,
                borderRadius: 16,
                border: '2px solid #e5e7eb',
                background: '#ffffff',
                minHeight: 140,
                textAlign: 'left',
                fontSize: 18,
                cursor: 'pointer',
              }}
            >
              <div style={{ fontSize: 28 }}>📄</div>
              <div>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>Prêts</div>
                <div style={{ color: '#555', fontSize: 14 }}>Créer et suivre les prêts</div>
              </div>
            </button>
          </div>
        </section>
      )}

      {route === '/livres/nouveau' && (
      <section style={{ padding: 16, border: '1px solid #eee', borderRadius: 8 }}>
        <h2 style={{ marginTop: 0 }}>Ajouter un livre</h2>
        <div style={{ marginBottom: 12, position: 'relative' }}>
          <input
            aria-label="Rechercher un livre (ISBN, code-barres, titre, auteur)"
            placeholder="Rechercher un livre dans la base ouverte…"
            value={addQuery}
            onFocus={() => setShowAddSuggestions(true)}
            onBlur={() => setTimeout(() => setShowAddSuggestions(false), 100)}
            onChange={(e) => { setAddQuery(e.target.value); setShowAddSuggestions(true); }}
            onKeyDown={(e) => {
              if (!showAddSuggestions && addSuggestions.length > 0) setShowAddSuggestions(true);
              if (addSuggestions.length === 0) return;
              if (e.key === 'ArrowDown') { e.preventDefault(); setAddHighlightIndex((i) => (i + 1) % addSuggestions.length); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setAddHighlightIndex((i) => (i - 1 + addSuggestions.length) % addSuggestions.length); }
              else if (e.key === 'Enter') { if (addHighlightIndex >= 0) { e.preventDefault(); addFromSuggestion(addSuggestions[addHighlightIndex]); } }
              else if (e.key === 'Escape') { setShowAddSuggestions(false); }
            }}
            style={{ width: '100%', padding: '12px 14px', borderRadius: 10, border: '1px solid #ddd', fontSize: 16 }}
          />
          {showAddSuggestions && addQuery.trim() !== '' && (
            <ul role="listbox" style={{ position: 'absolute', zIndex: 10, top: '100%', left: 0, right: 0, background: 'white', border: '1px solid #eee', borderRadius: 10, marginTop: 4, listStyle: 'none', padding: 6, maxHeight: 260, overflowY: 'auto', boxShadow: '0 8px 24px rgba(0,0,0,0.08)' }}>
              {addLoading && <li style={{ padding: '8px 10px', color: '#555' }}>Recherche…</li>}
              {!addLoading && addSuggestions.length === 0 && <li style={{ padding: '8px 10px', color: '#555' }}>Aucun résultat</li>}
              {addSuggestions.map((s, idx) => (
                <li key={s.title + (s.isbn13 || s.isbn10 || idx)}>
                  <div role="option" aria-selected={idx === addHighlightIndex} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '8px 10px', borderRadius: 8, background: idx === addHighlightIndex ? '#EFF6FF' : 'transparent' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                      {s.coverUrl ? <img src={s.coverUrl} alt="" width={36} height={54} style={{ objectFit: 'cover', borderRadius: 4 }} /> : <div style={{ width: 36, height: 54, background: '#f3f4f6', borderRadius: 4 }} />}
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{highlight(s.title, addQuery)}</div>
                        <div style={{ color: '#666', fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{(s.authors && s.authors[0]) || ''}</div>
                        <div style={{ color: '#666', fontSize: 12 }}>{s.isbn13 || s.isbn10 || ''}</div>
                      </div>
                    </div>
                    <button type="button" onMouseDown={(e) => { e.preventDefault(); addFromSuggestion(s); }} style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid #10b981', background: '#10b981', color: 'white' }}>Ajouter</button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            addBook();
          }}
          style={{ display: 'grid', gap: 12, gridTemplateColumns: '1fr 1fr 1fr 1fr auto auto' }}
        >
          <input
            aria-label="Titre"
            placeholder="Titre"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            style={{ padding: '10px 12px', borderRadius: 6, border: '1px solid #ddd' }}
          />
          <input
            aria-label="Auteur"
            placeholder="Auteur"
            value={author}
            onChange={(e) => setAuthor(e.target.value)}
            style={{ padding: '10px 12px', borderRadius: 6, border: '1px solid #ddd' }}
          />
          <input
            aria-label="ISBN"
            placeholder="ISBN (10 ou 13)"
            value={isbn}
            onChange={(e) => setIsbn(e.target.value)}
            style={{ padding: '10px 12px', borderRadius: 6, border: '1px solid #ddd' }}
          />
          <input
            aria-label="Code-barres"
            placeholder="Code-barres"
            value={barcode}
            onChange={(e) => setBarcode(e.target.value)}
            style={{ padding: '10px 12px', borderRadius: 6, border: '1px solid #ddd' }}
          />
          <button
            type="button"
            onClick={lookupBookInfo}
            style={{
              padding: '10px 14px',
              borderRadius: 6,
              border: '1px solid #0ea5e9',
              background: '#0ea5e9',
              color: 'white',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            {bookLookupLoading ? 'Recherche…' : 'Rechercher infos'}
          </button>
          <button
            type="submit"
            disabled={isAddDisabled}
            style={{
              padding: '10px 14px',
              borderRadius: 6,
              border: '1px solid #2563eb',
              background: isAddDisabled ? '#93c5fd' : '#3b82f6',
              color: 'white',
              cursor: isAddDisabled ? 'not-allowed' : 'pointer',
            }}
          >
            Ajouter
          </button>
        </form>
        {(isbnValidityHint || bookLookupError) && (
          <p style={{ color: '#8A1F12', fontSize: 13, marginTop: 8 }}>
            {isbnValidityHint || bookLookupError}
          </p>
        )}
      </section>
      )}

      {route === '/livres/nouveau' && (
      <section style={{ padding: 16, border: '1px solid #eee', borderRadius: 8 }}>
        <h2 style={{ marginTop: 0 }}>Tous les livres ({visibleBooks.length})</h2>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
          <input
            aria-label="Rechercher"
            placeholder="Rechercher par titre ou auteur"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ padding: '8px 10px', borderRadius: 6, border: '1px solid #ddd', minWidth: 240 }}
          />
          <select
            aria-label="Filtrer par statut"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
            style={{ padding: '8px 10px', borderRadius: 6, border: '1px solid #ddd' }}
          >
            <option value="all">Tous</option>
            <option value="read">Lus</option>
            <option value="unread">À lire</option>
          </select>
          <select
            aria-label="Trier par"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
            style={{ padding: '8px 10px', borderRadius: 6, border: '1px solid #ddd' }}
          >
            <option value="recent">Plus récent</option>
            <option value="title">Titre (A→Z)</option>
            <option value="author">Auteur (A→Z)</option>
          </select>
        </div>
        {visibleBooks.length === 0 ? (
          <p>Aucun livre correspondant. Ajoutez-en un ci-dessus ou modifiez le filtre.</p>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}>
            {visibleBooks.map((b) => (
              <li
                key={b.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '10px 12px',
                  border: '1px solid #eee',
                  borderRadius: 8,
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <input
                      type="checkbox"
                      checked={b.read}
                      onChange={() => toggleRead(b.id)}
                      aria-label={b.read ? 'Marquer comme à lire' : 'Marquer comme lu'}
                    />
                    {editingBookId === b.id ? (
                      <input
                        value={b.title}
                        onChange={(e) => saveBookEdit(b.id, { title: e.target.value })}
                        style={{ padding: '6px 8px', borderRadius: 6, border: '1px solid #ddd', flex: 1, minWidth: 180 }}
                      />
                    ) : (
                      <span style={{ textDecoration: b.read ? 'line-through' : 'none' }}>{b.title}</span>
                    )}
                  </div>
                  <div style={{ color: '#555', fontSize: 14 }}>
                    {editingBookId === b.id ? (
                      <input
                        value={b.author}
                        onChange={(e) => saveBookEdit(b.id, { author: e.target.value })}
                        style={{ padding: '6px 8px', borderRadius: 6, border: '1px solid #ddd', marginTop: 6, minWidth: 180 }}
                      />)
                    : (
                      <>par {b.author}</>
                    )}
                  </div>
                  {(editingBookId === b.id || b.isbn || b.barcode) && (
                    <div style={{ color: '#666', fontSize: 12, marginTop: 4 }}>
                      {editingBookId === b.id ? (
                        <>
                          <input
                            placeholder="ISBN"
                            value={b.isbn || ''}
                            onChange={(e) => saveBookEdit(b.id, { isbn: (e.target.value || '').replace(/[^0-9Xx]/g, '').toUpperCase() })}
                            style={{ padding: '6px 8px', borderRadius: 6, border: '1px solid #ddd', marginRight: 6 }}
                          />
                          <input
                            placeholder="Code-barres"
                            value={b.barcode || ''}
                            onChange={(e) => saveBookEdit(b.id, { barcode: e.target.value })}
                            style={{ padding: '6px 8px', borderRadius: 6, border: '1px solid #ddd' }}
                          />
                        </>
                      ) : (
                        <>
                          {b.isbn && <span>ISBN: {b.isbn}</span>}
                          {b.isbn && b.barcode && <span> · </span>}
                          {b.barcode && <span>Code-barres: {b.barcode}</span>}
                        </>
                      )}
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 8, marginLeft: 12 }}>
                  {editingBookId === b.id ? (
                    <button
                      onClick={() => setEditingBookId(null)}
                      style={{ padding: '8px 10px', borderRadius: 6, border: '1px solid #6b7280', background: '#6b7280', color: 'white' }}
                    >
                      Terminer
                    </button>
                  ) : (
                    <button
                      onClick={() => setEditingBookId(b.id)}
                      style={{ padding: '8px 10px', borderRadius: 6, border: '1px solid #10b981', background: '#10b981', color: 'white' }}
                    >
                      Éditer
                    </button>
                  )}
                  <button
                    onClick={() => removeBook(b.id)}
                    aria-label={`Supprimer ${b.title}`}
                    style={{
                      padding: '8px 10px',
                      borderRadius: 6,
                      border: '1px solid #ef4444',
                      background: '#ef4444',
                      color: 'white',
                      cursor: 'pointer',
                    }}
                  >
                    Supprimer
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
      )}

      {route === '/livres/disponibles' && (
      <section style={{ padding: 16, border: '1px solid #eee', borderRadius: 8 }}>
        <h2 style={{ marginTop: 0 }}>Livres disponibles ({availableBooks.length})</h2>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
          <input
            aria-label="Rechercher"
            placeholder="Titre, auteur, ISBN, code-barres"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ padding: '8px 10px', borderRadius: 6, border: '1px solid #ddd', minWidth: 240 }}
          />
          <select
            aria-label="Trier par"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
            style={{ padding: '8px 10px', borderRadius: 6, border: '1px solid #ddd' }}
          >
            <option value="recent">Plus récent</option>
            <option value="title">Titre (A→Z)</option>
            <option value="author">Auteur (A→Z)</option>
          </select>
        </div>
        {availableBooks.length === 0 ? (
          <p>Aucun livre disponible pour le moment.</p>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}>
            {availableBooks.map((b) => (
              <li
                key={b.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '10px 12px',
                  border: '1px solid #eee',
                  borderRadius: 8,
                }}
              >
                <div>
                  <div style={{ fontWeight: 600 }}>{b.title}</div>
                  <div style={{ color: '#555', fontSize: 14 }}>par {b.author}</div>
                  {(b.isbn || b.barcode) && (
                    <div style={{ color: '#666', fontSize: 12, marginTop: 4 }}>
                      {b.isbn && <span>ISBN: {b.isbn}</span>}
                      {b.isbn && b.barcode && <span> · </span>}
                      {b.barcode && <span>Code-barres: {b.barcode}</span>}
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 8, marginLeft: 12 }}>
                  <a href="/prets" onClick={(e) => { e.preventDefault(); navigate('/prets'); }} style={{ padding: '8px 10px', borderRadius: 6, border: '1px solid #2563eb', background: '#3b82f6', color: 'white' }}>
                    Prêter
                  </a>
                  <button onClick={() => setEditingBookId(b.id)} style={{ padding: '8px 10px', borderRadius: 6, border: '1px solid #10b981', background: '#10b981', color: 'white' }}>
                    Éditer
                  </button>
                  <button onClick={() => removeBook(b.id)} aria-label={`Supprimer ${b.title}`} style={{ padding: '8px 10px', borderRadius: 6, border: '1px solid #ef4444', background: '#ef4444', color: 'white', cursor: 'pointer' }}>
                    Supprimer
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
      )}

      {route === '/prets' && (
      <section style={{ padding: 16, border: '1px solid #eee', borderRadius: 8 }}>
        <h2 style={{ marginTop: 0 }}>Prêts</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            addLoan();
          }}
          style={{ display: 'grid', gap: 12, gridTemplateColumns: '2fr 2fr 1fr 1fr auto' }}
        >
          <div style={{ position: 'relative' }}>
            <input
              aria-label="Livre (ISBN / code-barres / titre / auteur)"
              placeholder="Rechercher un livre…"
              value={loanBookQuery}
              onChange={(e) => {
                setLoanBookQuery(e.target.value);
                setLoanBookId('');
                setShowBookSuggestions(true);
              }}
              onFocus={() => setShowBookSuggestions(true)}
              onBlur={() => setTimeout(() => setShowBookSuggestions(false), 100)}
              onKeyDown={(e) => {
                if (!showBookSuggestions && bookSuggestions.length > 0) setShowBookSuggestions(true);
                if (bookSuggestions.length === 0) return;
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setHighlightIndex((i) => (i + 1) % bookSuggestions.length);
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setHighlightIndex((i) => (i - 1 + bookSuggestions.length) % bookSuggestions.length);
                } else if (e.key === 'Enter') {
                  if (highlightIndex >= 0 && highlightIndex < bookSuggestions.length) {
                    e.preventDefault();
                    selectLoanBook(bookSuggestions[highlightIndex]);
                  }
                } else if (e.key === 'Escape') {
                  setShowBookSuggestions(false);
                }
              }}
              style={{ width: '100%', padding: '10px 12px', borderRadius: 6, border: '1px solid #ddd' }}
            />
            {showBookSuggestions && loanBookQuery.trim() !== '' && bookSuggestions.length > 0 && (
              <ul
                role="listbox"
                style={{
                  position: 'absolute',
                  zIndex: 10,
                  top: '100%',
                  left: 0,
                  right: 0,
                  background: 'white',
                  border: '1px solid #eee',
                  borderRadius: 8,
                  marginTop: 4,
                  listStyle: 'none',
                  padding: 4,
                  maxHeight: 240,
                  overflowY: 'auto',
                  boxShadow: '0 8px 24px rgba(0,0,0,0.08)',
                }}
              >
                {bookSuggestions.map((b, idx) => (
                  <li key={b.id}>
                    <button
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        selectLoanBook(b);
                      }}
                      role="option"
                      aria-selected={idx === highlightIndex}
                      style={{
                        display: 'block',
                        width: '100%',
                        textAlign: 'left',
                        padding: '8px 10px',
                        borderRadius: 6,
                        border: 'none',
                        background: idx === highlightIndex ? '#EFF6FF' : 'transparent',
                        cursor: 'pointer',
                      }}
                    >
                      <div style={{ fontWeight: 600 }}>{highlight(b.title, loanBookQuery.trim())}</div>
                      <div style={{ color: '#666', fontSize: 12 }}>
                        {highlight(b.author, loanBookQuery.trim())}
                        {(b.isbn || b.barcode) && (
                          <>
                            {' '}· {b.isbn ? <>ISBN {highlight(String(b.isbn), loanBookQuery.replace(/[^0-9xX]/g, ''))}</> : ''}
                            {b.isbn && b.barcode ? ' · ' : ''}
                            {b.barcode ? <>CB {highlight(String(b.barcode), loanBookQuery.replace(/[^0-9xX]/g, ''))}</> : ''}
                          </>
                        )}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <input
            aria-label="Emprunteur"
            placeholder="Nom de l'emprunteur"
            value={loanBorrower}
            onChange={(e) => setLoanBorrower(e.target.value)}
            style={{ padding: '10px 12px', borderRadius: 6, border: '1px solid #ddd' }}
          />
          <input
            type="date"
            aria-label="Date de début"
            value={loanStartDate}
            onChange={(e) => setLoanStartDate(e.target.value)}
            style={{ padding: '10px 12px', borderRadius: 6, border: '1px solid #ddd' }}
          />
          <input
            type="date"
            aria-label="Date d'échéance"
            value={loanDueDate}
            onChange={(e) => setLoanDueDate(e.target.value)}
            style={{ padding: '10px 12px', borderRadius: 6, border: '1px solid #ddd' }}
          />
          <button
            type="submit"
            disabled={!loanBookId || loanBorrower.trim() === ''}
            style={{
              padding: '10px 14px',
              borderRadius: 6,
              border: '1px solid #2563eb',
              background: !loanBookId || loanBorrower.trim() === '' ? '#93c5fd' : '#3b82f6',
              color: 'white',
              cursor: !loanBookId || loanBorrower.trim() === '' ? 'not-allowed' : 'pointer',
            }}
          >
            Enregistrer le prêt
          </button>
        </form>
        {books.length === 0 && (
          <p style={{ color: '#8A1F12', fontSize: 13, marginTop: 8 }}>
            Ajoutez d'abord un livre pour pouvoir créer un prêt.
          </p>
        )}

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 12, flexWrap: 'wrap' }}>
          <input
            aria-label="Rechercher un prêt (nom, livre, ISBN, code-barres)"
            placeholder="Filtrer les prêts…"
            value={loanListQuery}
            onChange={(e) => setLoanListQuery(e.target.value)}
            style={{ padding: '8px 10px', borderRadius: 6, border: '1px solid #ddd', minWidth: 260 }}
          />
          <select
            aria-label="Filtrer les prêts"
            value={loanFilter}
            onChange={(e) => setLoanFilter(e.target.value as typeof loanFilter)}
            style={{ padding: '8px 10px', borderRadius: 6, border: '1px solid #ddd' }}
          >
            <option value="active">En cours</option>
            <option value="overdue">En retard</option>
            <option value="returned">Rendus</option>
            <option value="all">Tous</option>
          </select>
          <span style={{ color: '#555' }}>
            {loans.filter((l) => !loanUtils.isReturned(l)).length} en cours ·{' '}
            {loans.filter((l) => loanUtils.isOverdue(l)).length} en retard
          </span>
        </div>

        {visibleLoans.length === 0 ? (
          <p style={{ marginTop: 12 }}>Aucun prêt à afficher.</p>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, marginTop: 12, display: 'grid', gap: 8 }}>
            {visibleLoans.map((l) => {
              const book = books.find((b) => b.id === l.bookId);
              const overdue = loanUtils.isOverdue(l);
              const returned = loanUtils.isReturned(l);
              const days = loanUtils.daysLeft(l);
              return (
                <li
                  key={l.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '10px 12px',
                    border: '1px solid #eee',
                    borderRadius: 8,
                    background: returned ? '#f5f5f5' : overdue ? '#FDECEA' : 'white',
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 600 }}>
                      {book ? book.title : 'Livre supprimé'}
                      {book && ' — '}
                      <span style={{ color: '#555', fontWeight: 400 }}>{book?.author}</span>
                    </div>
                    <div style={{ color: '#555', fontSize: 14 }}>
                      Emprunteur: <strong>{l.borrower}</strong>
                      {' · '}Du {l.startDate} au {l.dueDate}
                      {returned && l.returnedAt ? ` · Rendu le ${l.returnedAt}` : ''}
                    </div>
                    {!returned && (
                      <div style={{ fontSize: 12, marginTop: 4, color: overdue ? '#8A1F12' : '#0E7A4D' }}>
                        {overdue ? `En retard de ${Math.abs(days)} jour(s)` : `Il reste ${days} jour(s)`}
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {!returned && (
                      <button
                        onClick={() => returnLoan(l.id)}
                        style={{
                          padding: '8px 10px',
                          borderRadius: 6,
                          border: '1px solid #10b981',
                          background: '#10b981',
                          color: 'white',
                          cursor: 'pointer',
                        }}
                      >
                        Marquer comme rendu
                      </button>
                    )}
                    <button
                      onClick={() => setLoans((prev) => prev.filter((x) => x.id !== l.id))}
                      style={{
                        padding: '8px 10px',
                        borderRadius: 6,
                        border: '1px solid #ef4444',
                        background: '#ef4444',
                        color: 'white',
                        cursor: 'pointer',
                      }}
                    >
                      Supprimer
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
      )}
    </main>
  );
}
