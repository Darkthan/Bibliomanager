import React, { useEffect, useMemo, useState } from 'react';
import './responsive.css';

type Book = {
  id: number;
  epc: string; // EPC 96 bits hex (24 chars)
  title: string;
  author: string;
  read: boolean;
  createdAt: number;
  isbn?: string;
  barcode?: string;
  coverUrl?: string;
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
  // Auth (roles cumulables)
  type Me = { username: string | null; roles: string[] };
  const [me, setMe] = useState<Me>({ username: null, roles: ['guest'] });
  function hasRole(role: 'admin' | 'import' | 'loans') {
    return me.roles.includes('admin') || me.roles.includes(role);
  }
  const canImport = hasRole('import');
  const canLoans = hasRole('loans');
  const isAdmin = me.roles.includes('admin');
  const [books, setBooks] = useState<Book[]>([]);
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [isbn, setIsbn] = useState('');
  const [barcode, setBarcode] = useState('');
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'read' | 'unread'>('all');
  const [sortBy, setSortBy] = useState<'recent' | 'title' | 'author' | 'addedAsc' | 'addedDesc'>('recent');
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
  // Thème (clair/sombre)
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    try {
      const saved = localStorage.getItem('bm2/theme');
      if (saved === 'light' || saved === 'dark') return saved;
      const prefersDark = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
      return prefersDark ? 'dark' : 'light';
    } catch { return 'light'; }
  });
  useEffect(() => {
    try { localStorage.setItem('bm2/theme', theme); } catch {}
    try { document.documentElement.classList.toggle('theme-dark', theme === 'dark'); } catch {}
  }, [theme]);
  // Menu responsive (hamburger)
  const [navOpen, setNavOpen] = useState(false);
  // Scan (prêts): recherche livre par QR (EPC) / code-barres (ISBN)
  const [loanScanOpen, setLoanScanOpen] = useState(false);
  const [loanScanError, setLoanScanError] = useState<string | null>(null);
  const [loanIsScanning, setLoanIsScanning] = useState(false);
  const loanVideoRef = React.useRef<HTMLVideoElement | null>(null);
  const loanStreamRef = React.useRef<MediaStream | null>(null);
  const loanDetectorRef = React.useRef<any | null>(null);
  const loanLoopRef = React.useRef<number | null>(null);
  const loanZxingReaderRef = React.useRef<any | null>(null);
  const loanZxingControlsRef = React.useRef<any | null>(null);
  // Sélection pour impression en masse (sur "Tous les livres")
  const [selectedForPrint, setSelectedForPrint] = useState<Set<number>>(new Set());
  // IDs des derniers livres importés (pour proposer une impression en masse)
  const [lastImportedIds, setLastImportedIds] = useState<number[]>([]);
  // Suggestions pour l'ajout (base ouverte)
  const [addQuery, setAddQuery] = useState('');
  const [showAddSuggestions, setShowAddSuggestions] = useState(false);
  const [addSuggestions, setAddSuggestions] = useState<Array<{ title: string; authors?: string[]; isbn13?: string; isbn10?: string; coverUrl?: string; workKey?: string }>>([]);
  const [addHighlightIndex, setAddHighlightIndex] = useState(-1);
  const [addLoading, setAddLoading] = useState(false);
  const [showEditionPicker, setShowEditionPicker] = useState(false);
  const [editionOptions, setEditionOptions] = useState<Array<{ editionKey?: string; title?: string; publishers?: string[]; publishDate?: string; pages?: number; isbn13?: string[]; isbn10?: string[]; coverUrl?: string }>>([]);
  const [editionLoading, setEditionLoading] = useState(false);
  const [editionError, setEditionError] = useState<string | null>(null);
  // Détails visuels pour la page "Livres disponibles"
  const [selectedAvailableBook, setSelectedAvailableBook] = useState<Book | null>(null);
  // Carte QR imprimable (page Ajouter un livre)
  const [showCardFor, setShowCardFor] = useState<number | null>(null);
  // Import en masse (codes-barres)
  type ImportItem = { barcode: string; status: 'pending' | 'ok' | 'not_found' | 'error'; title?: string; author?: string; isbn?: string; coverUrl?: string; error?: string };
  const [importMode, setImportMode] = useState<'camera' | 'lecteur' | 'csv'>('lecteur');
  const [importItems, setImportItems] = useState<ImportItem[]>([]);
  const [importInput, setImportInput] = useState('');
  const [isScanning, setIsScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const streamRef = React.useRef<MediaStream | null>(null);
  const detectorRef = React.useRef<any | null>(null);
  const loopRef = React.useRef<number | null>(null);
  const zxingReaderRef = React.useRef<any | null>(null);
  const zxingControlsRef = React.useRef<any | null>(null);
  const recentBarcodesRef = React.useRef<Map<string, number>>(new Map());
  const [cameraDevices, setCameraDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedCameraId, setSelectedCameraId] = useState('');
  const [loadingDevices, setLoadingDevices] = useState(false);
  // Local agent detection (HTTP on 9110)
  const [agentAvailable, setAgentAvailable] = useState(false);
  const [agentPrinters, setAgentPrinters] = useState<Array<{ name: string; driver?: string; default?: boolean }>>([]);
  const [agentPrinterName, setAgentPrinterName] = useState<string>('');
  // API Keys (admin)
  type ApiKey = { id: string; label?: string; createdAt: number };
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [apiKeyLabel, setApiKeyLabel] = useState('');
  const [newApiKeyToken, setNewApiKeyToken] = useState<string | null>(null);
  async function probeAgent() {
    try {
      const c = await Promise.race([
        fetch('http://localhost:9110/health', { cache: 'no-store' }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 800)),
      ]);
      setAgentAvailable(!!(c as any)?.ok);
    } catch { setAgentAvailable(false); }
  }
  useEffect(() => { probeAgent(); }, []);
  useEffect(() => { try { const v = localStorage.getItem('bm2/agentPrinter'); if (v) setAgentPrinterName(v); } catch {} }, []);
  useEffect(() => { try { localStorage.setItem('bm2/agentPrinter', agentPrinterName); } catch {} }, [agentPrinterName]);
  // Load API keys for admin
  useEffect(() => {
    (async () => {
      if (!isAdmin) return;
      try {
        const r = await fetch('/api/apikeys', { cache: 'no-store' });
        if (r.ok) {
          const d = await r.json();
          if (Array.isArray(d.keys)) setApiKeys(d.keys);
        }
      } catch {}
    })();
  }, [isAdmin]);
  // Récupère la session
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/auth/me', { cache: 'no-store' });
        const d = await r.json();
        if (d && Array.isArray(d.roles)) setMe({ username: d?.user?.username || null, roles: d.roles });
      } catch {}
    })();
  }, []);
  useEffect(() => {
    (async () => {
      if (!agentAvailable) return;
      async function fetchList(url: string) {
        try { const r = await fetch(url, { cache: 'no-store', mode: 'cors' as const }); if (!r.ok) throw new Error(''); return await r.json(); } catch { return null; }
      }
      const data = (await fetchList('http://localhost:9110/printers')) || (await fetchList('http://127.0.0.1:9110/printers'));
      if (data && Array.isArray(data.printers)) {
        setAgentPrinters(data.printers);
        if (!agentPrinterName && typeof data.default === 'string') setAgentPrinterName(data.default);
      }
    })();
  }, [agentAvailable]);
  // ZPL printer settings
  const [printerHost, setPrinterHost] = useState<string>('');
  const [printerPort, setPrinterPort] = useState<number>(9100);
  const [printerDpi, setPrinterDpi] = useState<number>(203);
  useEffect(() => {
    try {
      const raw = localStorage.getItem('bm2/printer');
      if (raw) {
        const p = JSON.parse(raw);
        if (p && typeof p.host === 'string') setPrinterHost(p.host);
        if (p && typeof p.port === 'number') setPrinterPort(p.port);
        if (p && typeof p.dpi === 'number') setPrinterDpi(p.dpi);
      }
    } catch {}
  }, []);
  useEffect(() => {
    try { localStorage.setItem('bm2/printer', JSON.stringify({ host: printerHost, port: printerPort, dpi: printerDpi })); } catch {}
  }, [printerHost, printerPort, printerDpi]);

  function escZpl(text: string) { return (text || '').replace(/[\^~]/g, ' '); }
  function shortIdFromEpc(epc: string) {
    try {
      let h = 5381 >>> 0;
      for (let i = 0; i < epc.length; i++) {
        h = (((h << 5) + h) ^ epc.charCodeAt(i)) >>> 0; // djb2 xor
      }
      let v = h & 0x3fffffff; // 30 bits -> 6 chars base32
      const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
      let out = '';
      for (let i = 0; i < 6; i++) { out = alphabet[v & 31] + out; v >>>= 5; }
      return out;
    } catch { return '000000'; }
  }
  function buildZplLabel(b: Book, dpi: number) {
    const dpmm = dpi / 25.4;
    const w = Math.round(44 * dpmm);
    const h = Math.round(19 * dpmm);
    const margin = Math.round(1.5 * dpmm);
    // QR un peu plus grand (~17mm), carré et centré
    const qrSideMm = 17.0;
    const approxQrDots = Math.round(qrSideMm * dpmm);
    const mag = dpi >= 600 ? 3 : dpi >= 300 ? 4 : 5;
    const title = escZpl(b.title);
    const author = escZpl(b.author);
    const xQr = margin;
    const yQr = Math.max(0, Math.round((h - approxQrDots) / 2));
    const xText = xQr + approxQrDots + Math.round(1.8 * dpmm);
    const yTitle = margin;
    // Tailles de police plus petites et multi-lignes possibles pour le titre
    const titleDot = Math.max(9, Math.round(2.6 * dpmm)); // ≈2.6mm
    const authorDot = Math.max(8, Math.round(2.2 * dpmm)); // ≈2.2mm
    const idDot = Math.max(7, Math.round(1.9 * dpmm));     // petite ligne
    const lineGap = Math.max(1, Math.round(0.4 * dpmm));
    const titleLinesMax = 2;
    const textWidth = Math.max(20, w - xText - margin);
    // Calcul d'un y pour l'auteur qui laisse la place à 2 lignes de titre
    const yAuthor = yTitle + (titleDot * titleLinesMax) + (lineGap * (titleLinesMax - 1)) + Math.round(0.6 * dpmm);
    const yShort = yAuthor + authorDot + Math.round(0.4 * dpmm);
    const sid = shortIdFromEpc(b.epc);
    const barH = Math.max(10, Math.round(5.2 * dpmm));
    const yBar = Math.min(h - barH - Math.round(0.6 * dpmm), yShort + idDot + Math.round(0.4 * dpmm));
    return `^XA\n^CI28\n^PW${w}\n^LL${h}\n^LH0,0\n`
      + `^RFW,H,2,6^FD${b.epc}^FS\n`
      + `^FO${xQr},${yQr}\n^BQN,2,${mag}\n^FDLA,${b.epc}^FS\n`
      + `^FO${xText},${yTitle}\n^A0N,${titleDot},${titleDot}^FB${textWidth},${titleLinesMax},${lineGap},L,0^FD${title}^FS\n`
      + `^FO${xText},${yAuthor}\n^A0N,${authorDot},${authorDot}^FB${textWidth},1,0,L,0^FD${author}^FS\n`
      // ID en "gras" (double impression légère) + Code128 compact
      + `^FO${xText},${yShort}\n^A0N,${idDot},${idDot}^FB${textWidth},1,0,L,0^FDID: ${sid}^FS\n`
      + `^FO${xText + 1},${yShort}\n^A0N,${idDot},${idDot}^FB${textWidth},1,0,L,0^FDID: ${sid}^FS\n`
      + `^FO${xText},${yBar}\n^BY1,2,${barH}\n^BCN,,N,N,N\n^FD${sid}^FS\n`
      + `^XZ`;
  }

  async function printZpl(b: Book) {
    if (!printerHost) { alert('Configurer l\'adresse IP de l\'imprimante Zebra.'); return; }
    const zpl = buildZplLabel(b, printerDpi);
    try {
      const r = await fetch('/api/print/zpl', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ host: printerHost, port: printerPort, zpl }) });
      if (!r.ok) throw new Error('Envoi ZPL échoué');
      alert('Étiquette envoyée à l\'imprimante.');
    } catch (e: any) {
      alert('Erreur impression ZPL: ' + (e?.message || 'inconnue'));
    }
  }

  async function printViaLocalAgent(b: Book) {
    const zpl = buildZplLabel(b, printerDpi);
    const payload = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ zpl, printer: agentPrinterName || undefined }), mode: 'cors' as const };
    try {
      let r = await fetch('http://localhost:9110/print', payload);
      if (!r.ok) { r = await fetch('http://127.0.0.1:9110/print', payload); }
      if (!r.ok) throw new Error('Agent répond en erreur');
      alert("Étiquette envoyée à l'agent local.");
    } catch (e: any) {
      alert('Erreur agent local: ' + (e?.message || 'inconnue'));
    }
  }

  // Impression en masse via agent local Zebra (un seul job ZPL)
  async function printBatchViaLocalAgent(ids: number[]) {
    const items = books.filter((b) => ids.includes(b.id));
    if (items.length === 0) { alert('Sélectionnez au moins un livre.'); return; }
    const zpl = items.map((b) => buildZplLabel(b, printerDpi)).join('');
    const payload = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ zpl, printer: agentPrinterName || undefined }), mode: 'cors' as const };
    try {
      let r = await fetch('http://localhost:9110/print', payload);
      if (!r.ok) { r = await fetch('http://127.0.0.1:9110/print', payload); }
      if (!r.ok) throw new Error('Agent répond en erreur');
      alert(items.length + (items.length > 1 ? ' étiquettes envoyées à l\'agent local.' : ' étiquette envoyée à l\'agent local.'));
    } catch (e: any) {
      alert('Erreur agent local: ' + (e?.message || 'inconnue'));
    }
  }
  // Impression locale via Zebra Browser Print (imprimante USB locale)
  async function ensureBrowserPrint(): Promise<any | null> {
    if ((window as any).BrowserPrint) return (window as any).BrowserPrint;
    const hosts = ['127.0.0.1', 'localhost'];
    const protos: Array<'http' | 'https'> = (location.protocol === 'https:' ? ['https', 'http'] : ['http', 'https']);
    const files = [
      'BrowserPrint-3.0.216.min.js', 'BrowserPrint-3.0.216.js',
      'BrowserPrint-3.0.0.min.js', 'BrowserPrint-3.0.0.js',
      'BrowserPrint-2.0.1.min.js', 'BrowserPrint-2.0.1.js',
    ];
    async function tryLoad(url: string) {
      await new Promise<void>((resolve, reject) => {
        const s = document.createElement('script');
        s.src = url;
        s.async = true;
        s.onload = () => resolve();
        s.onerror = () => reject(new Error('load_failed'));
        document.head.appendChild(s);
      });
      return (window as any).BrowserPrint || null;
    }
    for (const proto of protos) {
      for (const host of hosts) {
        for (const f of files) {
          const url = `${proto}://${host}:9101/${f}`;
          try {
            const bp = await tryLoad(url);
            if (bp) return bp;
          } catch {
            // try next
          }
        }
      }
    }
    return null;
  }

  async function printZebraLocal(b: Book) {
    const BP = await ensureBrowserPrint();
    if (!BP) { alert("Service Zebra Browser Print non détecté. Installez-le puis réessayez (http://localhost:9101)."); return; }
    const zpl = buildZplLabel(b, printerDpi);
    await new Promise<void>((resolve) => setTimeout(resolve, 50)); // petite latence pour init
    BP.getDefaultDevice('printer', function (device: any) {
      if (!device) {
        BP.getLocalDevices(function (devices: any[]) {
          const printers = (devices || []).filter((d: any) => d && d.deviceType === 'printer');
          if (printers.length === 0) { alert('Aucune imprimante Zebra locale trouvée.'); return; }
          const dev = printers[0];
          dev.send(zpl, () => alert('Étiquette envoyée (local).'), (e: any) => alert('Erreur impression (local): ' + e));
        }, function () { alert('Impossible d\'énumérer les imprimantes locales.'); }, 'printer');
        return;
      }
      device.send(zpl, () => alert('Étiquette envoyée (local).'), (e: any) => alert('Erreur impression (local): ' + e));
    }, function () { alert('Impossible de récupérer l\'imprimante par défaut.'); });
  }
  // Import CSV (sauvegarde/restauration)
  type CsvItem = { title: string; author: string; isbn?: string; epc?: string; status: 'ok' | 'error'; error?: string };
  const [csvText, setCsvText] = useState('');
  const [csvItems, setCsvItems] = useState<CsvItem[]>([]);
  const [csvError, setCsvError] = useState<string | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);

  function downloadCsvExample() {
    const sample = 'title,author,isbn,epc\nLe Petit Prince,Antoine de Saint-Exupéry,9782070612758,\nSans ISBN,Auteur Inconnu,,ABCDEF0123456789ABCDEF01\n';
    const blob = new Blob([sample], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'bibliomanager2-exemple.csv';
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }

  function parseCsv(text: string) {
    setCsvError(null);
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
    if (lines.length === 0) { setCsvItems([]); return; }
    let headers = lines[0].split(',').map((h) => h.trim().toLowerCase());
    let start = 0;
    if (['title','author','isbn','epc'].some((h) => headers.includes(h))) start = 1; else headers = ['title','author','isbn','epc'];
    const out: CsvItem[] = [];
    for (let i = start; i < lines.length; i++) {
      const cols = lines[i].split(',').map((c) => c.trim());
      const get = (name: string) => {
        const idx = headers.indexOf(name);
        return idx >= 0 ? (cols[idx] || '') : '';
      };
      const title = get('title');
      const author = get('author');
      const isbn = get('isbn');
      const epc = get('epc');
      if (!title || !author) { out.push({ title, author, isbn, epc, status: 'error', error: 'Titre et auteur requis' }); continue; }
      if (epc && !/^([0-9A-Fa-f]{24})$/.test(epc)) { out.push({ title, author, isbn, epc, status: 'error', error: 'EPC invalide (24 hex)' }); continue; }
      out.push({ title, author, isbn: isbn || undefined, epc: epc ? epc.toUpperCase() : undefined, status: 'ok' });
    }
    setCsvItems(out);
  }

  function importCsvItems() {
    const ok = csvItems.filter((x) => x.status === 'ok');
    if (ok.length === 0) { setCsvError('Aucun élément valide à importer'); return; }
    setBooks((prev) => {
      const existsByIsbn = new Set(prev.map((b) => (b.isbn || '').toUpperCase()).filter(Boolean));
      const existsByEpc = new Set(prev.map((b) => b.epc));
      const toAdd: Book[] = [];
      for (const it of ok) {
        const isbnUp = (it.isbn || '').toUpperCase();
        if ((isbnUp && existsByIsbn.has(isbnUp))) continue;
        const epcCode = it.epc && /^([0-9A-F]{24})$/.test(it.epc) && !existsByEpc.has(it.epc) ? it.epc : genEpc96();
        const coverUrl = isbnUp ? `/covers/isbn/${isbnUp}?s=M` : undefined;
        toAdd.push({
          id: Date.now() + Math.floor(Math.random() * 1000),
          epc: epcCode,
          title: it.title,
          author: it.author,
          read: false,
          createdAt: Date.now(),
          isbn: isbnUp || undefined,
          coverUrl,
        });
        if (isbnUp) existsByIsbn.add(isbnUp);
        existsByEpc.add(epcCode);
      }
      if (toAdd.length === 0) return prev;
      return [...toAdd, ...prev];
    });
    setCsvItems([]); setCsvText(''); setCsvError(null);
  }
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
  async function login(username: string, password: string, remember = true) {
    const r = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password, remember }) });
    if (!r.ok) throw new Error('Identifiants invalides');
    const meR = await fetch('/api/auth/me', { cache: 'no-store' });
    const d = await meR.json();
    setMe({ username: d?.user?.username || null, roles: Array.isArray(d.roles) ? d.roles : ['guest'] });
  }
  async function logout() {
    try { await fetch('/api/auth/logout', { method: 'POST' }); } catch {}
    setMe({ username: null, roles: ['guest'] });
    if (route !== '/livres/disponibles') navigate('/livres/disponibles');
  }
  const isAddDisabled = useMemo(() => title.trim().length === 0 || author.trim().length === 0, [title, author]);

  // Health check
  useEffect(() => {
    fetch('/health')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(() => setStatus('ok'))
      .catch(() => setStatus('error'));
  }, []);

  // Stop scan caméra si on quitte les prêts
  useEffect(() => {
    if (route !== '/prets') stopLoanCameraScan();
  }, [route]);

  // Persistence: load once (server first, fallback to localStorage)
  useEffect(() => {
    (async () => {
      let loaded = false;
      try {
        const r = await fetch('/api/state');
        if (r.ok) {
          const d = await r.json();
          if (d && Array.isArray(d.books)) {
            const migratedBooks: Book[] = (d.books as any[]).map((b: any) => ({
              id: typeof b.id === 'number' ? b.id : Date.now(),
              epc: typeof b.epc === 'string' && /^([0-9A-Fa-f]{24})$/.test(b.epc) ? String(b.epc).toUpperCase() : genEpc96(),
              title: String(b.title || ''),
              author: String(b.author || ''),
              read: !!b.read,
              createdAt: typeof b.createdAt === 'number' ? b.createdAt : Date.now(),
              isbn: b.isbn || undefined,
              barcode: b.barcode || undefined,
              coverUrl: b.coverUrl || undefined,
            }));
            setBooks(migratedBooks);
            if (Array.isArray(d.loans)) setLoans(d.loans as Loan[]);
            loaded = true;
          }
        }
      } catch {
        // ignore
      }
      if (!loaded) {
        try {
          const raw = localStorage.getItem('bm2/books');
          if (raw) {
            const parsed = JSON.parse(raw) as any[];
            if (Array.isArray(parsed)) {
              const migrated: Book[] = parsed.map((b: any) => ({
                id: typeof b.id === 'number' ? b.id : Date.now(),
                epc: typeof b.epc === 'string' && /^([0-9A-Fa-f]{24})$/.test(b.epc) ? String(b.epc).toUpperCase() : genEpc96(),
                title: String(b.title || ''),
                author: String(b.author || ''),
                read: !!b.read,
                createdAt: typeof b.createdAt === 'number' ? b.createdAt : Date.now(),
                isbn: b.isbn || undefined,
                barcode: b.barcode || undefined,
                coverUrl: b.coverUrl || undefined,
              }));
              setBooks(migrated);
            }
          }
        } catch {}
        try {
          const rawLoans = localStorage.getItem('bm2/loans');
          if (rawLoans) {
            const parsed = JSON.parse(rawLoans) as Loan[];
            if (Array.isArray(parsed)) setLoans(parsed);
          }
        } catch {}
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
    })();
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

  // Server sync (debounced)
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        fetch('/api/state', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ books, loans }),
        }).catch(() => {});
      } catch {}
    }, 300);
    return () => clearTimeout(t);
  }, [books, loans]);

  function addBook() {
    if (isAddDisabled) return;
    const cleanIsbn = isbn.replace(/[^0-9Xx]/g, '').toUpperCase();
    const coverUrl = cleanIsbn ? `/covers/isbn/${cleanIsbn}?s=M` : undefined;
    setBooks((prev) => [
      {
        id: Date.now(),
        epc: genEpc96(),
        title: title.trim(),
        author: author.trim(),
        read: false,
        createdAt: Date.now(),
        isbn: cleanIsbn || undefined,
        barcode: barcode.trim() || undefined,
        coverUrl,
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
    setBooks((prev) =>
      prev.map((b) => {
        if (b.id !== id) return b;
        const next: Book = { ...b, ...patch } as Book;
        if (Object.prototype.hasOwnProperty.call(patch, 'isbn')) {
          const clean = (patch.isbn || '').replace(/[^0-9Xx]/g, '').toUpperCase();
          next.isbn = clean || undefined;
          next.coverUrl = clean ? `/covers/isbn/${clean}?s=M` : next.coverUrl;
        }
        return next;
      }),
    );
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
      if (sortBy === 'recent' || sortBy === 'addedDesc') return b.createdAt - a.createdAt;
      if (sortBy === 'addedAsc') return a.createdAt - b.createdAt;
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
    const qAlpha = raw.replace(/[^0-9a-zA-Z]/g, '').toLowerCase();
    const norm = (s: string) => s.toLowerCase();
    type Scored = { book: Book; score: number };
    const scored: Scored[] = [];
    for (const b of books) {
      const t = norm(b.title);
      const a = norm(b.author);
      const i = (b.isbn || '').toLowerCase();
      const cb = (b.barcode || '').toLowerCase();
      const sid = shortIdFromEpc(b.epc).toLowerCase();
      let score = 0;
      if (qDigits) {
        if (i.startsWith(qDigits)) score = Math.max(score, 100);
        if (cb.startsWith(qDigits)) score = Math.max(score, 95);
        if (i.includes(qDigits)) score = Math.max(score, 60);
        if (cb.includes(qDigits)) score = Math.max(score, 55);
      }
      if (qAlpha) {
        if (sid.startsWith(qAlpha)) score = Math.max(score, 105);
        else if (sid.includes(qAlpha)) score = Math.max(score, 65);
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
    const codes = [
      b.isbn ? `ISBN ${b.isbn}` : null,
      b.barcode ? `CB ${b.barcode}` : null,
      `ID ${shortIdFromEpc(b.epc)}`,
    ].filter(Boolean).join(' · ');
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

  // Trouve un livre par code scanné (EPC, ISBN, ou code-barres)
  function findBookByScannedCode(raw: string): Book | null {
    let s = String(raw || '').trim();
    const m = /^LA,([0-9A-Fa-f]{24})$/.exec(s);
    if (m) s = m[1];
    if (/^[0-9A-Fa-f]{24}$/.test(s)) {
      const epc = s.toUpperCase();
      const b = books.find((x) => x.epc === epc);
      if (b) return b;
    }
    // Short ID (6 chars base32 Crockford)
    const sid = s.toUpperCase().replace(/\s+/g, '');
    if (/^[0-9A-Z]{6}$/.test(sid)) {
      const b = books.find((x) => shortIdFromEpc(x.epc) === sid);
      if (b) return b;
    }
    const digits = s.replace(/\D/g, '');
    if (digits.length === 13 && (digits.startsWith('978') || digits.startsWith('979'))) {
      const b = books.find((x) => (x.isbn || '').replace(/\D/g, '') === digits);
      if (b) return b;
    }
    if (digits) {
      const b = books.find((x) => (x.barcode || '').replace(/\D/g, '') === digits);
      if (b) return b;
    }
    return null;
  }

  function applyScannedToLoan(raw: string) {
    const b = findBookByScannedCode(raw);
    if (b) {
      selectLoanBook(b);
      return true;
    }
    setLoanBookQuery(String(raw).trim());
    setShowBookSuggestions(true);
    setHighlightIndex(0);
    return false;
  }

  async function startLoanCameraScan() {
    try {
      setLoanScanError(null);
      if ('BarcodeDetector' in window) {
        // @ts-expect-error
        const Detector = (window as any).BarcodeDetector;
        loanDetectorRef.current = new Detector({ formats: ['qr_code', 'ean_13'] });
        const constraints: MediaStreamConstraints = { video: { facingMode: 'environment' }, audio: false } as any;
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        loanStreamRef.current = stream;
        if (loanVideoRef.current) {
          loanVideoRef.current.srcObject = stream;
          await loanVideoRef.current.play().catch(() => {});
        }
        setLoanIsScanning(true);
        const loop = async () => {
          if (!loanIsScanning || !loanVideoRef.current || !loanDetectorRef.current) return;
          try {
            const results = await loanDetectorRef.current.detect(loanVideoRef.current);
            for (const r of results || []) {
              const val = String(r.rawValue || '').trim();
              if (val) {
                const ok = applyScannedToLoan(val);
                if (ok) { await stopLoanCameraScan(); return; }
              }
            }
          } catch {}
          loanLoopRef.current = requestAnimationFrame(loop);
        };
        loanLoopRef.current = requestAnimationFrame(loop);
        return;
      }
      await startLoanZxingScan();
    } catch (e: any) {
      setLoanScanError(e?.message || 'Impossible de démarrer la caméra');
    }
  }

  async function startLoanZxingScan() {
    const mod = await import('https://cdn.jsdelivr.net/npm/@zxing/browser@0.1.4/+esm');
    const { BrowserMultiFormatReader } = mod as any;
    const reader = new BrowserMultiFormatReader();
    loanZxingReaderRef.current = reader;
    setLoanIsScanning(true);
    const controls = await reader.decodeFromVideoDevice(
      undefined,
      loanVideoRef.current!,
      (result: any) => {
        if (result) {
          const txt = String(result.getText ? result.getText() : result.text || '').trim();
          if (txt) {
            const ok = applyScannedToLoan(txt);
            if (ok) { stopLoanCameraScan().catch(() => {}); }
          }
        }
      }
    );
    loanZxingControlsRef.current = controls;
  }

  async function stopLoanCameraScan() {
    setLoanIsScanning(false);
    if (loanLoopRef.current) cancelAnimationFrame(loanLoopRef.current);
    loanLoopRef.current = null;
    if (loanVideoRef.current) { try { loanVideoRef.current.pause(); } catch {}; loanVideoRef.current.srcObject = null; }
    if (loanStreamRef.current) { for (const t of loanStreamRef.current.getTracks()) t.stop(); }
    loanStreamRef.current = null;
    try { if (loanZxingControlsRef.current?.stop) loanZxingControlsRef.current.stop(); } catch {}
    try { if (loanZxingReaderRef.current?.reset) loanZxingReaderRef.current.reset(); } catch {}
    loanZxingControlsRef.current = null;
    loanZxingReaderRef.current = null;
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

  // UID générateur (court, RFID/QR friendly): 1 lettre + 8 chars Base32 Crockford (9 caractères)
  function genUID() {
    try {
      const bytes = new Uint8Array(5); // 40 bits -> 8 caractères en Base32
      crypto.getRandomValues(bytes);
      const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford (sans I, L, O, U)
      let val = 0;
      let bits = 0;
      let out = '';
      for (let i = 0; i < bytes.length; i++) {
        val = (val << 8) | bytes[i];
        bits += 8;
        while (bits >= 5) {
          const idx = (val >>> (bits - 5)) & 31;
          bits -= 5;
          out += alphabet[idx];
        }
      }
      if (bits > 0) out += alphabet[(val << (5 - bits)) & 31];
      return 'B' + out.slice(0, 8);
    } catch {
      const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
      let out = '';
      for (let i = 0; i < 8; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
      return 'B' + out;
    }
  }

  // EPC-96 generator (24 hex chars)
  function genEpc96(): string {
    try {
      const arr = new Uint8Array(12); // 96 bits
      crypto.getRandomValues(arr);
      let hex = '';
      arr.forEach((b) => (hex += b.toString(16).padStart(2, '0')));
      return hex.toUpperCase();
    } catch {
      let hex = '';
      for (let i = 0; i < 12; i++) hex += Math.floor(Math.random() * 256).toString(16).padStart(2, '0');
      return hex.toUpperCase();
    }
  }

  // Génération QR (import dynamique depuis CDN)
  async function genQrDataUrl(text: string, size = 180) {
    try {
      const mod = await import('https://cdn.jsdelivr.net/npm/qrcode@1.5.3/+esm');
      const dataUrl = await (mod as any).toDataURL(text, {
        errorCorrectionLevel: 'M',
        width: size,
        margin: 1,
        type: 'image/png',
        color: { dark: '#000000', light: '#FFFFFF' },
      });
      return dataUrl as string;
    } catch {
      return '';
    }
  }

  async function printBookCard(b: Book) {
    const size = 220;
    const qr = await genQrDataUrl(b.epc, size);
    const w = window.open('', '_blank', 'width=420,height=600');
    if (!w) return;
    const html = `<!DOCTYPE html>
    <html lang="fr"><head><meta charset="utf-8" />
    <title>Carte ${b.title}</title>
    <style>
      @media print { body { margin: 0; } .no-print { display: none; } }
      body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; padding: 24px; }
      .card { width: 320px; border: 2px solid #111; border-radius: 12px; padding: 16px; margin: 0 auto; }
      .title { font-weight: 700; font-size: 16px; margin-bottom: 2px; }
      .author { color: #444; font-size: 13px; margin-bottom: 10px; }
      .row { display:flex; gap: 12px; align-items: center; }
      .uid { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; color:#111; }
      .codes { font-size: 12px; color: #333; }
      .qr { width: ${size}px; height: ${size}px; border: 1px solid #000; }
      .actions { margin-top: 12px; text-align: right; }
      button { padding: 8px 12px; border: 1px solid #111; background: #fff; border-radius: 8px; cursor: pointer; }
    </style>
    </head><body>
      <div class="card">
        <div class="title">${(b.title || '').replace(/</g, '&lt;')}</div>
        <div class="author">${(b.author || '').replace(/</g, '&lt;')}</div>
        <div class="row">
          <img class="qr" src="${qr}" alt="QR" />
        </div>
      <div class="actions no-print"><button onclick="window.print()">Imprimer</button></div>
      </div>
      <script>
        (function(){
          function go(){ try{ window.focus(); window.print(); }catch(e){} setTimeout(function(){ try{ window.close(); }catch(e){} }, 300); }
          var img = document.querySelector('.qr');
          if(img && !img.complete){ img.addEventListener('load', go, { once: true }); img.addEventListener('error', go, { once: true }); }
          else { go(); }
        })();
      </script>
    </body></html>`;
    w.document.open();
    w.document.write(html);
    w.document.close();
    try { w.focus(); } catch {}
  }

  // Impression d'étiquette 44×19 mm (QR EPC + titre)
  async function printEpcLabel(b: Book) {
    const qr = await genQrDataUrl(b.epc, 180);
    const w = window.open('', '_blank', 'width=600,height=400');
    if (!w) return;
    const title = (b.title || '').replace(/</g, '&lt;');
    const author = (b.author || '').replace(/</g, '&lt;');
    const sid = shortIdFromEpc(b.epc);
    const html = `<!DOCTYPE html>
    <html lang="fr"><head><meta charset="utf-8" />
    <title>Étiquette ${title}</title>
    <style>
      @page { size: 44mm 19mm; margin: 0; }
      @media print { body { margin: 0; } .no-print { display: none; } }
      html, body { width: 44mm; height: 19mm; }
      body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; }
      .label { box-sizing: border-box; width: 44mm; height: 19mm; padding: 1.5mm 1.5mm; display: flex; align-items: center; gap: 2mm; }
      .qr { width: 16mm; height: 16mm; }
      .text { flex: 1; display: flex; flex-direction: column; justify-content: center; overflow: hidden; }
      .title { font-weight: 700; font-size: 8pt; line-height: 1.05; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .author { font-size: 7pt; color: #333; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .sid { font-size: 7pt; color: #111; font-weight: 700; }
      .bc { width: 22mm; height: 6mm; }
      .actions { text-align: right; padding: 6px; }
      button { padding: 6px 10px; border: 1px solid #111; background: #fff; border-radius: 6px; cursor: pointer; }
    </style>
    </head><body>
      <div class="label">
        <img class="qr" src="${qr}" alt="QR" />
        <div class="text">
          <div class="title">${title}</div>
          <div class="author">${author}</div>
          <div class="sid">ID: ${sid}</div>
          <svg id="bc" class="bc"></svg>
        </div>
      </div>
      <div class="actions no-print"><button onclick="window.print()">Imprimer</button></div>
      <script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/JsBarcode.all.min.js"></script>
      <script>
        (function(){
          function render(){ try{ JsBarcode('#bc', '${sid}', {format:'CODE128', width:1, height:26, displayValue:false, margin:0}); }catch(e){} }
          function go(){ render(); setTimeout(function(){ try{ window.focus(); window.print(); }catch(e){} setTimeout(function(){ try{ window.close(); }catch(e){} }, 300); }, 100); }
          var img = document.querySelector('.qr');
          if(img && !img.complete){ img.addEventListener('load', go, { once: true }); img.addEventListener('error', go, { once: true }); }
          else { go(); }
        })();
      </script>
    </body></html>`;
    w.document.open();
    w.document.write(html);
    w.document.close();
    try { w.focus(); } catch {}
  }

  // Impression A4 en masse: grille de labels 44×19 mm
  async function printBatchA4(ids: number[]) {
    const items = books.filter((b) => ids.includes(b.id));
    if (items.length === 0) { alert('Sélectionnez au moins un livre.'); return; }
    // Générer les QR en série
    const labeled = await Promise.all(items.map(async (b) => ({ b, qr: await genQrDataUrl(b.epc, 240) })));
    const w = window.open('', '_blank', 'width=1100,height=800');
    if (!w) return;
    const cells = labeled.map(({ b, qr }) => {
      const title = (b.title || '').replace(/</g, '&lt;');
      const author = (b.author || '').replace(/</g, '&lt;');
      const sid = shortIdFromEpc(b.epc);
      return `<div class="label"><img class="qr" src="${qr}" alt="QR" /><div class="text"><div class="title">${title}</div><div class="author">${author}</div><div class="id">ID: ${sid}</div><svg class=\"bc\" data-code=\"${sid}\"></svg></div></div>`;
    }).join('');
    const html = `<!DOCTYPE html>
    <html lang="fr"><head><meta charset="utf-8" />
    <title>Étiquettes (${items.length})</title>
    <style>
      @page { size: A4; margin: 8mm; }
      @media print { body { margin: 0; } .no-print { display: none; } }
      body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; }
      .sheet { display: grid; grid-template-columns: repeat(auto-fill, minmax(44mm, 44mm)); gap: 2mm 4mm; align-content: start; }
      .label { box-sizing: border-box; width: 44mm; height: 19mm; padding: 1.5mm; display: flex; align-items: center; gap: 2mm; border: 1px dashed transparent; }
      .qr { width: 16mm; height: 16mm; }
      .text { flex: 1; display: flex; flex-direction: column; justify-content: center; overflow: hidden; }
      .title { font-weight: 700; font-size: 8pt; line-height: 1.05; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .author { font-size: 7pt; color: #333; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .id { font-size: 7pt; color: #111; font-weight: 700; }
      .bc { width: 22mm; height: 6mm; }
      .toolbar.no-print { position: sticky; top: 0; background: #fff; padding: 8px 0; margin-bottom: 8px; border-bottom: 1px solid #eee; }
      button { padding: 8px 12px; border: 1px solid #111; background: #fff; border-radius: 8px; cursor: pointer; }
    </style>
    </head><body>
      <div class="toolbar no-print"><button onclick="window.print()">Imprimer</button></div>
      <div class="sheet">${cells}</div>
      <script src=\"https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/JsBarcode.all.min.js\"></script>
      <script>(function(){
        function render(){ try { document.querySelectorAll('.bc').forEach(function(el){ var code = el.getAttribute('data-code'); if(code){ JsBarcode(el, code, {format:'CODE128', width:1, height:26, displayValue:false, margin:0}); } }); } catch(e){} }
        function go(){ render(); setTimeout(function(){ try{ window.focus(); window.print(); }catch(e){} }, 200); }
        if(document.readyState === 'complete'){ go(); } else { window.addEventListener('load', go, { once: true }); }
      })();</script>
    </body></html>`;
    w.document.open();
    w.document.write(html);
    w.document.close();
    try { w.focus(); } catch {}
  }

  function QrPreview({ value, size = 128 }: { value: string; size?: number }) {
    const [url, setUrl] = useState('');
    useEffect(() => {
      let cancelled = false;
      (async () => {
        const d = await genQrDataUrl(value, size);
        if (!cancelled) setUrl(d);
      })();
      return () => {
        cancelled = true;
      };
    }, [value, size]);
    return url ? (
      <img src={url} width={size} height={size} alt="QR code" style={{ border: '1px solid #111', background: 'white' }} />
    ) : (
      <div style={{ width: size, height: size, background: 'var(--card-placeholder)', border: '1px dashed #999', borderRadius: 6 }} />
    );
  }

  // Import helpers
  function isValidBarcodeEAN13(s: string) {
    const d = s.replace(/\D/g, '');
    if (d.length !== 13) return false;
    let sum = 0;
    for (let i = 0; i < 12; i++) sum += Number(d[i]) * (i % 2 === 0 ? 1 : 3);
    const check = (10 - (sum % 10)) % 10;
    return check === Number(d[12]);
  }

  function ensureImportItem(barcode: string) {
    const code = barcode.replace(/\D/g, '');
    if (!code) return;
    setImportItems((prev) => {
      if (prev.some((it) => it.barcode === code)) return prev;
      return [{ barcode: code, status: 'pending' }, ...prev];
    });
    (async () => {
      try {
        const r = await fetch(`/api/books/lookup?barcode=${encodeURIComponent(code)}`);
        if (!r.ok) {
          setImportItems((prev) => prev.map((it) => {
            if (it.barcode !== code) return it;
            const notFound = r.status === 404;
            const guessedIsbn = notFound ? inferIsbnFromBarcode(code) : '';
            return { ...it, status: notFound ? 'not_found' : 'error', error: notFound ? undefined : `HTTP ${r.status}`, isbn: guessedIsbn || it.isbn };
          }));
          return;
        }
        const d = await r.json();
        const isbn = d.isbn13 || d.isbn10 || '';
        setImportItems((prev) => prev.map((it) => (it.barcode === code ? { ...it, status: 'ok', title: d.title, author: Array.isArray(d.authors) ? d.authors[0] : undefined, isbn, coverUrl: isbn ? `/covers/isbn/${isbn}?s=S` : undefined } : it)));
      } catch (e: any) {
        setImportItems((prev) => prev.map((it) => (it.barcode === code ? { ...it, status: 'error', error: e?.message || 'Erreur' } : it)));
      }
    })();
  }

  function updateImportItem(code: string, patch: Partial<ImportItem>) {
    setImportItems((prev) => prev.map((it) => (it.barcode === code ? { ...it, ...patch } : it)));
  }

  function markImportItemReady(code: string) {
    setImportItems((prev) => prev.map((it) => {
      if (it.barcode !== code) return it;
      const title = (it.title || '').trim();
      const author = (it.author || '').trim();
      if (!title || !author) return it; // require minimal metadata
      return { ...it, status: 'ok' };
    }));
  }

  async function refreshCameraDevices() {
    try {
      setLoadingDevices(true);
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videos = devices.filter((d) => d.kind === 'videoinput') as MediaDeviceInfo[];
      setCameraDevices(videos);
      if (!selectedCameraId && videos[0]) setSelectedCameraId(videos[0].deviceId);
    } catch {}
    finally { setLoadingDevices(false); }
  }

  async function startCameraScan() {
    try {
      setScanError(null);
      if ('BarcodeDetector' in window) {
        // Prefer BarcodeDetector when available
        // @ts-expect-error BarcodeDetector peut ne pas être typé
        const Detector = (window as any).BarcodeDetector;
        detectorRef.current = new Detector({ formats: ['ean_13'] });
        const constraints: MediaStreamConstraints = {
          video: selectedCameraId ? { deviceId: { exact: selectedCameraId } } : { facingMode: 'environment' },
          audio: false,
        } as any;
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
        setIsScanning(true);
        refreshCameraDevices().catch(() => {});
        const loop = async () => {
          if (!isScanning || !videoRef.current || !detectorRef.current) return;
          try {
            const now = Date.now();
            for (const [k, t] of recentBarcodesRef.current.entries()) if (now - t > 1500) recentBarcodesRef.current.delete(k);
            const results = await detectorRef.current.detect(videoRef.current);
            for (const r of results || []) {
              const raw = String(r.rawValue || '').replace(/\D/g, '');
              if (raw.length === 13 && !recentBarcodesRef.current.has(raw) && isValidBarcodeEAN13(raw)) {
                recentBarcodesRef.current.set(raw, Date.now());
                ensureImportItem(raw);
              }
            }
          } catch {}
          loopRef.current = requestAnimationFrame(loop);
        };
        loopRef.current = requestAnimationFrame(loop);
        return;
      }

      // Fallback to ZXing for wider browser support
      await startZxingScan();
    } catch (e: any) {
      setScanError(e?.message || 'Impossible de démarrer la caméra');
    }
  }

  async function startZxingScan() {
    // Dynamically import ZXing ESM from CDN to avoid bundling
    const mod = await import('https://cdn.jsdelivr.net/npm/@zxing/browser@0.1.4/+esm');
    const { BrowserMultiFormatReader } = mod as any;
    const reader = new BrowserMultiFormatReader();
    zxingReaderRef.current = reader;
    setIsScanning(true);
    const controls = await reader.decodeFromVideoDevice(
      selectedCameraId || undefined,
      videoRef.current!,
      (result: any, err: any) => {
        if (result) {
          const raw = String(result.getText ? result.getText() : result.text || '').replace(/\D/g, '');
          if (raw && raw.length === 13 && isValidBarcodeEAN13(raw)) {
            const seen = recentBarcodesRef.current.get(raw);
            const now = Date.now();
            if (!seen || now - seen > 1500) {
              recentBarcodesRef.current.set(raw, now);
              ensureImportItem(raw);
            }
          }
        }
      }
    );
    zxingControlsRef.current = controls;
    refreshCameraDevices().catch(() => {});
  }

  async function stopCameraScan() {
    setIsScanning(false);
    if (loopRef.current) cancelAnimationFrame(loopRef.current);
    loopRef.current = null;
    if (videoRef.current) {
      try { videoRef.current.pause(); } catch {}
      videoRef.current.srcObject = null;
    }
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) track.stop();
    }
    streamRef.current = null;
    // Stop ZXing if used
    try {
      if (zxingControlsRef.current && typeof zxingControlsRef.current.stop === 'function') {
        zxingControlsRef.current.stop();
      }
    } catch {}
    try {
      if (zxingReaderRef.current && typeof zxingReaderRef.current.reset === 'function') {
        zxingReaderRef.current.reset();
      }
    } catch {}
    zxingControlsRef.current = null;
    zxingReaderRef.current = null;
  }

  useEffect(() => {
    if (route !== '/import') stopCameraScan();
  }, [route]);

  useEffect(() => {
    if (route === '/import' && importMode === 'camera') {
      refreshCameraDevices().catch(() => {});
    }
  }, [route, importMode]);

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
        epc: genEpc96(),
        title: t.trim(),
        author: a.trim(),
        read: false,
        createdAt: Date.now(),
        isbn: cleanIsbn || undefined,
        barcode: cleanBarcode || undefined,
        coverUrl: cleanIsbn ? `/covers/isbn/${cleanIsbn}?s=M` : undefined,
      },
      ...prev,
    ]);
    setTitle('');
    setAuthor('');
    setIsbn('');
    setBarcode('');
  }

  async function addFromSuggestion(s: { title: string; authors?: string[]; isbn13?: string; isbn10?: string; workKey?: string }) {
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

  async function openEditionPicker(s: { title: string; authors?: string[]; workKey?: string }) {
    const t = s.title || '';
    const a = Array.isArray(s.authors) && s.authors[0] ? s.authors[0] : '';
    setTitle(t);
    setAuthor(a);
    setEditionError(null);
    setEditionOptions([]);
    setShowAddSuggestions(false);
    setShowEditionPicker(true);
    try {
      setEditionLoading(true);
      let work = s.workKey;
      if (!work) {
        const r = await fetch(`/api/books/search?q=${encodeURIComponent(`${t} ${a}`.trim())}`);
        if (r.ok) {
          const d = await r.json();
          work = d.results && d.results[0] && d.results[0].workKey;
        }
      }
      if (!work) throw new Error('Impossible de déterminer l’œuvre');
      const ed = await fetch(`/api/books/editions?work=${encodeURIComponent(work)}&limit=30`);
      if (!ed.ok) throw new Error('Échec de récupération des éditions');
      const edData = await ed.json();
      setEditionOptions(Array.isArray(edData.results) ? edData.results : []);
    } catch (e: any) {
      setEditionError(e?.message || 'Erreur');
    } finally {
      setEditionLoading(false);
    }
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

  function LoansList() {
    if (visibleLoans.length === 0) {
      return <p style={{ marginTop: 12 }}>Aucun prêt à afficher.</p>;
    }
    return (
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
                display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
                padding: '10px 12px',
                border: '1px solid var(--border)',
                borderRadius: 8,
                background: returned ? 'var(--card-placeholder)' : overdue ? 'var(--overdue-bg)' : 'var(--panel)',
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <div style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{book ? book.title : 'Livre supprimé'}</div>
                  {book && <div style={{ color: 'var(--muted)', fontWeight: 400, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>— {book.author}</div>}
                  <span className="chip" style={{ padding: '2px 8px', borderRadius: 999, fontSize: 12, border: '1px solid var(--border)', background: returned ? 'var(--card-placeholder)' : overdue ? 'var(--overdue-bg)' : 'var(--active-bg)', color: returned ? 'var(--text)' : overdue ? 'var(--overdue-text)' : 'var(--active-text)' }}>
                    {returned ? 'Rendu' : overdue ? 'En retard' : 'En cours'}
                  </span>
                </div>
                <div style={{ color: 'var(--muted)', fontSize: 14, marginTop: 2 }}>
                  Emprunteur: <strong>{l.borrower}</strong> · {l.startDate} → {l.dueDate}
                  {returned && l.returnedAt ? ` · Rendu le ${l.returnedAt}` : ''}
                </div>
                {!returned && (
                  <div style={{ fontSize: 12, marginTop: 4, color: overdue ? 'var(--overdue-text)' : 'var(--chip-ok-text)' }}>
                    {overdue ? `En retard de ${Math.abs(days)} jour(s)` : `Il reste ${days} jour(s)`}
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', gap: 8, marginLeft: 12, flexWrap: 'wrap' }}>
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
    );
  }

  function LoginForm({ onSubmit }: { onSubmit: (u: string, p: string) => Promise<void> }) {
    const [u, setU] = useState('');
    const [p, setP] = useState('');
    const [err, setErr] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    return (
      <form onSubmit={async (e) => { e.preventDefault(); setErr(null); setLoading(true); try { await onSubmit(u, p); } catch (e: any) { setErr(e?.message || 'Erreur de connexion'); } finally { setLoading(false); } }} style={{ display: 'grid', gap: 12 }}>
        <input aria-label="Nom d'utilisateur" placeholder="Nom d'utilisateur" value={u} onChange={(e) => setU(e.target.value)} style={{ padding: '10px 12px', borderRadius: 6, border: '1px solid var(--border)' }} />
        <input aria-label="Mot de passe" type="password" placeholder="Mot de passe" value={p} onChange={(e) => setP(e.target.value)} style={{ padding: '10px 12px', borderRadius: 6, border: '1px solid var(--border)' }} />
        {err && <div style={{ color: '#8A1F12', fontSize: 14 }}>{err}</div>}
              <button type="submit" disabled={loading || !u || !p} style={{ padding: '10px 12px', borderRadius: 6, width: '100%', border: '1px solid var(--accent)', background: loading ? 'var(--accent-weak)' : 'var(--accent)', color: 'white' }}>{loading ? 'Connexion…' : 'Se connecter'}</button>
      </form>
    );
  }

  function UsersAdmin() {
    const [users, setUsers] = useState<Array<{ username: string; roles: string[] }>>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [newUser, setNewUser] = useState({ username: '', password: '', admin: false, import: false, loans: false } as any);
    useEffect(() => { (async () => {
      try { setLoading(true); const r = await fetch('/api/users'); const d = await r.json(); setUsers(Array.isArray(d.users) ? d.users : []); }
      catch (e: any) { setError(e?.message || 'Erreur'); }
      finally { setLoading(false); }
    })(); }, []);
    async function refresh() {
      try { const r = await fetch('/api/users'); const d = await r.json(); setUsers(Array.isArray(d.users) ? d.users : []); } catch {}
    }
    async function createUser() {
      const roles = [newUser.admin && 'admin', newUser.import && 'import', newUser.loans && 'loans'].filter(Boolean) as string[];
      const r = await fetch('/api/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: newUser.username.trim(), password: newUser.password, roles }) });
      if (!r.ok) { alert('Création échouée'); return; }
      setNewUser({ username: '', password: '', admin: false, import: false, loans: false });
      await refresh();
    }
    async function updateRoles(username: string, roles: string[]) {
      const r = await fetch(`/api/users/${encodeURIComponent(username)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ roles }) });
      if (!r.ok) alert('Mise à jour échouée'); else await refresh();
    }
    async function updatePassword(username: string) {
      const p = prompt("Nouveau mot de passe pour " + username);
      if (!p) return;
      const r = await fetch(`/api/users/${encodeURIComponent(username)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: p }) });
      if (!r.ok) alert('Changement de mot de passe échoué');
    }
    async function remove(username: string) {
      if (!confirm('Supprimer le compte ' + username + ' ?')) return;
      const r = await fetch(`/api/users/${encodeURIComponent(username)}`, { method: 'DELETE' });
      if (!r.ok) alert('Suppression échouée'); else await refresh();
    }
    return (
      <div style={{ display: 'grid', gap: 12 }}>
        {loading ? <div>Chargement…</div> : error ? <div style={{ color: '#8A1F12' }}>{error}</div> : (
          <>
            <div>
              <div className="panel-title" style={{ fontWeight: 700, marginBottom: 6 }}>Utilisateurs</div>
              <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}>
                {users.map((u) => (
                  <li key={u.username} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 10, display: 'grid', gap: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <strong>{u.username}</strong>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button type="button" onClick={() => updatePassword(u.username)} style={{ padding: '6px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--btn-secondary-bg)' }}>Changer mot de passe</button>
                        <button type="button" onClick={() => remove(u.username)} style={{ padding: '6px 8px', borderRadius: 6, border: '1px solid #ef4444', background: '#ef4444', color: 'white' }}>Supprimer</button>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                      {(['admin','import','loans'] as const).map((r) => {
                        const checked = u.roles.includes(r);
                        return (
                          <label key={r} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                            <input type="checkbox" checked={checked} onChange={(e) => {
                              const next = new Set(u.roles);
                              if (e.target.checked) next.add(r); else next.delete(r);
                              updateRoles(u.username, Array.from(next));
                            }} /> {r}
                          </label>
                        );
                      })}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <div className="panel-title" style={{ fontWeight: 700, marginBottom: 6 }}>Créer un compte</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <input placeholder="Nom d'utilisateur" value={newUser.username} onChange={(e) => setNewUser({ ...newUser, username: e.target.value })} style={{ padding: '10px 12px', borderRadius: 6, border: '1px solid var(--border)' }} />
                <input placeholder="Mot de passe" type="password" value={newUser.password} onChange={(e) => setNewUser({ ...newUser, password: e.target.value })} style={{ padding: '10px 12px', borderRadius: 6, border: '1px solid var(--border)' }} />
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><input type="checkbox" checked={!!newUser.admin} onChange={(e) => setNewUser({ ...newUser, admin: e.target.checked })} /> admin</label>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><input type="checkbox" checked={!!newUser.import} onChange={(e) => setNewUser({ ...newUser, import: e.target.checked })} /> import</label>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><input type="checkbox" checked={!!newUser.loans} onChange={(e) => setNewUser({ ...newUser, loans: e.target.checked })} /> loans</label>
              </div>
              <div style={{ marginTop: 8 }}>
                <button type="button" onClick={createUser} disabled={!newUser.username || !newUser.password} style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--accent)', background: 'var(--accent)', color: 'white' }}>Créer</button>
              </div>
            </div>
          </>
        )}
      </div>
    );
  }

  const availableBooks = useMemo(() => {
    const activeIds = new Set(loans.filter((l) => !loanUtils.isReturned(l)).map((l) => l.bookId));
    const q = query.trim().toLowerCase();
    let list = books.filter((b) => !activeIds.has(b.id));
    if (q) {
      list = list.filter((b) =>
        b.title.toLowerCase().includes(q) ||
        b.author.toLowerCase().includes(q) ||
        (b.isbn || '').toLowerCase().includes(q) ||
        (b.barcode || '').toLowerCase().includes(q) ||
        shortIdFromEpc(b.epc).toLowerCase().includes(q)
      );
    }
    list = list.sort((a, b) => {
      if (sortBy === 'recent' || sortBy === 'addedDesc') return b.createdAt - a.createdAt;
      if (sortBy === 'addedAsc') return a.createdAt - b.createdAt;
      if (sortBy === 'title') return a.title.localeCompare(b.title);
      return a.author.localeCompare(b.author);
    });
    return list;
  }, [books, loans, query, sortBy]);

  function addImportFromInput() {
    const lines = importInput.split(/\s|,|;|\n|\r/g).map((s) => s.trim()).filter(Boolean);
    for (const l of lines) ensureImportItem(l);
    setImportInput('');
  }

  function importAllToLibrary() {
    const okItems = importItems.filter((it) => it.status === 'ok');
    if (okItems.length === 0) {
      alert('Aucun livre en statut OK à importer. Vérifiez que les lignes sont marquées OK (ou éditez les “Introuvable” puis cliquez sur « Marquer comme prêt »).');
      return;
    }
    let addedIds: number[] = [];
    setBooks((prev) => {
      const existsByIsbn = new Set(prev.map((b) => (b.isbn || '').toUpperCase()).filter(Boolean));
      const existsByBarcode = new Set(prev.map((b) => (b.barcode || '')).filter(Boolean));
      const toAdd: Book[] = [];
      for (const it of okItems) {
        const isbnUp = (it.isbn || '').toUpperCase();
        if ((isbnUp && existsByIsbn.has(isbnUp)) || (it.barcode && existsByBarcode.has(it.barcode))) continue;
        const coverUrl = isbnUp ? `/covers/isbn/${isbnUp}?s=M` : undefined;
        toAdd.push({
          id: Date.now() + Math.floor(Math.random() * 1000),
          epc: genEpc96(),
          title: it.title || '(Sans titre)',
          author: it.author || '(Auteur inconnu)',
          read: false,
          createdAt: Date.now(),
          isbn: isbnUp || undefined,
          barcode: it.barcode,
          coverUrl,
        });
        if (isbnUp) existsByIsbn.add(isbnUp);
        if (it.barcode) existsByBarcode.add(it.barcode);
      }
      if (toAdd.length === 0) return prev;
      addedIds = toAdd.map((b) => b.id);
      return [...toAdd, ...prev];
    });
    setImportItems((prev) => prev.filter((it) => it.status !== 'ok'));
    if (addedIds.length > 0) {
      setLastImportedIds(addedIds);
      try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch {}
    }
  }

  async function printBatchZplNetwork(ids: number[]) {
    if (!printerHost) { alert("Configurer l'adresse IP de l'imprimante Zebra."); return; }
    const items = books.filter((b) => ids.includes(b.id));
    if (items.length === 0) { alert('Aucun livre à imprimer.'); return; }
    const zpl = items.map((b) => buildZplLabel(b, printerDpi)).join('');
    try {
      const r = await fetch('/api/print/zpl', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ host: printerHost, port: printerPort, zpl }) });
      if (!r.ok) throw new Error('Envoi ZPL échoué');
      alert(items.length + (items.length > 1 ? " étiquettes envoyées à l'imprimante." : " étiquette envoyée à l'imprimante."));
    } catch (e: any) { alert('Erreur impression ZPL: ' + (e?.message || 'inconnue')); }
  }

  return (
    <main className="app-main"
      style={{
        fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
        padding: 24,
        display: 'grid',
        gap: 16,
        maxWidth: 960,
        margin: '0 auto',
      }}
    >
      <header className="app-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            type="button"
            className="hamburger"
            aria-label="Menu"
            aria-expanded={navOpen}
            onClick={() => setNavOpen((v) => !v)}
            style={{ display: 'none', width: 40, height: 40, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--panel)' }}
          >
            <span style={{ display: 'block', width: 20, height: 2, background: 'var(--text)', margin: '0 auto 4px' }} />
            <span style={{ display: 'block', width: 20, height: 2, background: 'var(--text)', margin: '0 auto 4px' }} />
            <span style={{ display: 'block', width: 20, height: 2, background: 'var(--text)', margin: '0 auto' }} />
          </button>
          <h1 style={{ margin: 0 }}>Bibliomanager</h1>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button
          type="button"
          aria-label="Paramètres"
          title="Paramètres"
          onClick={() => navigate('/parametres')}
          style={{
            width: 40,
            height: 40,
            display: 'grid',
            placeItems: 'center',
            borderRadius: 8,
            border: '1px solid var(--border)',
            background: 'var(--panel)',
            color: 'var(--text)',
            cursor: 'pointer',
          }}
        >
          {/* simple gear icon (SVG) */}
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" stroke="currentColor" strokeWidth="1.5"/>
            <path d="M19.4 12.98c.04-.32.06-.65.06-.98 0-.33-.02-.66-.06-.98l2.01-1.57a.5.5 0 0 0 .12-.64l-1.9-3.29a.5.5 0 0 0-.6-.22l-2.37.95a7.63 7.63 0 0 0-1.7-.98l-.36-2.52a.5.5 0 0 0-.5-.43h-3.8a.5.5 0 0 0-.5.43l-.36 2.52c-.6.24-1.17.56-1.7.98l-2.37-.95a.5.5 0 0 0-.6.22L2.47 6.8a.5.5 0 0 0 .12.64L4.6 9.01c-.04.32-.06.65-.06.99 0 .33.02.66.06.98l-2.01 1.57a.5.5 0 0 0-.12.64l1.9 3.29c.13.23.4.32.64.22l2.37-.95c.52.42 1.1.75 1.7.99l.36 2.52c.05.25.26.43.5.43h3.8c.24 0 .45-.18.5-.43l.36-2.52c.6-.24 1.17-.57 1.7-.99l2.37.95c.24.1.51 0 .64-.22l1.9-3.29a.5.5 0 0 0-.12-.64l-2.01-1.57Z" stroke="currentColor" strokeWidth="1.5"/>
          </svg>
        </button>
        {me.username ? (
          <button type="button" onClick={logout} title={`Déconnexion (${me.username})`} style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--btn-secondary-bg)', cursor: 'pointer' }}>
            Se déconnecter
          </button>
        ) : (
          <button type="button" onClick={() => navigate('/connexion')} style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--panel)', cursor: 'pointer' }}>
            Se connecter
          </button>
        )}
        </div>
      </header>

      {route !== '/' && (
        <nav className={`main-nav${navOpen ? ' is-open' : ''}`} aria-label="Navigation principale" style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {[
            { to: '/livres/disponibles', label: 'Livres disponibles', show: true },
            { to: '/livres/nouveau', label: 'Ajouter un livre', show: canImport },
            { to: '/import', label: 'Import en masse', show: canImport },
            { to: '/prets', label: 'Prêts', show: canLoans },
            { to: '/comptes', label: 'Comptes', show: isAdmin },
          ].filter((i) => i.show).map((item) => (
            <a
              key={item.to}
              href={item.to}
              onClick={(e) => { e.preventDefault(); navigate(item.to); setNavOpen(false); }}
              style={{
                padding: 'var(--nav-pad-y, 12px) var(--nav-pad-x, 16px)',
                border: '2px solid ' + (route === item.to ? 'var(--accent)' : 'var(--border)'),
                background: route === item.to ? 'var(--active-bg)' : 'var(--panel)',
                color: route === item.to ? 'var(--active-text)' : 'var(--text)',
                borderRadius: 'var(--nav-radius, 10px)',
                minWidth: 'var(--nav-minw, 160px)',
                textAlign: 'center',
                fontSize: 'var(--nav-font, 16px)',
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
                border: '2px solid var(--border)',
                background: 'var(--panel)',
                minHeight: 140,
                textAlign: 'left',
                fontSize: 18,
                cursor: 'pointer',
              }}
            >
              <div style={{ fontSize: 28 }}>📚</div>
              <div>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>Livres disponibles</div>
                <div style={{ color: 'var(--muted)', fontSize: 14 }}>Consulter et prêter rapidement</div>
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
                border: '2px solid var(--border)',
                background: 'var(--panel)',
                minHeight: 140,
                textAlign: 'left',
                fontSize: 18,
                cursor: 'pointer',
              }}
            >
              <div style={{ fontSize: 28 }}>➕</div>
              <div>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>Ajouter un livre</div>
                <div style={{ color: 'var(--muted)', fontSize: 14 }}>Saisie rapide avec ISBN/CB</div>
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
                border: '2px solid var(--border)',
                background: 'var(--panel)',
                minHeight: 140,
                textAlign: 'left',
                fontSize: 18,
                cursor: 'pointer',
              }}
            >
              <div style={{ fontSize: 28 }}>📄</div>
              <div>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>Prêts</div>
                <div style={{ color: 'var(--muted)', fontSize: 14 }}>Créer et suivre les prêts</div>
              </div>
            </button>

            <button
              onClick={() => navigate('/import')}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'flex-start',
                justifyContent: 'space-between',
                padding: 20,
                borderRadius: 16,
                border: '2px solid var(--border)',
                background: 'var(--panel)',
                minHeight: 140,
                textAlign: 'left',
                fontSize: 18,
                cursor: 'pointer',
              }}
            >
              <div style={{ fontSize: 28 }}>📦</div>
              <div>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>Import en masse</div>
                <div style={{ color: 'var(--muted)', fontSize: 14 }}>Scanner des codes-barres</div>
              </div>
            </button>
          </div>
        </section>
      )}

      {route === '/parametres' && (
        <section style={{ padding: 16, border: '1px solid var(--border)', borderRadius: 8 }}>
          <h2 style={{ marginTop: 0 }}>Paramètres</h2>
          <div style={{ display: 'grid', gap: 20 }}>
            <div>
              <div className="panel-title" style={{ fontWeight: 700, marginBottom: 6 }}>Apparence</div>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
                <input
                  type="checkbox"
                  checked={theme === 'dark'}
                  onChange={(e) => setTheme(e.target.checked ? 'dark' : 'light')}
                />
                Thème sombre
              </label>
              <div style={{ color: 'var(--muted-2)', fontSize: 13, marginTop: 6 }}>S'applique immédiatement et est enregistré localement.</div>
            </div>
            <div>
              <div className="panel-title" style={{ fontWeight: 700, marginBottom: 6 }}>Imprimante Zebra (réseau)</div>
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 10 }}>
                <input
                  aria-label="Adresse IP"
                  placeholder="Adresse IP (ex: 192.168.1.50)"
                  value={printerHost}
                  onChange={(e) => setPrinterHost(e.target.value)}
                  style={{ padding: '10px 12px', borderRadius: 6, border: '1px solid var(--border)' }}
                />
                <input
                  aria-label="Port"
                  placeholder="Port"
                  type="number"
                  value={printerPort}
                  onChange={(e) => setPrinterPort(Number(e.target.value) || 9100)}
                  style={{ padding: '10px 12px', borderRadius: 6, border: '1px solid var(--border)', minWidth: 0 }}
                />
                <input
                  aria-label="DPI"
                  placeholder="DPI (203/300/600)"
                  type="number"
                  value={printerDpi}
                  onChange={(e) => setPrinterDpi(Number(e.target.value) || 203)}
                  style={{ padding: '10px 12px', borderRadius: 6, border: '1px solid var(--border)', minWidth: 0 }}
                />
              </div>
              <div style={{ color: 'var(--muted)', fontSize: 13, marginTop: 6 }}>Ces paramètres sont enregistrés localement dans le navigateur.</div>
            </div>

            <div>
              <div className="panel-title" style={{ fontWeight: 700, marginBottom: 6 }}>Agent local (USB Zebra)</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <span style={{
                  padding: '4px 10px', borderRadius: 999, fontSize: 14,
                  background: agentAvailable ? 'var(--chip-ok-bg)' : 'var(--chip-bad-bg)',
                  color: agentAvailable ? 'var(--chip-ok-text)' : 'var(--chip-bad-text)',
                  border: '1px solid ' + (agentAvailable ? 'var(--chip-ok-border)' : 'var(--chip-bad-border)'),
                }}>
                  {agentAvailable ? 'Agent détecté' : 'Agent indisponible'}
                </span>
              <button type="button" onClick={probeAgent} style={{ padding: '8px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--panel)' }}>Rafraîchir</button>
              </div>
              <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <select
                  aria-label="Imprimante locale"
                  disabled={!agentAvailable}
                  value={agentPrinterName}
                  onChange={(e) => setAgentPrinterName(e.target.value)}
                  style={{ padding: '10px 12px', borderRadius: 6, border: '1px solid var(--border)', minWidth: 240 }}
                >
                  <option value="">Imprimante par défaut</option>
                  {agentPrinters.map((p) => (
                    <option key={p.name} value={p.name}>{p.name}</option>
                  ))}
                </select>
              </div>
              <div style={{ color: 'var(--muted)', fontSize: 13, marginTop: 6 }}>L’agent écoute sur http://localhost:9110.</div>
            </div>

            {isAdmin && (
              <div>
                <div className="panel-title" style={{ fontWeight: 700, marginBottom: 6 }}>Clés API</div>
                <div style={{ display: 'grid', gap: 10 }}>
                  {apiKeys.length === 0 ? (
                    <div style={{ color: 'var(--muted)' }}>Aucune clé définie.</div>
                  ) : (
                    <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 }}>
                      {apiKeys.map((k) => (
                        <li key={k.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px' }}>
                          <div>
                            <div style={{ fontWeight: 600 }}>{k.label || '(sans libellé)'}</div>
                            <div style={{ color: 'var(--muted-2)', fontSize: 12 }}>Créée le {new Date(k.createdAt).toLocaleString()}</div>
                          </div>
                          <button type="button" onClick={async () => {
                            if (!confirm('Révoquer cette clé ?')) return;
                            try { const r = await fetch(`/api/apikeys/${encodeURIComponent(k.id)}`, { method: 'DELETE' }); if (r.ok) setApiKeys((prev) => prev.filter((x) => x.id !== k.id)); } catch {}
                          }} style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--btn-secondary-bg)' }}>Révoquer</button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <input aria-label="Libellé de la clé" placeholder="Libellé (optionnel)" value={apiKeyLabel} onChange={(e) => setApiKeyLabel(e.target.value)} style={{ padding: '10px 12px', borderRadius: 6, border: '1px solid var(--border)', minWidth: 260 }} />
                <button type="button" onClick={async () => {
                  try {
                    const r = await fetch('/api/apikeys', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ label: apiKeyLabel || undefined }) });
                    if (!r.ok) throw new Error('Création échouée');
                    const d = await r.json();
                    setNewApiKeyToken(d.token || '')
                    setApiKeyLabel('');
                    const rl = await fetch('/api/apikeys'); if (rl.ok) { const dj = await rl.json(); if (Array.isArray(dj.keys)) setApiKeys(dj.keys); }
                  } catch (e: any) { alert(e?.message || 'Erreur création clé'); }
                }} style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--accent)', background: 'var(--accent)', color: 'white' }}>Créer une clé</button>
                  </div>
                  {newApiKeyToken && (
                    <div style={{
                      padding: 10,
                      border: `1px solid ${theme === 'dark' ? '#3b82f6' : '#2563eb'}`,
                      background: theme === 'dark' ? 'var(--nav-active-bg)' : '#e5f3ff',
                      borderRadius: 8,
                    }}>
                      <div style={{ fontWeight: 700, marginBottom: 4 }}>Nouvelle clé API</div>
                      <div style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', wordBreak: 'break-all', color: theme === 'dark' ? '#DBEAFE' : undefined }}>{newApiKeyToken}</div>
                      <div style={{ color: theme === 'dark' ? '#93c5fd' : '#1e40af', fontSize: 12, marginTop: 4 }}>Copiez cette clé maintenant: elle ne sera plus affichée.</div>
                      <div style={{ marginTop: 6 }}>
                        <button type="button" onClick={() => { try { navigator.clipboard.writeText(newApiKeyToken); alert('Clé copiée.'); } catch {} }} style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--btn-secondary-bg)' }}>Copier</button>
                        <button type="button" onClick={() => setNewApiKeyToken(null)} style={{ marginLeft: 8, padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--btn-secondary-bg)' }}>Masquer</button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </section>
      )}

      {route === '/connexion' && (
        <div style={{ display: 'grid', placeItems: 'center', minHeight: '75vh' }}>
          <section style={{ padding: 20, border: '1px solid var(--border)', borderRadius: 6, width: 'min(380px, 92vw)', minHeight: 420, background: 'var(--panel)', display: 'grid', alignContent: 'center', gap: 16 }}>
            <h2 style={{ marginTop: 0, textAlign: 'center' }}>Connexion</h2>
            {me.username ? (
              <p style={{ color: 'var(--muted)', textAlign: 'center' }}>Connecté en tant que <strong>{me.username}</strong>.</p>
            ) : (
              <LoginForm onSubmit={async (u, p, remember) => { await login(u, p, remember); navigate('/livres/disponibles'); }} />
            )}
          </section>
        </div>
      )}

      {route === '/livres/nouveau' && (
      <section style={{ padding: 16, border: '1px solid var(--border)', borderRadius: 8 }}>
        <h2 style={{ marginTop: 0 }}>Ajouter un livre</h2>
        {!canImport && (
          <p style={{ color: 'var(--muted)' }}>Accès restreint. Connectez-vous avec un profil Administration ou Import/Ajouts.</p>
        )}
        <div className="add-form-wrapper" style={{ marginBottom: 12 }}>
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
              else if (e.key === 'Enter') { if (addHighlightIndex >= 0) { e.preventDefault(); openEditionPicker(addSuggestions[addHighlightIndex]); } }
              else if (e.key === 'Escape') { setShowAddSuggestions(false); }
            }}
                  style={{ width: '100%', padding: '10px 12px', borderRadius: 6, border: '1px solid var(--border)' }}
          />
          {showEditionPicker && (
            <div style={{ position: 'absolute', zIndex: 10, top: '100%', left: 0, right: 0, background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 10, marginTop: 6, padding: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.1)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <strong>Choisir une édition</strong>
                <button type="button" onMouseDown={(e) => { e.preventDefault(); setShowEditionPicker(false); }} style={{ padding: '6px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--btn-secondary-bg)' }}>Fermer</button>
              </div>
              {editionLoading && <div style={{ padding: 8, color: 'var(--muted)' }}>Chargement des éditions…</div>}
              {editionError && <div style={{ padding: 8, color: '#8A1F12' }}>{editionError}</div>}
              {!editionLoading && !editionError && editionOptions.length === 0 && (
                <div style={{ padding: 8, color: 'var(--muted)' }}>Aucune édition trouvée.</div>
              )}
              {!editionLoading && editionOptions.length > 0 && (
                <ul style={{ listStyle: 'none', margin: 0, padding: 0, maxHeight: 320, overflowY: 'auto', display: 'grid', gap: 6 }}>
                  {editionOptions.map((ed, i) => {
                    const pubs = (ed.publishers || []).join(', ');
                    const is13 = ed.isbn13 && ed.isbn13[0];
                    const is10 = ed.isbn10 && ed.isbn10[0];
                    const isbnText = is13 || is10 || 'ISBN indisponible';
                    return (
                      <li key={(ed.editionKey || i) + String(isbnText)} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                          {is13 ? (
                            <img src={`/covers/isbn/${String(is13)}?s=S`} alt="" width={30} height={44} style={{ objectFit: 'cover', borderRadius: 4 }} />
                          ) : ed.coverUrl ? (
                            <img src={ed.coverUrl} alt="" width={30} height={44} style={{ objectFit: 'cover', borderRadius: 4 }} />
                          ) : (
                            <div style={{ width: 30, height: 44, background: 'var(--card-placeholder)', borderRadius: 4 }} />
                          )}
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{ed.title || title}</div>
                            <div style={{ color: 'var(--muted)', fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{pubs || 'Éditeur inconnu'}{ed.publishDate ? ` — ${ed.publishDate}` : ''}</div>
                            <div style={{ color: '#111', fontSize: 12 }}>{isbnText}</div>
                          </div>
                        </div>
                        <button type="button" onMouseDown={(e) => { e.preventDefault(); setIsbn((is13 || is10 || '')); setShowEditionPicker(false); }} style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid #10b981', background: '#10b981', color: 'white' }}>Sélectionner</button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}
        </div>
        <form className="add-form form-grid"
          onSubmit={(e) => {
            e.preventDefault();
            addBook();
          }}
          style={{}}
        >
          <div className="field f-title">
          <input
            aria-label="Titre"
            placeholder="Titre"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            style={{ padding: '10px 12px', borderRadius: 6, border: '1px solid var(--border)' }}
          />
          </div>
          <div className="field f-author">
          <input
            aria-label="Auteur"
            placeholder="Auteur"
            value={author}
            onChange={(e) => setAuthor(e.target.value)}
            style={{ padding: '10px 12px', borderRadius: 6, border: '1px solid var(--border)' }}
          />
          </div>
          <div className="field f-isbn">
          <input
            aria-label="ISBN"
            placeholder="ISBN (10 ou 13)"
            value={isbn}
            onChange={(e) => setIsbn(e.target.value)}
            style={{ padding: '10px 12px', borderRadius: 6, border: '1px solid var(--border)' }}
          />
          </div>
          <div className="field f-barcode">
          <input
            aria-label="Code-barres"
            placeholder="Code-barres"
            value={barcode}
            onChange={(e) => setBarcode(e.target.value)}
            style={{ padding: '10px 12px', borderRadius: 6, border: '1px solid var(--border)' }}
          />
          </div>
          <div className="field f-lookup">
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
          </div>
          <div className="field f-submit">
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
          </div>
        </form>
        {showAddSuggestions && addQuery.trim() !== '' && (
          <ul role="listbox" className="add-suggest" style={{ zIndex: 10, background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 10, marginTop: 8, listStyle: 'none', padding: 6, maxHeight: 260, overflowY: 'auto', boxShadow: '0 8px 24px rgba(0,0,0,0.08)' }}>
            {addLoading && <li style={{ padding: '8px 10px', color: 'var(--muted)' }}>Recherche…</li>}
            {!addLoading && addSuggestions.length === 0 && <li style={{ padding: '8px 10px', color: 'var(--muted)' }}>Aucun résultat</li>}
            {addSuggestions.map((s, idx) => (
              <li key={s.title + (s.isbn13 || s.isbn10 || idx)}>
                <div role="option" aria-selected={idx === addHighlightIndex} className="add-suggest-row" style={{ gap: 12, padding: '8px 10px', borderRadius: 8, background: idx === addHighlightIndex ? 'var(--nav-active-bg)' : 'transparent' }}>
                  <div className="add-suggest-info" style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                    { (s.isbn13 || s.isbn10) ? (
                      <img src={`/covers/isbn/${String(s.isbn13 || s.isbn10)}?s=S`} alt="" width={36} height={54} style={{ objectFit: 'cover', borderRadius: 4 }} />
                    ) : (
                      s.coverUrl ? <img src={s.coverUrl} alt="" width={36} height={54} style={{ objectFit: 'cover', borderRadius: 4 }} /> : <div style={{ width: 36, height: 54, background: 'var(--card-placeholder)', borderRadius: 4 }} />
                    )}
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{highlight(s.title, addQuery)}</div>
                      <div style={{ color: 'var(--muted-2)', fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{(s.authors && s.authors[0]) || ''}</div>
                      <div style={{ color: 'var(--muted-2)', fontSize: 12 }}>{s.isbn13 || s.isbn10 || ''}</div>
                    </div>
                  </div>
              <button type="button" onMouseDown={(e) => { e.preventDefault(); openEditionPicker(s); }} style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid var(--accent)', background: 'var(--accent)', color: 'white' }}>Choisir édition</button>
                </div>
              </li>
            ))}
          </ul>
        )}
        {(isbnValidityHint || bookLookupError) && (
          <p style={{ color: '#8A1F12', fontSize: 13, marginTop: 8 }}>
            {isbnValidityHint || bookLookupError}
          </p>
        )}
      </section>
      )}

      {route === '/livres/nouveau' && (
      <section style={{ padding: 16, border: '1px solid var(--border)', borderRadius: 8 }}>
        <h2 style={{ marginTop: 0 }}>Tous les livres ({visibleBooks.length})</h2>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
          <input
            aria-label="Rechercher"
            placeholder="Rechercher par titre ou auteur"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ padding: '8px 10px', borderRadius: 6, border: '1px solid var(--border)', minWidth: 240 }}
          />
          {query.trim() && (
            <button type="button" onClick={() => setQuery('')} style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--btn-secondary-bg)' }}>Effacer le filtre</button>
          )}
          <select
            aria-label="Filtrer par statut"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
            style={{ padding: '8px 10px', borderRadius: 6, border: '1px solid var(--border)' }}
          >
            <option value="all">Tous</option>
            <option value="read">Lus</option>
            <option value="unread">À lire</option>
          </select>
          <select
            aria-label="Trier par"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
            style={{ padding: '8px 10px', borderRadius: 6, border: '1px solid var(--border)' }}
          >
            <option value="recent">Ajout (récent → ancien)</option>
            <option value="addedAsc">Ajout (ancien → récent)</option>
            <option value="title">Titre (A→Z)</option>
            <option value="author">Auteur (A→Z)</option>
          </select>
          <div className="bulk-print-bar" style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <button type="button" onClick={() => setSelectedForPrint(new Set(visibleBooks.map((b) => b.id)))} style={{ padding: '8px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--btn-secondary-bg)' }}>Tout sélectionner</button>
            <button type="button" onClick={() => setSelectedForPrint(new Set())} style={{ padding: '8px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--btn-secondary-bg)' }}>Effacer sélection</button>
            <button
              type="button"
              className="print-action"
              onClick={() => printBatchViaLocalAgent(Array.from(selectedForPrint))}
              disabled={selectedForPrint.size === 0}
              title="Imprimer des étiquettes 44×19 via l'agent USB Zebra"
              style={{ padding: '8px 10px', borderRadius: 6, border: '1px solid var(--accent)', background: selectedForPrint.size ? 'var(--accent)' : 'var(--accent-weak)', color: '#fff' }}
            >
              Imprimer USB Zebra (lot) {selectedForPrint.size > 0 ? `(${selectedForPrint.size})` : ''}
            </button>
            <button
              type="button"
              className="print-action"
              onClick={() => printBatchA4(Array.from(selectedForPrint))}
              disabled={selectedForPrint.size === 0}
              title="Générer une planche A4 (grille 44×19) pour imprimante classique"
              style={{ padding: '8px 10px', borderRadius: 6, border: '1px solid #111', background: selectedForPrint.size ? '#111' : '#aaa', color: '#fff' }}
            >
              Imprimer A4 (lot) {selectedForPrint.size > 0 ? `(${selectedForPrint.size})` : ''}
            </button>
          </div>
        </div>
        {visibleBooks.length === 0 ? (
          <p>Aucun livre correspondant. Ajoutez-en un ci-dessus ou modifiez le filtre.</p>
        ) : (
          <>
          <ul className="book-list" style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}>
            {visibleBooks.map((b) => (
              <li
                key={b.id}
                className="book-item"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '10px 12px',
                    border: '1px solid var(--border)',
                  borderRadius: 8,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 0 }}>
                  <input
                    type="checkbox"
                    aria-label="Sélectionner pour impression"
                    checked={selectedForPrint.has(b.id)}
                    onChange={(e) => {
                      setSelectedForPrint((prev) => {
                        const n = new Set(prev);
                        if (e.target.checked) n.add(b.id); else n.delete(b.id);
                        return n;
                      });
                    }}
                  />
                  {b.isbn || b.coverUrl ? (
                    <img src={b.isbn ? `/covers/isbn/${b.isbn}?s=S` : (b.coverUrl as string)} alt="" width={36} height={54} style={{ objectFit: 'cover', borderRadius: 4 }} />
                  ) : (
                    <div style={{ width: 36, height: 54, background: 'var(--card-placeholder)', borderRadius: 4 }} />
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    {editingBookId === b.id ? (
                      <input
                        value={b.title}
                        onChange={(e) => saveBookEdit(b.id, { title: e.target.value })}
                        style={{ padding: '6px 8px', borderRadius: 6, border: '1px solid var(--border)', flex: 1, minWidth: 180 }}
                      />
                    ) : (
                      <span style={{ textDecoration: b.read ? 'line-through' : 'none' }}>{b.title}</span>
                    )}
                  </div>
                  <div style={{ color: 'var(--muted)', fontSize: 14 }}>
                    {editingBookId === b.id ? (
                      <input
                        value={b.author}
                        onChange={(e) => saveBookEdit(b.id, { author: e.target.value })}
                        style={{ padding: '6px 8px', borderRadius: 6, border: '1px solid var(--border)', marginTop: 6, minWidth: 180 }}
                      />)
                    : (
                      <>par {b.author}</>
                    )}
                  </div>
                  {(editingBookId === b.id || b.isbn || b.barcode) && (
                    <div style={{ color: 'var(--muted-2)', fontSize: 12, marginTop: 4 }}>
                      {editingBookId === b.id ? (
                        <>
                          <input
                            placeholder="ISBN"
                            value={b.isbn || ''}
                            onChange={(e) => saveBookEdit(b.id, { isbn: (e.target.value || '').replace(/[^0-9Xx]/g, '').toUpperCase() })}
                            style={{ padding: '6px 8px', borderRadius: 6, border: '1px solid var(--border)', marginRight: 6 }}
                          />
                          <input
                            placeholder="Code-barres"
                            value={b.barcode || ''}
                            onChange={(e) => saveBookEdit(b.id, { barcode: e.target.value })}
                            style={{ padding: '6px 8px', borderRadius: 6, border: '1px solid var(--border)' }}
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
                  
                  {b.epc && (
                    <div style={{ color: '#333', fontSize: 12, marginTop: 2 }}>EPC: <span style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>{b.epc}</span></div>
                  )}
                  </div>
                </div>
                <div className="book-actions" style={{ display: 'flex', gap: 8, marginLeft: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                  <button
                    onClick={() => printViaLocalAgent(b)}
                    title="Imprimer une étiquette 44×19 via l'agent USB Zebra"
                    className="print-action"
                    style={{ padding: '8px 10px', borderRadius: 6, border: '1px solid var(--accent)', background: 'var(--accent)', color: '#fff' }}
                  >
                    Imprimer (USB Zebra)
                  </button>
                  <button
                    onClick={() => setShowCardFor((id) => (id === b.id ? null : b.id))}
                    style={{ padding: '8px 10px', borderRadius: 6, border: '1px solid #111', background: 'var(--panel)' }}
                    aria-expanded={showCardFor === b.id}
                  >
                    Carte
                  </button>
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
          {showCardFor && (
            <div style={{ marginTop: 12, borderTop: '1px dashed var(--border)', paddingTop: 12 }}>
              {(() => {
                const b = visibleBooks.find((x) => x.id === showCardFor);
                if (!b) return null;
                return (
                  <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
                    <div>
                      <strong>Carte d’impression</strong>
                    </div>
                    <div>
                      <QrPreview value={b.epc} size={180} />
                    </div>
                    <div style={{ marginLeft: 'auto', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                      <label style={{ fontSize: 12, color: 'var(--muted-2)' }}>DPI</label>
                      <select aria-label="DPI" value={printerDpi} onChange={(e) => setPrinterDpi(parseInt(e.target.value, 10))} style={{ padding: '6px 8px', borderRadius: 6, border: '1px solid var(--border)' }}>
                        <option value={203}>203</option>
                        <option value={300}>300</option>
                        <option value={600}>600</option>
                      </select>
              <button onClick={() => printViaLocalAgent(b)} style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--accent)', background: 'var(--accent)', color: '#fff' }}>Imprimer (USB Zebra)</button>
                    </div>
                  </div>
                );
              })()}
            </div>
          )}
          </>
        )}
      </section>
      )}

      {route === '/livres/disponibles' && (
      <section style={{ padding: 16, border: '1px solid var(--border)', borderRadius: 8, position: 'relative' }}>
        <h2 style={{ marginTop: 0 }}>Livres disponibles ({availableBooks.length})</h2>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
          <input
            aria-label="Rechercher"
            placeholder="Titre, auteur, ISBN, code-barres"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ padding: '8px 10px', borderRadius: 6, border: '1px solid var(--border)', minWidth: 240 }}
          />
          {query.trim() && (
            <button type="button" onClick={() => setQuery('')} style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--btn-secondary-bg)' }}>Effacer le filtre</button>
          )}
          <select
            aria-label="Trier par"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
            style={{ padding: '8px 10px', borderRadius: 6, border: '1px solid var(--border)' }}
          >
            <option value="recent">Ajout (récent → ancien)</option>
            <option value="addedAsc">Ajout (ancien → récent)</option>
            <option value="title">Titre (A→Z)</option>
            <option value="author">Auteur (A→Z)</option>
          </select>
        </div>
        {availableBooks.length === 0 ? (
          <p>Aucun livre disponible pour le moment.</p>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
            {availableBooks.map((b) => (
              <li key={b.id}>
                <button
                  type="button"
                  onClick={() => setSelectedAvailableBook(b)}
                  aria-label={`Voir détails de ${b.title}`}
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    cursor: 'pointer',
                    border: '1px solid var(--border)',
                    background: 'var(--panel)',
                    borderRadius: 12,
                    padding: 12,
                    display: 'grid',
                    gridTemplateColumns: '48px 1fr',
                    gap: 12,
                  }}
                >
                  {b.isbn ? (
                    <img src={`/covers/isbn/${b.isbn}?s=S`} alt="" width={48} height={72} style={{ objectFit: 'cover', borderRadius: 6 }} />
                  ) : b.coverUrl ? (
                    <img src={b.coverUrl} alt="" width={48} height={72} style={{ objectFit: 'cover', borderRadius: 6 }} />
                  ) : (
                    <div style={{ width: 48, height: 72, background: 'var(--card-placeholder)', borderRadius: 6 }} />
                  )}
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.title}</div>
                    <div style={{ color: 'var(--muted)', fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.author}</div>
                    {(b.isbn || b.barcode) && (
                      <div style={{ color: 'var(--muted-2)', fontSize: 12, marginTop: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {b.isbn && <span>ISBN {b.isbn}</span>}
                        {b.isbn && b.barcode && <span> · </span>}
                        {b.barcode && <span>CB {b.barcode}</span>}
                      </div>
                    )}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}

        {selectedAvailableBook && (
          <div
            role="dialog"
            aria-modal="true"
            onClick={() => setSelectedAvailableBook(null)}
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0,0,0,0.4)',
              display: 'grid',
              placeItems: 'center',
              padding: 16,
            }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{ background: 'var(--panel)', borderRadius: 12, padding: 16, width: 'min(560px, 92vw)', boxShadow: '0 10px 30px rgba(0,0,0,0.2)' }}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
                {selectedAvailableBook.isbn ? (
                  <img src={`/covers/isbn/${selectedAvailableBook.isbn}?s=M`} alt="" width={96} height={144} style={{ objectFit: 'cover', borderRadius: 8 }} />
                ) : selectedAvailableBook.coverUrl ? (
                  <img src={selectedAvailableBook.coverUrl} alt="" width={96} height={144} style={{ objectFit: 'cover', borderRadius: 8 }} />
                ) : (
                  <div style={{ width: 96, height: 144, background: 'var(--card-placeholder)', borderRadius: 8 }} />
                )}
                <div style={{ minWidth: 0, flex: 1 }}>
                  <h3 style={{ margin: '4px 0 6px 0' }}>{selectedAvailableBook.title}</h3>
                  <div style={{ color: 'var(--muted)', marginBottom: 8 }}>par {selectedAvailableBook.author}</div>
                  <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: '120px 1fr', rowGap: 6 }}>
                    <dt style={{ color: 'var(--muted-2)' }}>Statut</dt>
                    <dd style={{ margin: 0 }}>Disponible</dd>
                    {selectedAvailableBook.isbn && (
                      <>
                        <dt style={{ color: 'var(--muted-2)' }}>ISBN</dt>
                        <dd style={{ margin: 0 }}>{selectedAvailableBook.isbn}</dd>
                      </>
                    )}
                    {selectedAvailableBook.barcode && (
                      <>
                        <dt style={{ color: 'var(--muted-2)' }}>Code-barres</dt>
                        <dd style={{ margin: 0 }}>{selectedAvailableBook.barcode}</dd>
                      </>
                    )}
                    <dt style={{ color: 'var(--muted-2)' }}>Ajouté le</dt>
                    <dd style={{ margin: 0 }}>{new Date(selectedAvailableBook.createdAt).toLocaleDateString()}</dd>
                  </dl>
                </div>
              </div>
              <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end' }}>
                <button type="button" onClick={() => setSelectedAvailableBook(null)} style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--btn-secondary-bg)' }}>Fermer</button>
              </div>
            </div>
          </div>
        )}
      </section>
      )}

      {route === '/prets' && (
      <section style={{ padding: 16, border: '1px solid var(--border)', borderRadius: 8 }}>
        <h2 style={{ marginTop: 0 }}>Prêts</h2>
        {!canLoans && (
          <p style={{ color: 'var(--muted)' }}>Accès restreint. Veuillez vous connecter avec un profil autorisé (Administration ou Gestion des prêts).</p>
        )}
        {canLoans && (
        <>
        <div className="panel" style={{ padding: 16, border: '1px solid var(--border)', borderRadius: 12 }}>
          <div className="panel-title" style={{ fontWeight: 700, marginBottom: 12 }}>Nouveau prêt</div>
        <form className="loan-form form-grid"
          onSubmit={(e) => {
            e.preventDefault();
            addLoan();
          }}
          style={{}}
        >
          <div className="field f-book" style={{ position: 'relative' }}>
            <label style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>Livre</label>
            <input
              aria-label="Livre (ID court / ISBN / code-barres / titre / auteur)"
              placeholder="Rechercher par ID, ISBN, code-barres, titre ou auteur…"
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
                if (e.key === 'Enter') {
                  if (bookSuggestions.length > 0 && highlightIndex >= 0 && highlightIndex < bookSuggestions.length) {
                    e.preventDefault();
                    selectLoanBook(bookSuggestions[highlightIndex]);
                    return;
                  }
                  // Try direct match via codes (EPC/ISBN/CB/Short ID)
                  const b = findBookByScannedCode(loanBookQuery);
                  if (b) {
                    e.preventDefault();
                    selectLoanBook(b);
                    return;
                  }
                }
                if (bookSuggestions.length === 0) return;
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setHighlightIndex((i) => (i + 1) % bookSuggestions.length);
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setHighlightIndex((i) => (i - 1 + bookSuggestions.length) % bookSuggestions.length);
                } else if (e.key === 'Escape') {
                  setShowBookSuggestions(false);
                }
              }}
              style={{ width: '100%', padding: '10px 12px', borderRadius: 6, border: '1px solid var(--border)' }}
            />
            <div className="toolbar" style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6, flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={async () => {
                  if (loanIsScanning) { await stopLoanCameraScan(); setLoanScanOpen(false); }
                  else { setLoanScanOpen(true); await startLoanCameraScan(); }
                }}
                style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid ' + (loanIsScanning ? 'var(--danger)' : 'var(--accent)'), background: loanIsScanning ? 'var(--danger)' : 'var(--accent)', color: 'white' }}
              >
                {loanIsScanning ? 'Arrêter caméra' : 'Scanner (caméra)'}
              </button>
              <input
                aria-label="Saisie lecteur (USB)"
                placeholder="Scanner ici (USB)… (QR EPC, ISBN EAN-13 ou ID court)"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    const v = (e.currentTarget.value || '').trim();
                    if (v) applyScannedToLoan(v);
                    e.currentTarget.value = '';
                  }
                }}
                style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', minWidth: 200 }}
              />
              {loanScanError && <span style={{ color: '#8A1F12' }}>{loanScanError}</span>}
            </div>
            {loanScanOpen && (
              <div style={{ marginTop: 8 }}>
                <div style={{ position: 'relative', width: 'min(520px, 100%)' }}>
                  <video ref={loanVideoRef} muted playsInline style={{ width: '100%', borderRadius: 12, border: '1px solid var(--border)', background: '#000' }} />
                  <div style={{ position: 'absolute', inset: 0, border: '2px dashed rgba(255,255,255,0.6)', borderRadius: 12, pointerEvents: 'none' }} />
                </div>
                <small style={{ color: 'var(--muted-2)' }}>
                  QR (EPC) et EAN-13 (ISBN) supportés. Utilise BarcodeDetector ou ZXing en secours. Vous pouvez aussi saisir l’ID court à 6 caractères.
                </small>
              </div>
            )}
            {showBookSuggestions && loanBookQuery.trim() !== '' && bookSuggestions.length > 0 && (
              <ul
                role="listbox"
                style={{
                  position: 'absolute',
                  zIndex: 10,
                  top: '100%',
                  left: 0,
                  right: 0,
                  background: 'var(--panel)',
                  border: '1px solid var(--border)',
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
                        background: idx === highlightIndex ? 'var(--nav-active-bg)' : 'transparent',
                        cursor: 'pointer',
                      }}
                    >
                      <div style={{ fontWeight: 600 }}>{highlight(b.title, loanBookQuery.trim())}</div>
                      <div style={{ color: 'var(--muted-2)', fontSize: 12 }}>
                        {highlight(b.author, loanBookQuery.trim())}
                        {(b.isbn || b.barcode) && (
                          <>
                            {' '}· {b.isbn ? <>ISBN {highlight(String(b.isbn), loanBookQuery.replace(/[^0-9xX]/g, ''))}</> : ''}
                            {b.isbn && b.barcode ? ' · ' : ''}
                            {b.barcode ? <>CB {highlight(String(b.barcode), loanBookQuery.replace(/[^0-9xX]/g, ''))}</> : ''}
                          </>
                        )}
                        {' '}· ID {highlight(shortIdFromEpc(b.epc), loanBookQuery.replace(/[^0-9A-Za-z]/g, ''))}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="field f-borrower">
            <label style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>Emprunteur</label>
            <input
            aria-label="Emprunteur"
            placeholder="Nom de l'emprunteur"
            value={loanBorrower}
            onChange={(e) => setLoanBorrower(e.target.value)}
            style={{ padding: '10px 12px', borderRadius: 6, border: '1px solid var(--border)' }}
          />
          </div>
          <div className="field f-start">
            <label style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>Début</label>
            <input
            type="date"
            aria-label="Date de début"
            value={loanStartDate}
            onChange={(e) => setLoanStartDate(e.target.value)}
            style={{ padding: '10px 12px', borderRadius: 6, border: '1px solid var(--border)' }}
          />
          </div>
          <div className="field f-due">
            <label style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>Échéance</label>
            <input
            type="date"
            aria-label="Date d'échéance"
            value={loanDueDate}
            onChange={(e) => setLoanDueDate(e.target.value)}
            style={{ padding: '10px 12px', borderRadius: 6, border: '1px solid var(--border)' }}
          />
          </div>
          <div className="field f-submit">
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
          </div>
        </form>
        {loanBookId && (
          <div className="book-preview" style={{ marginTop: 8, display: 'flex', gap: 12, alignItems: 'center' }}>
            {(() => { const b = books.find((x) => x.id === loanBookId); if (!b) return null; return (
              <>
                {b.isbn ? (<img src={`/covers/isbn/${b.isbn}?s=S`} alt="" width={36} height={54} style={{ objectFit: 'cover', borderRadius: 6 }} />)
                  : b.coverUrl ? (<img src={b.coverUrl} alt="" width={36} height={54} style={{ objectFit: 'cover', borderRadius: 6 }} />)
                  : (<div style={{ width: 36, height: 54, background: 'var(--card-placeholder)', borderRadius: 6 }} />)}
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.title}</div>
                  <div style={{ color: 'var(--muted)', fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.author}</div>
                  <div style={{ color: 'var(--muted-2)', fontSize: 12 }}>EPC {b.epc.slice(0,8)}…{b.epc.slice(-4)}{b.isbn ? ` · ISBN ${b.isbn}` : ''}</div>
                </div>
                <div style={{ marginLeft: 'auto' }}>
                  <button type="button" onClick={() => { setLoanBookId(''); setLoanBookQuery(''); }} style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--btn-secondary-bg)' }}>Changer</button>
                </div>
              </>
            ); })()}
          </div>
        )}
        {books.length === 0 && (
          <p style={{ color: '#8A1F12', fontSize: 13, marginTop: 8 }}>
            Ajoutez d'abord un livre pour pouvoir créer un prêt.
          </p>
        )}
        </div>

        <div className="panel" style={{ padding: 16, border: '1px solid var(--border)', borderRadius: 12, marginTop: 16 }}>
          <div className="panel-title" style={{ fontWeight: 700, marginBottom: 8 }}>Historique des prêts</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            aria-label="Rechercher un prêt (nom, livre, ISBN, code-barres)"
            placeholder="Filtrer les prêts…"
            value={loanListQuery}
            onChange={(e) => setLoanListQuery(e.target.value)}
            style={{ padding: '8px 10px', borderRadius: 6, border: '1px solid var(--border)', minWidth: 260 }}
          />
          <select
            aria-label="Filtrer les prêts"
            value={loanFilter}
            onChange={(e) => setLoanFilter(e.target.value as typeof loanFilter)}
            style={{ padding: '8px 10px', borderRadius: 6, border: '1px solid var(--border)' }}
          >
            <option value="active">En cours</option>
            <option value="overdue">En retard</option>
            <option value="returned">Rendus</option>
            <option value="all">Tous</option>
          </select>
          <span className="chip" style={{ color: 'var(--chip-ok-text)', background: 'var(--chip-ok-bg)', border: '1px solid var(--chip-ok-border)', padding: '4px 8px', borderRadius: 999, fontSize: 12 }}>
            {loans.filter((l) => !loanUtils.isReturned(l)).length} en cours
          </span>
          <span className="chip" style={{ color: 'var(--overdue-text)', background: 'var(--overdue-bg)', border: '1px solid var(--chip-bad-border)', padding: '4px 8px', borderRadius: 999, fontSize: 12 }}>
            {loans.filter((l) => loanUtils.isOverdue(l)).length} en retard
          </span>
        </div>

        <LoansList />
        </div>
        </>
        )}
      </section>
      )}

      {route === '/import' && (
      <section style={{ padding: 16, border: '1px solid var(--border)', borderRadius: 8 }}>
        <h2 style={{ marginTop: 0 }}>Import en masse</h2>
        {!canImport && (
          <p style={{ color: 'var(--muted)' }}>Accès restreint. Connectez-vous avec un profil Administration ou Import/Ajouts.</p>
        )}
        {canImport && (
        <>
        {lastImportedIds.length > 0 && (
          <div style={{ marginBottom: 12, padding: 12, border: '1px solid var(--border)', borderRadius: 8, background: 'var(--panel)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
              <div>
                <strong>{lastImportedIds.length}</strong> livre(s) importé(s) récemment.
                <span style={{ color: 'var(--muted-2)' }}> Vous pouvez imprimer leurs étiquettes Zebra.</span>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <button type="button" onClick={() => printBatchZplNetwork(lastImportedIds)} style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--accent)', background: 'var(--accent)', color: 'white' }}>Imprimer (réseau)</button>
                <button type="button" onClick={() => printBatchViaLocalAgent(lastImportedIds)} style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--btn-secondary-bg)' }}>Imprimer via agent local</button>
                <button type="button" onClick={() => setLastImportedIds([])} style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--btn-secondary-bg)' }}>Masquer</button>
              </div>
            </div>
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={() => setImportMode('lecteur')}
            style={{
              padding: '8px 12px',
              borderRadius: 8,
              border: '1px solid ' + (importMode === 'lecteur' ? 'var(--active-text)' : 'var(--border)'),
              background: importMode === 'lecteur' ? 'var(--active-bg)' : 'var(--panel)',
              color: importMode === 'lecteur' ? 'var(--active-text)' : 'var(--text)',
              fontWeight: importMode === 'lecteur' ? 700 : 500,
            }}
          >
            Lecteur externe
          </button>
          <button
            type="button"
            onClick={async () => { setImportMode('camera'); await refreshCameraDevices(); if (!isScanning) await startCameraScan(); }}
            style={{
              padding: '8px 12px',
              borderRadius: 8,
              border: '1px solid ' + (importMode === 'camera' ? 'var(--active-text)' : 'var(--border)'),
              background: importMode === 'camera' ? 'var(--active-bg)' : 'var(--panel)',
              color: importMode === 'camera' ? 'var(--active-text)' : 'var(--text)',
              fontWeight: importMode === 'camera' ? 700 : 500,
            }}
          >
            Caméra (expérimental)
          </button>
          <button
            type="button"
            onClick={() => setImportMode('csv')}
            style={{
              padding: '8px 12px',
              borderRadius: 8,
              border: '1px solid ' + (importMode === 'csv' ? 'var(--active-text)' : 'var(--border)'),
              background: importMode === 'csv' ? 'var(--active-bg)' : 'var(--panel)',
              color: importMode === 'csv' ? 'var(--active-text)' : 'var(--text)',
              fontWeight: importMode === 'csv' ? 700 : 500,
            }}
          >
            CSV (titre,auteur,isbn,epc)
          </button>
        </div>

        {importMode === 'lecteur' && (
          <div style={{ display: 'grid', gap: 8, marginBottom: 16 }}>
            <label style={{ fontWeight: 600 }}>Scanner des codes (un par ligne)</label>
            <textarea
              aria-label="Barcodes"
              rows={4}
              placeholder="Collez ou scannez des codes-barres ici…"
              value={importInput}
              onChange={(e) => setImportInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey || e.shiftKey === false)) { e.preventDefault(); addImportFromInput(); } }}
              style={{ padding: 10, borderRadius: 8, border: '1px solid var(--border)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}
            />
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" onClick={addImportFromInput} style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--accent)', background: 'var(--accent)', color: 'white' }}>Ajouter</button>
              <button type="button" onClick={() => setImportInput('')} style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--btn-secondary-bg)' }}>Effacer</button>
            </div>
            <small style={{ color: 'var(--muted-2)' }}>Astuce: la plupart des lecteurs USB émulent un clavier et envoient « Entrée » après la saisie.</small>
          </div>
        )}

        {importMode === 'camera' && (
          <div style={{ display: 'grid', gap: 8, marginBottom: 16 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                {!isScanning ? (
                <button type="button" onClick={startCameraScan} style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--accent)', background: 'var(--accent)', color: 'white' }}>Démarrer la caméra</button>
              ) : (
                <button type="button" onClick={stopCameraScan} style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--danger)', background: 'var(--danger)', color: 'white' }}>Arrêter</button>
              )}
              {scanError && <span style={{ color: '#8A1F12' }}>{scanError}</span>}
              <button type="button" onClick={refreshCameraDevices} style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--btn-secondary-bg)' }}>{loadingDevices ? 'Scan…' : 'Rafraîchir les caméras'}</button>
            </div>
            {cameraDevices.length > 0 && (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <label style={{ fontWeight: 600 }}>Caméra</label>
                <select
                  aria-label="Choisir la caméra"
                  value={selectedCameraId}
                  onChange={async (e) => {
                    const id = e.target.value;
                    setSelectedCameraId(id);
                    if (isScanning) { await stopCameraScan(); await startCameraScan(); }
                  }}
                  style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', minWidth: 220 }}
                >
                  {cameraDevices.map((d, i) => (
                    <option key={d.deviceId || i} value={d.deviceId}>
                      {(d.label && d.label.trim()) || `Caméra ${i + 1}`}
                    </option>
                  ))}
                </select>
                {cameraDevices.length > 1 && (
                  <button type="button" onClick={async () => { await cycleCamera(); }} style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--btn-secondary-bg)' }}>Basculer</button>
                )}
              </div>
            )}
            <div style={{ position: 'relative', width: 'min(640px, 100%)' }}>
              <video ref={videoRef} muted playsInline style={{ width: '100%', borderRadius: 12, border: '1px solid var(--border)', background: '#000' }} />
              <div style={{ position: 'absolute', inset: 0, border: '2px dashed rgba(255,255,255,0.6)', borderRadius: 12, pointerEvents: 'none' }} />
            </div>
            <small style={{ color: 'var(--muted-2)' }}>
              La caméra utilise BarcodeDetector quand disponible (Chrome/Edge), sinon bascule automatiquement sur ZXing (fonctionne sur Safari/Firefox).
            </small>
          </div>
        )}

        {importMode === 'csv' && (
          <div style={{ display: 'grid', gap: 8, marginBottom: 16 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <button type="button" onClick={downloadCsvExample} style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--btn-secondary-bg)' }}>Télécharger un exemple CSV</button>
              <input ref={fileInputRef} type="file" accept=".csv,text/csv" onChange={async (e) => {
                const f = e.currentTarget.files && e.currentTarget.files[0];
                if (!f) return;
                const text = await f.text();
                setCsvText(text);
                parseCsv(text);
              }} />
            </div>
            <label style={{ fontWeight: 600 }}>Coller du CSV (entêtes: title,author,isbn,epc)</label>
            <textarea
              aria-label="CSV"
              rows={6}
              placeholder="title,author,isbn,epc\nMon titre,Mon auteur,978...,ABCDEF0123456789ABCDEF01"
              value={csvText}
              onChange={(e) => { setCsvText(e.target.value); parseCsv(e.target.value); }}
              style={{ padding: 10, borderRadius: 8, border: '1px solid var(--border)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}
            />
            {csvError && <div style={{ color: '#8A1F12' }}>{csvError}</div>}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <strong>Aperçu: {csvItems.length} ligne(s)</strong>
            <button type="button" onClick={importCsvItems} disabled={csvItems.every((x) => x.status !== 'ok')} style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--success)', background: csvItems.some((x) => x.status === 'ok') ? 'var(--success)' : '#9ae6b4', color: 'white' }}>Importer {csvItems.filter((x) => x.status === 'ok').length} livre(s)</button>
            </div>
            {csvItems.length > 0 && (
              <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 6 }}>
                {csvItems.map((it, i) => (
                  <li key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px' }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.title} — <span style={{ fontWeight: 400 }}>{it.author}</span></div>
                      <div style={{ color: 'var(--muted)', fontSize: 12 }}>{it.isbn ? `ISBN ${it.isbn}` : 'ISBN non fourni'}{it.epc ? ` · EPC ${it.epc}` : ''}</div>
                    </div>
                    <span style={{ padding: '4px 8px', borderRadius: 999, fontSize: 12, border: '1px solid var(--border)', background: it.status === 'ok' ? 'var(--chip-ok-bg)' : 'var(--chip-bad-bg)', color: it.status === 'ok' ? 'var(--chip-ok-text)' : 'var(--chip-bad-text)' }}>
                      {it.status === 'ok' ? 'OK' : it.error || 'Erreur'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <h3 style={{ margin: 0 }}>À importer ({importItems.length})</h3>
          <button type="button" onClick={importAllToLibrary} disabled={importItems.every((it) => it.status !== 'ok')} style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--success)', background: importItems.some((it) => it.status === 'ok') ? 'var(--success)' : '#9ae6b4', color: 'white' }}>
            Importer les livres OK ({importItems.filter((it) => it.status === 'ok').length})
          </button>
        </div>
        {importItems.length === 0 ? (
          <p>Aucun élément en file d'import.</p>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}>
            {importItems.map((it) => (
              <li key={it.barcode} style={{ display: 'grid', gridTemplateColumns: '1fr auto', alignItems: 'center', gap: 12, padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                  {it.isbn ? (
                    <img src={`/covers/isbn/${it.isbn}?s=S`} alt="" width={36} height={54} style={{ objectFit: 'cover', borderRadius: 4 }} />
                  ) : (
                    <div style={{ width: 36, height: 54, background: 'var(--card-placeholder)', borderRadius: 4 }} />
                  )}
                  <div style={{ minWidth: 0 }}>
                    {it.status === 'not_found' ? (
                      <div style={{ display: 'grid', gap: 6 }}>
                        <div style={{ display: 'grid', gap: 6, gridTemplateColumns: '1fr 1fr' }}>
                          <input
                            aria-label={`Titre pour ${it.barcode}`}
                            placeholder="Titre"
                            value={it.title || ''}
                            onChange={(e) => updateImportItem(it.barcode, { title: e.target.value })}
                            style={{ padding: '8px 10px', borderRadius: 6, border: '1px solid var(--border)', minWidth: 0 }}
                          />
                          <input
                            aria-label={`Auteur pour ${it.barcode}`}
                            placeholder="Auteur"
                            value={it.author || ''}
                            onChange={(e) => updateImportItem(it.barcode, { author: e.target.value })}
                            style={{ padding: '8px 10px', borderRadius: 6, border: '1px solid var(--border)', minWidth: 0 }}
                          />
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                          <input
                            aria-label={`ISBN pour ${it.barcode}`}
                            placeholder="ISBN (optionnel)"
                            value={it.isbn || ''}
                            onChange={(e) => updateImportItem(it.barcode, { isbn: e.target.value })}
                            style={{ padding: '8px 10px', borderRadius: 6, border: '1px solid var(--border)', minWidth: 220 }}
                          />
                          <div style={{ color: 'var(--muted-2)', fontSize: 12 }}>CB {it.barcode}</div>
                        </div>
                        <div>
                          <button
                            type="button"
                            onClick={() => markImportItemReady(it.barcode)}
                            disabled={!((it.title || '').trim() && (it.author || '').trim())}
                            style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--success)', background: ((it.title || '').trim() && (it.author || '').trim()) ? 'var(--success)' : '#9ae6b4', color: 'white' }}
                          >
                            Marquer comme prêt
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.title || '(Titre inconnu)'}</div>
                        <div style={{ color: 'var(--muted-2)', fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.author || ''}</div>
                        <div style={{ color: 'var(--muted-2)', fontSize: 12 }}>CB {it.barcode}{it.isbn ? ` · ISBN ${it.isbn}` : ''}</div>
                      </>
                    )}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifySelf: 'end' }}>
                  <span style={{ padding: '4px 8px', borderRadius: 999, fontSize: 12, border: '1px solid var(--border)', background: it.status === 'ok' ? 'var(--chip-ok-bg)' : it.status === 'pending' ? 'var(--card-placeholder)' : it.status === 'not_found' ? '#FEF3C7' : 'var(--chip-bad-bg)', color: it.status === 'ok' ? 'var(--chip-ok-text)' : it.status === 'not_found' ? '#8B5E00' : it.status === 'error' ? 'var(--chip-bad-text)' : 'var(--text)' }}>
                    {it.status === 'ok' ? 'OK' : it.status === 'pending' ? 'En cours' : it.status === 'not_found' ? 'Introuvable' : 'Erreur'}
                  </span>
                  <button type="button" onClick={() => setImportItems((prev) => prev.filter((x) => x.barcode !== it.barcode))} aria-label={`Retirer ${it.barcode}`} style={{ padding: '6px 8px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--btn-secondary-bg)' }}>Retirer</button>
                </div>
              </li>
            ))}
          </ul>
        )}
        </>
        )}
      </section>
      )}

      {route === '/comptes' && (
        <section style={{ padding: 16, border: '1px solid var(--border)', borderRadius: 8 }}>
          <h2 style={{ marginTop: 0 }}>Comptes</h2>
          {!isAdmin ? (
            <p style={{ color: 'var(--muted)' }}>Accès réservé aux administrateurs.</p>
          ) : (
            <UsersAdmin />
          )}
        </section>
      )}
    </main>
  );
}
