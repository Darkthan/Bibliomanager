import React, { useEffect, useMemo, useState } from 'react';
import './responsive.css';
import { 
  startRegistration, 
  startAuthentication,
  browserSupportsWebAuthn,
} from '@simplewebauthn/browser';
import type {
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
} from '@simplewebauthn/browser';

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
  deleted?: boolean;
  deletedAt?: number;
  labelPrinted?: boolean;
  labelPrintedAt?: number;
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
  const [statusFilter, setStatusFilter] = useState<'all' | 'read' | 'unread' | 'unprinted' | 'printed'>('all');
  const [sortBy, setSortBy] = useState<'recent' | 'title' | 'author' | 'addedAsc' | 'addedDesc'>('recent');
  const [loans, setLoans] = useState<Loan[]>([]);
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'success' | 'error'>('idle');
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
  // Pending sync management for offline logout
  function savePendingSyncPayload(payload?: { books: Book[]; loans: Loan[] }) {
    try {
      const data = payload || { books, loans };
      localStorage.setItem('bm2/pendingSync', JSON.stringify({ ...data, ts: Date.now() }));
    } catch {}
  }
  async function tryFlushPendingSync() {
    try {
      const raw = localStorage.getItem('bm2/pendingSync');
      if (!raw) return;
      const data = JSON.parse(raw);
      const res = await fetch('/api/state', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ books: data.books || [], loans: data.loans || [] }) });
      if (res.ok) {
        localStorage.removeItem('bm2/pendingSync');
        const pendingLogout = localStorage.getItem('bm2/pendingLogout') === '1';
        if (pendingLogout) {
          try { await fetch('/api/auth/logout', { method: 'POST' }); } catch {}
          localStorage.removeItem('bm2/pendingLogout');
          setMe({ username: null, roles: ['guest'] });
          if (route !== '/livres/disponibles') navigate('/livres/disponibles');
        }
      }
    } catch {}
  }
  // Lightweight wrapper to group advanced settings by theme
  function SettingsBlock({ title, children }: { title: string; children: React.ReactNode }) {
    return (
      <section
        aria-label={title}
        style={{
          border: '1px solid var(--border)',
          borderRadius: 10,
          padding: 16,
          background: 'var(--card)',
          display: 'grid',
          gap: 16,
        }}
      >
        <div style={{ fontWeight: 800, fontSize: 16 }}>{title}</div>
        {children}
      </section>
    );
  }
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
  // Popup d'impression en masse
  const [showPrintModal, setShowPrintModal] = useState(false);
  const [printModalBooks, setPrintModalBooks] = useState<number[]>([]);
  const [selectedForBatchPrint, setSelectedForBatchPrint] = useState<Set<number>>(new Set());
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
  // Carte QR imprimable (page Gestion des livres)
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
  // Scan de couverture pour un livre en édition
  const [scanningCoverForBookId, setScanningCoverForBookId] = useState<number | null>(null);
  const [agentPrinters, setAgentPrinters] = useState<Array<{ name: string; driver?: string; default?: boolean }>>([]);
  const [agentPrinterName, setAgentPrinterName] = useState<string>('');
  // API Keys (admin)
  type ApiKey = { id: string; label?: string; createdAt: number };
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [apiKeyLabel, setApiKeyLabel] = useState('');
  const [newApiKeyToken, setNewApiKeyToken] = useState<string | null>(null);

  // WebAuthn Configuration (admin)
  const [webauthnConfig, setWebauthnConfig] = useState({ rpId: '', rpOrigin: '', rpName: '' });
  const [webauthnConfigSaved, setWebauthnConfigSaved] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  // Advanced settings mode
  const [showAdvancedSettings, setShowAdvancedSettings] = useState(false);
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

      // Load WebAuthn configuration
      try {
        const r = await fetch('/api/admin/webauthn-config', { cache: 'no-store' });
        if (r.ok) {
          const config = await r.json();
          setWebauthnConfig({
            rpId: config.rpId || '',
            rpOrigin: config.rpOrigin || '',
            rpName: config.rpName || 'Bibliomanager'
          });
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
  function toZplUtf8Hex(text: string) {
    try {
      const bytes = new TextEncoder().encode(text || '');
      let out = '';
      for (let i = 0; i < bytes.length; i++) {
        const b = bytes[i];
        const h = b.toString(16).toUpperCase().padStart(2, '0');
        out += '_' + h;
      }
      return out;
    } catch { return ''; }
  }
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
  // Online state and edit permission
  const [isOnline, setIsOnline] = useState<boolean>(typeof navigator !== 'undefined' ? navigator.onLine : true);

  useEffect(() => {
    const update = () => setIsOnline(typeof navigator !== 'undefined' ? navigator.onLine : true);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update); };
  }, []);
  const canEditNow = !!me.username && isOnline;
  function requireEdit() {
    if (!canEditNow) { alert('Mode consultation uniquement (hors ligne ou non connecté).'); return false; }
    return true;
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
    // Texte brut
    const rawTitle = b.title || '';
    const rawAuthor = b.author || '';
    
    const xQr = margin;
    // Centrer le QR verticalement, avec une légère compensation vers le haut (quiet zone)
    const yQr = Math.max(0, Math.round((h - approxQrDots) / 2) - Math.round(1.0 * dpmm));
    const xText = xQr + approxQrDots + Math.round(1.8 * dpmm);
    const yTitle = margin;
    // Tailles de police plus petites et multi-lignes possibles pour le titre
    const titleDot = Math.max(9, Math.round(2.6 * dpmm)); // ≈2.6mm
    const authorDot = Math.max(8, Math.round(2.2 * dpmm)); // ≈2.2mm
    const idDot = Math.max(7, Math.round(1.9 * dpmm));     // petite ligne
    const lineGap = Math.max(1, Math.round(0.4 * dpmm));
    const titleLinesMax = 2;
    const authorLinesMax = 1; // Auteur sur une seule ligne
    const textWidth = Math.max(20, w - xText - margin);
    // Calcul d'un y pour l'auteur qui laisse la place à 2 lignes de titre
    const yAuthor = yTitle + (titleDot * titleLinesMax) + (lineGap * (titleLinesMax - 1)) + Math.round(0.3 * dpmm);
    let yShort = yAuthor + (authorDot * authorLinesMax) + (lineGap * (authorLinesMax - 1)) + Math.round(0.4 * dpmm);

    // Limites strictes: 2 lignes titre (≤30 chars) et 1 ligne auteur (≤20 chars)
    const titleMaxChars = 30;
    const authorMaxChars = 20;
    const title = (() => {
      let t = (rawTitle || '').replace(/\s+/g, ' ').trim();
      if (t.length > titleMaxChars) t = t.slice(0, titleMaxChars - 1) + '…';
      return t;
    })();
    const author = (() => {
      let t = (rawAuthor || '').replace(/\s+/g, ' ').trim();
      if (t.length > authorMaxChars) t = t.slice(0, authorMaxChars - 1) + '…';
      return t;
    })();
    const sid = shortIdFromEpc(b.epc);
    const barH = Math.max(10, Math.round(5.2 * dpmm));
    const bottomLimit = h - barH - Math.round(0.6 * dpmm);
    const idMinGap = Math.max(1, Math.round(0.8 * dpmm));
    // S'assurer que l'ID ne chevauche jamais le code-barres: placer le code-barres en bas
    // et remonter l'ID si nécessaire pour garantir un écart minimal.
    yShort = Math.min(yShort, bottomLimit - idDot - idMinGap);
    const yBar = bottomLimit;
    return `^XA\n^CI28\n^PW${w}\n^LL${h}\n^LH0,0\n`
      + `^RFW,H,2,6^FD${b.epc}^FS\n`
      + `^FO${xQr},${yQr}\n^BQN,2,${mag}\n^FDLA,${b.epc}^FS\n`
      + `^FO${xText},${yTitle}\n^A0N,${titleDot},${titleDot}^FB${textWidth},${titleLinesMax},${lineGap},L,0^FH^FD${toZplUtf8Hex(title)}^FS\n`
      + `^FO${xText},${yAuthor}\n^A0N,${authorDot},${authorDot}^FB${textWidth},${authorLinesMax},${lineGap},L,0^FH^FD${toZplUtf8Hex(author)}^FS\n`
      // ID en "gras" (double impression légère) + Code128 compact
      + `^FO${xText},${yShort}\n^A0N,${idDot},${idDot}^FB${textWidth},1,0,L,0^FH^FD${toZplUtf8Hex('ID: ' + sid)}^FS\n`
      + `^FO${xText + 1},${yShort}\n^A0N,${idDot},${idDot}^FB${textWidth},1,0,L,0^FH^FD${toZplUtf8Hex('ID: ' + sid)}^FS\n`
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

      // Marquer le livre comme imprimé après impression réussie
      await markBooksAsPrinted([b.id]);
      alert("Étiquette envoyée à l'agent local.");
    } catch (e: any) {
      alert('Erreur agent local: ' + (e?.message || 'inconnue'));
    }
  }

  // Recharger les données depuis le serveur
  async function reloadData() {
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
            ...(b.labelPrinted !== undefined && { labelPrinted: b.labelPrinted }),
            ...(b.labelPrintedAt !== undefined && { labelPrintedAt: b.labelPrintedAt }),
          }));
          setBooks(migratedBooks);
          if (Array.isArray(d.loans)) setLoans(d.loans as Loan[]);
          saveViewCache({ books: d.books, loans: Array.isArray(d.loans) ? d.loans : [] });
        }
      }
    } catch (e) {
      console.error('Erreur lors du rechargement des données:', e);
    }
  }

  // Marquer les livres comme ayant eu leur étiquette imprimée
  async function markBooksAsPrinted(bookIds: number[]) {
    try {
      const response = await fetch('/api/books/mark-printed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookIds })
      });
      if (!response.ok) {
        throw new Error('Erreur lors du marquage des livres');
      }
      const result = await response.json();
      // Recharger les données pour mettre à jour l'état
      await reloadData();
      return result;
    } catch (e: any) {
      console.error('Erreur markBooksAsPrinted:', e);
      throw e;
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

      // Marquer les livres comme imprimés après impression réussie
      await markBooksAsPrinted(ids);
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
  type CsvItem = { title: string; author: string; isbn?: string; epc?: string; id?: number; status: 'ok' | 'error'; error?: string };
  const [csvText, setCsvText] = useState('');
  const [csvItems, setCsvItems] = useState<CsvItem[]>([]);
  const [csvError, setCsvError] = useState<string | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  const sqlFileInputRef = React.useRef<HTMLInputElement | null>(null);

  function downloadCsvExample() {
    const sample = 'title,author,isbn,epc,id\nLe Petit Prince,Antoine de Saint-Exupéry,9782070612758,,1\nSans ISBN,Auteur Inconnu,,ABCDEF0123456789ABCDEF01,2\n';
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
    if (['title','author','isbn','epc','id'].some((h) => headers.includes(h))) start = 1; else headers = ['title','author','isbn','epc','id'];
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
      const idStr = get('id');
      const id = idStr ? parseInt(idStr, 10) : undefined;
      if (!title || !author) { out.push({ title, author, isbn, epc, id, status: 'error', error: 'Titre et auteur requis' }); continue; }
      if (epc && !/^([0-9A-Fa-f]{24})$/.test(epc)) { out.push({ title, author, isbn, epc, id, status: 'error', error: 'EPC invalide (24 hex)' }); continue; }
      if (idStr && (isNaN(id!) || id! <= 0)) { out.push({ title, author, isbn, epc, id, status: 'error', error: 'ID invalide (nombre positif requis)' }); continue; }
      out.push({ title, author, isbn: isbn || undefined, epc: epc ? epc.toUpperCase() : undefined, id: id && id > 0 ? id : undefined, status: 'ok' });
    }
    setCsvItems(out);
  }

  function importCsvItems() {
    if (!requireEdit()) { alert('Import désactivé en mode consultation.'); return; }
    const ok = csvItems.filter((x) => x.status === 'ok');
    if (ok.length === 0) { setCsvError('Aucun élément valide à importer'); return; }
    setBooks((prev) => {
      const existsByIsbn = new Set(prev.map((b) => (b.isbn || '').toUpperCase()).filter(Boolean));
      const existsByEpc = new Set(prev.map((b) => b.epc));
      const existsById = new Set(prev.map((b) => b.id));
      const toAdd: Book[] = [];
      for (const it of ok) {
        const isbnUp = (it.isbn || '').toUpperCase();
        if ((isbnUp && existsByIsbn.has(isbnUp))) continue;
        if (it.id && existsById.has(it.id)) continue;
        const epcCode = it.epc && /^([0-9A-F]{24})$/.test(it.epc) && !existsByEpc.has(it.epc) ? it.epc : genEpc96();
        const coverUrl = isbnUp ? `/covers/isbn/${isbnUp}?s=M` : undefined;
        const bookId = it.id && it.id > 0 ? it.id : (Date.now() + Math.floor(Math.random() * 1000));
        toAdd.push({
          id: bookId,
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
        existsById.add(bookId);
      }
      if (toAdd.length === 0) return prev;
      return [...toAdd, ...prev];
    });
    setCsvItems([]); setCsvText(''); setCsvError(null);
  }

  // Fonctions d'export/import pour admin
  function exportToCSV() {
    const activeBooks = books.filter(b => !b.deleted);
    if (activeBooks.length === 0) {
      alert('Aucun livre à exporter');
      return;
    }
    
    const headers = 'title,author,isbn,epc,id';
    const rows = activeBooks.map(b => {
      const title = (b.title || '').replace(/,/g, '""').replace(/"/g, '""');
      const author = (b.author || '').replace(/,/g, '""').replace(/"/g, '""');
      const isbn = b.isbn || '';
      const epc = b.epc || '';
      const id = b.id || '';
      return `"${title}","${author}","${isbn}","${epc}","${id}"`;
    });
    
    const csvContent = [headers, ...rows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const date = new Date().toISOString().split('T')[0];
    a.href = url; 
    a.download = `bibliomanager-export-${date}.csv`;
    document.body.appendChild(a); 
    a.click(); 
    a.remove();
    URL.revokeObjectURL(url);
    alert(`Export réussi: ${activeBooks.length} livre(s) exporté(s)`);
  }

  function exportToSQL() {
    const activeBooks = books.filter(b => !b.deleted);
    if (activeBooks.length === 0) {
      alert('Aucun livre à exporter');
      return;
    }

    let sql = `-- Export Bibliomanager - ${new Date().toISOString()}\n`;
    sql += `-- ${activeBooks.length} livre(s) exporté(s)\n\n`;
    sql += `DROP TABLE IF EXISTS books;\n`;
    sql += `CREATE TABLE books (\n`;
    sql += `  id INTEGER PRIMARY KEY,\n`;
    sql += `  epc TEXT NOT NULL,\n`;
    sql += `  title TEXT NOT NULL,\n`;
    sql += `  author TEXT NOT NULL,\n`;
    sql += `  read BOOLEAN DEFAULT 0,\n`;
    sql += `  createdAt INTEGER NOT NULL,\n`;
    sql += `  isbn TEXT,\n`;
    sql += `  barcode TEXT,\n`;
    sql += `  coverUrl TEXT\n`;
    sql += `);\n\n`;

    sql += `INSERT INTO books (id, epc, title, author, read, createdAt, isbn, barcode, coverUrl) VALUES\n`;
    const values = activeBooks.map(b => {
      const title = (b.title || '').replace(/'/g, "''");
      const author = (b.author || '').replace(/'/g, "''");
      const epc = (b.epc || '').replace(/'/g, "''");
      const isbn = b.isbn ? `'${b.isbn.replace(/'/g, "''")}'` : 'NULL';
      const barcode = b.barcode ? `'${b.barcode.replace(/'/g, "''")}'` : 'NULL';
      const coverUrl = b.coverUrl ? `'${b.coverUrl.replace(/'/g, "''")}'` : 'NULL';
      return `  (${b.id}, '${epc}', '${title}', '${author}', ${b.read ? 1 : 0}, ${b.createdAt}, ${isbn}, ${barcode}, ${coverUrl})`;
    });
    sql += values.join(',\n') + ';\n';

    const blob = new Blob([sql], { type: 'text/sql;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const date = new Date().toISOString().split('T')[0];
    a.href = url; 
    a.download = `bibliomanager-export-${date}.sql`;
    document.body.appendChild(a); 
    a.click(); 
    a.remove();
    URL.revokeObjectURL(url);
    alert(`Export SQL réussi: ${activeBooks.length} livre(s) exporté(s)`);
  }

  async function handleSQLFileImport(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const content = await file.text();
      await importFromSQL(content);
      event.target.value = ''; // Reset file input
    } catch (error: any) {
      alert('Erreur lors de la lecture du fichier: ' + (error?.message || 'Erreur inconnue'));
    }
  }

  async function importFromSQL(sqlContent: string) {
    if (!requireEdit()) { alert('Import désactivé en mode consultation.'); return; }
    if (!confirm('ATTENTION: Cette opération va remplacer complètement votre base de données actuelle. Êtes-vous sûr de vouloir continuer ?')) {
      return;
    }

    try {
      // Parser le contenu SQL pour extraire les données
      const insertMatch = sqlContent.match(/INSERT INTO books.*?VALUES\s*\n([\s\S]*?);/i);
      if (!insertMatch) {
        throw new Error('Format SQL invalide: aucune instruction INSERT trouvée');
      }

      const valuesContent = insertMatch[1];
      const lines = valuesContent.split(/,\s*\n/).map(line => line.trim());
      
      const newBooks: Book[] = [];
      let maxId = 0;

      for (const line of lines) {
        const match = line.match(/\(\s*(\d+),\s*'([^']*)',\s*'([^']*)',\s*'([^']*)',\s*(\d+),\s*(\d+),\s*(NULL|'[^']*'),\s*(NULL|'[^']*'),\s*(NULL|'[^']*')\s*\)$/);
        if (!match) continue;

        const id = parseInt(match[1]);
        const epc = match[2].replace(/''/g, "'");
        const title = match[3].replace(/''/g, "'");
        const author = match[4].replace(/''/g, "'");
        const read = match[5] === '1';
        const createdAt = parseInt(match[6]);
        const isbn = match[7] === 'NULL' ? undefined : match[7].slice(1, -1).replace(/''/g, "'");
        const barcode = match[8] === 'NULL' ? undefined : match[8].slice(1, -1).replace(/''/g, "'");
        const coverUrl = match[9] === 'NULL' ? undefined : match[9].slice(1, -1).replace(/''/g, "'");

        maxId = Math.max(maxId, id);
        
        newBooks.push({
          id,
          epc,
          title,
          author,
          read,
          createdAt,
          isbn,
          barcode,
          coverUrl
        });
      }

      if (newBooks.length === 0) {
        throw new Error('Aucune donnée valide trouvée dans le fichier SQL');
      }

      // Remplacer complètement la base de données
      setBooks(newBooks);
      
      // Forcer une synchronisation immédiate
      try {
        await syncToServer(true);
      } catch (error) {
        console.warn('Failed to sync after SQL import:', error);
      }

      alert(`Import SQL réussi: ${newBooks.length} livre(s) importé(s). La base de données a été complètement remplacée.`);
    } catch (error: any) {
      alert('Erreur lors de l\'import SQL: ' + (error?.message || 'Format de fichier invalide'));
    }
  }
  useEffect(() => {
    const sync = () => setRoute(window.location.pathname || '/');
    window.addEventListener('popstate', sync);
    sync();
    return () => window.removeEventListener('popstate', sync);
  }, []);
  // Rediriger toute visite à "/" vers "/livres/disponibles"
  useEffect(() => {
    if (route === '/') {
      navigate('/livres/disponibles');
    }
  }, [route]);
  // Limiter l'accès quand non connecté: autoriser seulement accueil, connexion, paramètres, livres disponibles
  useEffect(() => {
    if (me.username) return;
    const allowed = ['/', '/connexion', '/parametres', '/livres/disponibles'];
    if (!allowed.includes(route)) {
      navigate('/livres/disponibles');
    }
  }, [me.username, route]);
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
    // Essayer d'abord de pousser l'état au serveur
    if (navigator.onLine) {
      try { await syncToServer(true); } catch {}
      try { await fetch('/api/auth/logout', { method: 'POST' }); } catch {}
      setMe({ username: null, roles: ['guest'] });
      if (route !== '/livres/disponibles') navigate('/livres/disponibles');
      return;
    }
    // Hors ligne: stocker l'état pour envoi différé et marquer une déconnexion en attente
    savePendingSyncPayload();
    try { localStorage.setItem('bm2/pendingLogout', '1'); } catch {}
    // Lorsque l'appareil revient en ligne, on tentera d'envoyer, puis de déconnecter côté serveur
    window.addEventListener('online', tryFlushPendingSync, { once: true });
    // Déconnecter l'UI immédiatement
    setMe({ username: null, roles: ['guest'] });
    if (route !== '/livres/disponibles') navigate('/livres/disponibles');
  }

  // WebAuthn/Passkey functions

  // Usernameless WebAuthn authentication
  async function authenticateUsernameless() {
    if (!browserSupportsWebAuthn()) {
      throw new Error('WebAuthn non supporté par ce navigateur');
    }

    const beginRes = await fetch('/api/auth/webauthn/authenticate/usernameless/begin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });

    if (!beginRes.ok) {
      throw new Error('Impossible d\'initier l\'authentification sans nom d\'utilisateur');
    }

    const options = await beginRes.json();
    console.log('Usernameless auth options received:', options);

    let authResponse;
    try {
      authResponse = await startAuthentication({ optionsJSON: options.options });
    } catch (error: any) {
      console.error('Usernameless WebAuthn authentication error:', error);
      throw new Error(`Erreur lors de l'authentification: ${error.message || error}`);
    }

    console.log('Sending usernameless auth data:', {
      challengeKey: options.challengeKey,
      responseId: authResponse.id,
      response: authResponse
    });

    const finishRes = await fetch('/api/auth/webauthn/authenticate/usernameless/finish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        challengeKey: options.challengeKey,
        response: authResponse,
      }),
    });

    if (!finishRes.ok) {
      const errorData = await finishRes.json().catch(() => ({}));
      console.error('Usernameless auth finish error:', errorData);

      if (errorData.error === 'credential_not_found') {
        throw new Error(`Passkey introuvable. ID demandé: ${errorData.debug?.requestedId}, IDs disponibles: ${errorData.debug?.availableIds?.join(', ') || 'aucun'}`);
      } else if (errorData.error === 'verification_failed') {
        throw new Error(`Vérification échouée. Config: ${JSON.stringify(errorData.debug)}`);
      } else {
        throw new Error(`Erreur lors de la finalisation (${errorData.error || finishRes.status}): ${errorData.message || 'Erreur inconnue'}`);
      }
    }

    const result = await finishRes.json();
    console.log('Usernameless auth successful for:', result.username);

    // Update user state
    const meRes = await fetch('/api/auth/me', { cache: 'no-store' });
    const d = await meRes.json();
    setMe({ username: d?.user?.username || null, roles: Array.isArray(d.roles) ? d.roles : ['guest'] });
  }

  async function registerPasskey(name: string) {
    if (!browserSupportsWebAuthn()) {
      throw new Error('WebAuthn non supporté par ce navigateur');
    }

    if (!me.username) {
      throw new Error('Vous devez être connecté pour ajouter une clé d\'accès');
    }

    // Begin registration
    const beginRes = await fetch('/api/auth/webauthn/register/begin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });

    if (!beginRes.ok) {
      const errorData = await beginRes.json().catch(() => null);
      console.error('Registration begin failed:', beginRes.status, errorData);
      throw new Error(`Impossible d'initier l'enregistrement: ${errorData?.error || beginRes.status}`);
    }

    const options = await beginRes.json();
    console.log('Registration options received:', options);

    // Get registration response from browser
    let regResponse: RegistrationResponseJSON;
    try {
      console.log('Starting WebAuthn registration with options:', options.options);
      regResponse = await startRegistration({ optionsJSON: options.options });
      console.log('Registration response received:', regResponse);
    } catch (error: any) {
      console.error('WebAuthn registration error:', error);
      if (error.name === 'NotAllowedError') {
        throw new Error('Enregistrement annulé');
      }
      throw new Error(`Erreur lors de l'enregistrement WebAuthn: ${error.message}`);
    }

    // Finish registration
    const finishRes = await fetch('/api/auth/webauthn/register/finish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        challengeKey: options.challengeKey,
        name: options.name,
        response: regResponse,
      }),
    });

    if (!finishRes.ok) {
      const error = await finishRes.json().catch(() => null);
      console.error('Registration finish failed:', finishRes.status, error);
      throw new Error(`Échec de l'enregistrement: ${error?.error || error?.message || finishRes.status}`);
    }

    return await finishRes.json();
  }

  // Save WebAuthn configuration
  async function saveWebauthnConfig() {
    if (!isAdmin) return;

    setWebauthnConfigSaved('saving');
    try {
      const r = await fetch('/api/admin/webauthn-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(webauthnConfig),
      });

      if (r.ok) {
        setWebauthnConfigSaved('saved');
        setTimeout(() => setWebauthnConfigSaved('idle'), 2000);
      } else {
        setWebauthnConfigSaved('error');
        setTimeout(() => setWebauthnConfigSaved('idle'), 3000);
      }
    } catch {
      setWebauthnConfigSaved('error');
      setTimeout(() => setWebauthnConfigSaved('idle'), 3000);
    }
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

  function saveViewCache(state: { books: any[]; loans: any[] }) {
    try { localStorage.setItem('bm2/viewState', JSON.stringify(state)); } catch {}
  }
  // Persistence: load once (server first, fallback to public endpoint then cache)
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
              ...(b.labelPrinted !== undefined && { labelPrinted: b.labelPrinted }),
              ...(b.labelPrintedAt !== undefined && { labelPrintedAt: b.labelPrintedAt }),
            }));
            setBooks(migratedBooks);
            if (Array.isArray(d.loans)) setLoans(d.loans as Loan[]);
            saveViewCache({ books: d.books, loans: Array.isArray(d.loans) ? d.loans : [] });
            loaded = true;
          }
        } else if (r.status === 401) {
          // Try public, read-only state
          try {
            const rp = await fetch('/api/state/public');
            if (rp.ok) {
              const d = await rp.json();
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
                  ...(b.labelPrinted !== undefined && { labelPrinted: b.labelPrinted }),
                  ...(b.labelPrintedAt !== undefined && { labelPrintedAt: b.labelPrintedAt }),
                }));
                setBooks(migratedBooks);
                if (Array.isArray(d.loans)) setLoans(d.loans as Loan[]);
                saveViewCache({ books: d.books, loans: Array.isArray(d.loans) ? d.loans : [] });
                loaded = true;
              }
            }
          } catch {}
        }
      } catch {
        // ignore
      }
      if (!loaded) {
        try {
          const cacheRaw = localStorage.getItem('bm2/viewState');
          if (cacheRaw) {
            const d = JSON.parse(cacheRaw);
            const booksArr = Array.isArray(d?.books) ? d.books : [];
            const loansArr = Array.isArray(d?.loans) ? d.loans : [];
            const migrated: Book[] = booksArr.map((b: any) => ({
              id: typeof b.id === 'number' ? b.id : Date.now(),
              epc: typeof b.epc === 'string' && /^([0-9A-Fa-f]{24})$/.test(b.epc) ? String(b.epc).toUpperCase() : genEpc96(),
              title: String(b.title || ''),
              author: String(b.author || ''),
              read: !!b.read,
              createdAt: typeof b.createdAt === 'number' ? b.createdAt : Date.now(),
              isbn: b.isbn || undefined,
              barcode: b.barcode || undefined,
              coverUrl: b.coverUrl || undefined,
              ...(b.labelPrinted !== undefined && { labelPrinted: b.labelPrinted }),
              ...(b.labelPrintedAt !== undefined && { labelPrintedAt: b.labelPrintedAt }),
            }));
            setBooks(migrated);
            setLoans(Array.isArray(loansArr) ? loansArr : []);
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

  // Reload state when auth status changes
  useEffect(() => {
    (async () => {
      try {
        if (me.username) {
          // Si on vient de se (re)connecter, tenter de vider une sync en attente
          if (navigator.onLine) {
            await tryFlushPendingSync();
          } else {
            window.addEventListener('online', tryFlushPendingSync, { once: true });
          }
          const r = await fetch('/api/state', { cache: 'no-store' });
          if (r.ok) {
            const d = await r.json();
            if (d && Array.isArray(d.books)) {
              setBooks((d.books as any[]).map((b: any) => ({
                id: typeof b.id === 'number' ? b.id : Date.now(),
                epc: typeof b.epc === 'string' && /^([0-9A-Fa-f]{24})$/.test(b.epc) ? String(b.epc).toUpperCase() : genEpc96(),
                title: String(b.title || ''),
                author: String(b.author || ''),
                read: !!b.read,
                createdAt: typeof b.createdAt === 'number' ? b.createdAt : Date.now(),
                isbn: b.isbn || undefined,
                barcode: b.barcode || undefined,
                coverUrl: b.coverUrl || undefined,
                ...(b.labelPrinted !== undefined && { labelPrinted: b.labelPrinted }),
                ...(b.labelPrintedAt !== undefined && { labelPrintedAt: b.labelPrintedAt }),
              })));
              if (Array.isArray(d.loans)) setLoans(d.loans as Loan[]);
              saveViewCache({ books: d.books, loans: Array.isArray(d.loans) ? d.loans : [] });
            }
          }
        } else {
          // Logged out -> try public state
          const rp = await fetch('/api/state/public', { cache: 'no-store' });
          if (rp.ok) {
            const d = await rp.json();
            if (d && Array.isArray(d.books)) {
              setBooks((d.books as any[]).map((b: any) => ({
                id: typeof b.id === 'number' ? b.id : Date.now(),
                epc: typeof b.epc === 'string' && /^([0-9A-Fa-f]{24})$/.test(b.epc) ? String(b.epc).toUpperCase() : genEpc96(),
                title: String(b.title || ''),
                author: String(b.author || ''),
                read: !!b.read,
                createdAt: typeof b.createdAt === 'number' ? b.createdAt : Date.now(),
                isbn: b.isbn || undefined,
                barcode: b.barcode || undefined,
                coverUrl: b.coverUrl || undefined,
                ...(b.labelPrinted !== undefined && { labelPrinted: b.labelPrinted }),
                ...(b.labelPrintedAt !== undefined && { labelPrintedAt: b.labelPrintedAt }),
              })));
              if (Array.isArray(d.loans)) setLoans(d.loans as Loan[]);
              saveViewCache({ books: d.books, loans: Array.isArray(d.loans) ? d.loans : [] });
            }
          }
        }
      } catch {
        // ignore
      }
    })();
  }, [me.username]);

  // Ne plus persister les modifications en local; la cache de visualisation est écrite après un fetch serveur.

  // Server sync function
  const syncToServer = async (immediate = false) => {
    if (!navigator.onLine) { throw new Error('offline'); }
    if (!immediate) setSyncStatus('syncing');
    try {
      const response = await fetch('/api/state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ books, loans }),
      });
      if (response.ok) {
        if (!immediate) setSyncStatus('success');
      } else if (response.status === 401) {
        // Pas de session : on enregistre une sync en attente que l'on poussera à la reconnexion utilisateur
        savePendingSyncPayload();
        if (!immediate) setSyncStatus('error');
      } else {
        if (!immediate) {
          setSyncStatus('error');
          console.warn('Server sync failed, data saved locally only');
        }
      }
    } catch (error) {
      // Hors ligne: persister la sync en attente
      savePendingSyncPayload();
      if (!immediate) {
        setSyncStatus('error');
        console.warn('Server sync failed, data saved locally only:', error);
      }
    }
    
    // Reset status after delay
    if (!immediate) {
      setTimeout(() => setSyncStatus('idle'), 2000);
    }
  };

  // Server sync (debounced for normal changes)
  useEffect(() => {
    const t = setTimeout(() => {
      syncToServer(false);
    }, 500);
    return () => clearTimeout(t);
  }, [books, loans]);

  // Immediate sync before page unload to prevent data loss
  useEffect(() => {
    const handleBeforeUnload = () => {
      // Use sendBeacon for reliable sync during page unload
      if (navigator.sendBeacon && books.length > 0) {
        try {
          const payload = JSON.stringify({ books, loans });
          const blob = new Blob([payload], { type: 'application/json' });
          navigator.sendBeacon('/api/state', blob);
        } catch {}
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [books, loans]);

  function addBook() {
    if (!requireEdit()) return;
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
    if (!requireEdit()) return;
    const book = books.find(b => b.id === id);
    const bookTitle = book ? book.title : 'ce livre';
    
    if (!confirm(`Êtes-vous sûr de vouloir mettre "${bookTitle}" à la corbeille ?`)) {
      return;
    }
    
    setBooks((prev) => prev.map((b) => 
      b.id === id ? { ...b, deleted: true, deletedAt: Date.now() } : b
    ));
  }

  function restoreBook(id: number) {
    if (!requireEdit()) return;
    setBooks((prev) => prev.map((b) => 
      b.id === id ? { ...b, deleted: false, deletedAt: undefined } : b
    ));
  }

  function permanentDeleteBook(id: number) {
    if (!requireEdit()) return;
    const book = books.find(b => b.id === id);
    const bookTitle = book ? book.title : 'ce livre';
    
    if (!confirm(`Êtes-vous sûr de vouloir supprimer définitivement "${bookTitle}" ? Cette action est irréversible.`)) {
      return;
    }
    
    setBooks((prev) => prev.filter((b) => b.id !== id));
  }

  function saveBookEdit(id: number, patch: Partial<Book>) {
    if (!requireEdit()) return;
    setBooks((prev) =>
      prev.map((b) => {
        if (b.id !== id) return b;
        const next: Book = { ...b, ...patch } as Book;
        if (Object.prototype.hasOwnProperty.call(patch, 'isbn')) {
          const clean = (patch.isbn || '').replace(/[^0-9Xx]/g, '').toUpperCase();
          next.isbn = clean || undefined;
          // Ne pas écraser coverUrl si on a une image personnalisée (base64)
          if (!Object.prototype.hasOwnProperty.call(patch, 'coverUrl')) {
            next.coverUrl = clean ? `/covers/isbn/${clean}?s=M` : next.coverUrl;
          }
        }
        return next;
      }),
    );
    setEditingBookId(null);
  }

  function updateBookData(id: number, patch: Partial<Book>) {
    setBooks((prev) =>
      prev.map((b) => {
        if (b.id !== id) return b;
        const next: Book = { ...b, ...patch } as Book;
        if (Object.prototype.hasOwnProperty.call(patch, 'isbn')) {
          const clean = (patch.isbn || '').replace(/[^0-9Xx]/g, '').toUpperCase();
          next.isbn = clean || undefined;
          // Ne pas écraser coverUrl si on a une image personnalisée (base64)
          if (!Object.prototype.hasOwnProperty.call(patch, 'coverUrl')) {
            next.coverUrl = clean ? `/covers/isbn/${clean}?s=M` : next.coverUrl;
          }
        }
        return next;
      }),
    );
  }

  function toggleRead(id: number) {
    if (!requireEdit()) return;
    setBooks((prev) => prev.map((b) => (b.id === id ? { ...b, read: !b.read } : b)));
  }

  const stats = useMemo(() => {
    const activeBooks = books.filter((b) => !b.deleted);
    const total = activeBooks.length;
    const read = activeBooks.filter((b) => b.read).length;
    return { total, read, unread: total - read };
  }, [books]);

  const visibleBooks = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = books.filter((b) => {
      const matchesQuery = q === '' || b.title.toLowerCase().includes(q) || b.author.toLowerCase().includes(q);
      const matchesStatus =
        statusFilter === 'all' ? true :
        statusFilter === 'read' ? b.read :
        statusFilter === 'unread' ? !b.read :
        statusFilter === 'unprinted' ? !b.labelPrinted :
        statusFilter === 'printed' ? !!b.labelPrinted :
        true;
      const notDeleted = !b.deleted;
      return matchesQuery && matchesStatus && notDeleted;
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
          <mark key={start} style={{ background: 'var(--warn-bg)', padding: 0 }}>{matched}</mark>
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

  // Fonctions pour capture photo de couverture
  async function startCoverCapture(bookId: number) {
    setScanningCoverForBookId(bookId);
    
    try {
      await refreshCameraDevices();
    } catch (error) {
      setScanError('Erreur lors de l\'ouverture de la caméra');
    }
  }

  async function stopCoverCapture() {
    setScanningCoverForBookId(null);
    await stopCoverCameraStream();
  }

  // Démarrer le flux caméra pour capture de couverture (sans scan de code-barres)
  async function startCoverCameraStream() {
    try {
      setScanError(null);
      const constraints: MediaStreamConstraints = {
        video: selectedCameraId ? { deviceId: { exact: selectedCameraId } } : { facingMode: 'environment' },
        audio: false,
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
      setIsScanning(true);
    } catch (e: any) {
      setScanError(e?.message || 'Impossible de démarrer la caméra');
    }
  }

  // Arrêter le flux caméra
  async function stopCoverCameraStream() {
    setIsScanning(false);
    if (videoRef.current) {
      try { videoRef.current.pause(); } catch {}
      videoRef.current.srcObject = null;
    }
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) track.stop();
      streamRef.current = null;
    }
  }

  // Capturer une photo de la couverture
  function captureBookCover() {
    if (!videoRef.current || !scanningCoverForBookId) return;
    
    const video = videoRef.current;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Définir la taille du canvas (ratio couverture de livre ~2:3)
    canvas.width = 400;
    canvas.height = 600;
    
    // Dessiner la vidéo sur le canvas
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    
    // Convertir en base64
    const imageData = canvas.toDataURL('image/jpeg', 0.8);
    console.log('Image captured, size:', imageData.length, 'bookId:', scanningCoverForBookId);
    
    // Mettre à jour le livre avec l'image capturée (sans fermer le mode édition)
    updateBookData(scanningCoverForBookId, { coverUrl: imageData });
    
    // Fermer le modal
    stopCoverCapture();
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
    if (!requireEdit()) return;
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
    if (!requireEdit()) return;
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
    if (!requireEdit()) return;
    const today = new Date().toISOString().slice(0, 10);
    setLoans((prev) => prev.map((l) => (l.id === id ? { ...l, returnedAt: today } : l)));
  }
  function deleteLoan(id: number) {
    if (!requireEdit()) return;
    setLoans((prev) => prev.filter((x) => x.id !== id));
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
                      border: '1px solid var(--success)',
                      background: 'var(--success)',
                      color: 'white',
                      cursor: 'pointer',
                    }}
                  >
                    Marquer comme rendu
                  </button>
                )}
                <button
                  onClick={() => deleteLoan(l.id)}
                  style={{
                    padding: '8px 10px',
                    borderRadius: 6,
                    border: '1px solid var(--danger)',
                    background: 'var(--danger)',
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

  function PasskeyManagement() {
    const [passkeys, setPasskeys] = useState<Array<{ id: string; name: string; createdAt: number; credentialDeviceType: string; credentialBackedUp: boolean }>>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [newPasskeyName, setNewPasskeyName] = useState('');
    const [registering, setRegistering] = useState(false);
    const supportsWebAuthn = browserSupportsWebAuthn();

    const loadPasskeys = async () => {
      if (!me.username) return;
      try {
        setLoading(true);
        const res = await fetch('/api/passkeys');
        if (res.ok) {
          const data = await res.json();
          setPasskeys(data.passkeys || []);
        } else {
          setError('Impossible de charger les clés d\'accès');
        }
      } catch (e: any) {
        setError('Erreur lors du chargement');
      } finally {
        setLoading(false);
      }
    };

    useEffect(() => {
      if (me.username) {
        loadPasskeys();
      }
    }, [me.username]);

    const handleRegisterPasskey = async () => {
      const name = newPasskeyName.trim() || 'Nouvelle clé d\'accès';
      setRegistering(true);
      setError(null);
      
      try {
        await registerPasskey(name);
        setNewPasskeyName('');
        await loadPasskeys();
      } catch (e: any) {
        setError(e?.message || 'Erreur lors de l\'enregistrement');
      } finally {
        setRegistering(false);
      }
    };

    const handleDeletePasskey = async (id: string, name: string) => {
      if (!confirm(`Supprimer la clé d'accès "${name}" ?`)) return;
      
      try {
        const res = await fetch(`/api/passkeys/${encodeURIComponent(id)}`, { method: 'DELETE' });
        if (res.ok) {
          setPasskeys(prev => prev.filter(p => p.id !== id));
        } else {
          setError('Erreur lors de la suppression');
        }
      } catch (e: any) {
        setError('Erreur lors de la suppression');
      }
    };

    const handleRenamePasskey = async (id: string, oldName: string) => {
      const newName = prompt('Nouveau nom pour cette clé d\'accès:', oldName);
      if (!newName || newName.trim() === oldName) return;
      
      try {
        const res = await fetch(`/api/passkeys/${encodeURIComponent(id)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: newName.trim() }),
        });
        
        if (res.ok) {
          setPasskeys(prev => prev.map(p => p.id === id ? { ...p, name: newName.trim() } : p));
        } else {
          setError('Erreur lors du renommage');
        }
      } catch (e: any) {
        setError('Erreur lors du renommage');
      }
    };

    if (!me.username) return null;

    return (
      <div>
        <div className="panel-title" style={{ fontWeight: 700, marginBottom: 6 }}>
          Clés d'accès (Passkeys) 🔐
        </div>
        
        {!supportsWebAuthn && (
          <div style={{
            padding: '12px 16px',
            background: 'var(--warn-bg)',
            border: '1px solid var(--warn-text)',
            borderRadius: 8,
            color: 'var(--warn-text)',
            marginBottom: 16
          }}>
            ⚠️ WebAuthn n'est pas supporté par ce navigateur
          </div>
        )}

        {error && (
          <div style={{
            padding: '12px 16px',
            background: 'var(--warn-bg)',
            border: '1px solid var(--danger)',
            borderRadius: 8,
            color: 'var(--danger)',
            marginBottom: 16
          }}>
            {error}
          </div>
        )}

        <div style={{ display: 'grid', gap: 16 }}>
          {supportsWebAuthn && (
            <div>
              <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 14 }}>
                Ajouter une nouvelle clé d'accès
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <input
                  placeholder="Nom de la clé (ex: iPhone, Yubikey...)"
                  value={newPasskeyName}
                  onChange={(e) => setNewPasskeyName(e.target.value)}
                  style={{
                    padding: '10px 12px',
                    borderRadius: 6,
                    border: '1px solid var(--border)',
                    minWidth: 300
                  }}
                />
                <button
                  type="button"
                  disabled={registering}
                  onClick={handleRegisterPasskey}
                  style={{
                    padding: '10px 16px',
                    borderRadius: 6,
                    border: '1px solid var(--success)',
                    background: registering ? 'var(--muted-2)' : 'var(--success)',
                    color: 'white',
                    fontWeight: 500,
                    cursor: registering ? 'not-allowed' : 'pointer'
                  }}
                >
                  {registering ? 'Enregistrement...' : '+ Ajouter'}
                </button>
              </div>
            </div>
          )}

          <div>
            <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 14 }}>
              Mes clés d'accès ({passkeys.length})
            </div>
            
            {loading ? (
              <div style={{ color: 'var(--muted)', padding: 16, textAlign: 'center' }}>
                Chargement...
              </div>
            ) : passkeys.length === 0 ? (
              <div style={{ color: 'var(--muted)', padding: 16, textAlign: 'center' }}>
                Aucune clé d'accès configurée
              </div>
            ) : (
              <div style={{ display: 'grid', gap: 8 }}>
                {passkeys.map((passkey) => (
                  <div
                    key={passkey.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 12,
                      padding: '12px 16px',
                      border: '1px solid var(--border)',
                      borderRadius: 8,
                      background: 'var(--card)'
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, marginBottom: 2 }}>
                        {passkey.name}
                      </div>
                      <div style={{ color: 'var(--muted-2)', fontSize: 12 }}>
                        Créée le {new Date(passkey.createdAt).toLocaleString()} •{' '}
                        {passkey.credentialDeviceType === 'multiDevice' ? 'Multi-appareils' : 'Appareil unique'} •{' '}
                        {passkey.credentialBackedUp ? 'Sauvegardée' : 'Non sauvegardée'}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        type="button"
                        onClick={() => handleRenamePasskey(passkey.id, passkey.name)}
                        style={{
                          padding: '6px 10px',
                          borderRadius: 6,
                          border: '1px solid var(--border)',
                          background: 'var(--btn-secondary-bg)',
                          fontSize: 12
                        }}
                      >
                        ✏️ Renommer
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeletePasskey(passkey.id, passkey.name)}
                        style={{
                          padding: '6px 10px',
                          borderRadius: 6,
                          border: '1px solid var(--danger)',
                          background: 'var(--danger)',
                          color: 'white',
                          fontSize: 12
                        }}
                      >
                        🗑️ Supprimer
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        
        <div style={{ color: 'var(--muted)', fontSize: 13, marginTop: 12 }}>
          Les clés d'accès permettent une authentification sécurisée sans mot de passe en utilisant 
          votre empreinte digitale, Face ID, ou une clé de sécurité physique.
        </div>
      </div>
    );
  }

  function LoginForm({ onSubmit }: { onSubmit: (u: string, p: string) => Promise<void> }) {
    const [u, setU] = useState('');
    const [p, setP] = useState('');
    const [err, setErr] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [usernamelessLoading, setUsernamelessLoading] = useState(false);
    const supportsWebAuthn = browserSupportsWebAuthn();

    const handleUsernamelessLogin = async () => {
      setErr(null);
      setUsernamelessLoading(true);
      try {
        await authenticateUsernameless();
        navigate('/livres/disponibles');
      } catch (e: any) {
        setErr(e?.message || 'Erreur d\'authentification sans nom d\'utilisateur');
      } finally {
        setUsernamelessLoading(false);
      }
    };


    return (
      <form 
        onSubmit={async (e) => { 
          e.preventDefault(); 
          setErr(null); 
          setLoading(true); 
          try { 
            await onSubmit(u, p); 
          } catch (e: any) { 
            setErr(e?.message || 'Erreur de connexion'); 
          } finally { 
            setLoading(false); 
          } 
        }} 
        style={{ display: 'grid', gap: 20 }}
      >
        {supportsWebAuthn && (
          <>
            <button
              type="button"
              disabled={usernamelessLoading || loading}
              onClick={handleUsernamelessLogin}
              style={{
                padding: '16px 20px',
                borderRadius: 8,
                width: '100%',
                border: '2px solid var(--accent)',
                background: usernamelessLoading || loading ? 'var(--muted-2)' : 'var(--accent)',
                color: 'white',
                fontSize: 16,
                fontWeight: 600,
                cursor: usernamelessLoading || loading ? 'not-allowed' : 'pointer',
                transition: 'all 0.2s ease',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px'
              }}
            >
              <span style={{ fontSize: '20px' }}>🔑</span>
              {usernamelessLoading ? 'Authentification...' : 'Se connecter avec passkey'}
            </button>
            {/* Séparateur sous le bouton passkey */}
            <div style={{
              textAlign: 'center',
              color: 'var(--muted)',
              fontSize: 14,
              position: 'relative',
              margin: '10px 0'
            }}>
              <div style={{
                position: 'absolute',
                top: '50%',
                left: 0,
                right: 0,
                height: '1px',
                background: 'var(--border)'
              }} />
              <span style={{
                background: 'var(--panel)',
                padding: '0 15px',
                position: 'relative',
                zIndex: 1
              }}>
                ou
              </span>
            </div>
          </>
        )}
        <div>
          <label style={{ display: 'block', marginBottom: 8, fontWeight: 500, color: 'var(--text)' }}>
            Nom d'utilisateur
          </label>
          <input 
            aria-label="Nom d'utilisateur" 
            value={u} 
            onChange={(e) => setU(e.target.value)} 
            style={{ 
              width: '100%',
              padding: '12px 16px', 
              borderRadius: 8, 
              border: '1px solid var(--border)', 
              background: 'var(--panel)',
              fontSize: 16,
              outline: 'none',
              transition: 'border-color 0.2s ease',
              boxSizing: 'border-box'
            }} 
            onFocus={(e) => e.target.style.borderColor = 'var(--accent)'}
            onBlur={(e) => e.target.style.borderColor = 'var(--border)'}
          />
        </div>
        <div>
          <label style={{ display: 'block', marginBottom: 8, fontWeight: 500, color: 'var(--text)' }}>
            Mot de passe
          </label>
          <input 
            aria-label="Mot de passe" 
            type="password" 
            value={p} 
            onChange={(e) => setP(e.target.value)} 
            style={{ 
              width: '100%',
              padding: '12px 16px', 
              borderRadius: 8, 
              border: '1px solid var(--border)', 
              background: 'var(--panel)',
              fontSize: 16,
              outline: 'none',
              transition: 'border-color 0.2s ease',
              boxSizing: 'border-box'
            }}
            onFocus={(e) => e.target.style.borderColor = 'var(--accent)'}
            onBlur={(e) => e.target.style.borderColor = 'var(--border)'}
          />
        </div>
        {err && (
          <div style={{ 
            color: 'var(--danger)', 
            fontSize: 14, 
            padding: '10px 16px',
            background: 'var(--warn-bg)',
            border: '1px solid var(--danger)',
            borderRadius: 8,
            textAlign: 'center'
          }}>
            {err}
          </div>
        )}
        {/* Séparateur au-dessus du bouton mot de passe supprimé */}
        <button 
          type="submit" 
          disabled={loading || !u || !p} 
          style={{ 
            padding: '14px 20px', 
            borderRadius: 8, 
            width: '100%', 
            border: '1px solid var(--accent)', 
            background: loading || !u || !p ? 'var(--accent-weak)' : 'var(--accent)', 
            color: 'white',
            fontSize: 16,
            fontWeight: 600,
            cursor: loading || !u || !p ? 'not-allowed' : 'pointer',
            transition: 'all 0.2s ease'
          }}
        >
          {loading ? 'Connexion en cours…' : 'Se connecter avec mot de passe'}
        </button>
      </form>
    );
  }

  function AdminPasskeyManagement() {
    const [allPasskeys, setAllPasskeys] = useState<Array<{ id: string; username: string; name: string; createdAt: number; credentialDeviceType: string; credentialBackedUp: boolean }>>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const loadAllPasskeys = async () => {
      try {
        setLoading(true);
        const res = await fetch('/api/admin/passkeys');
        if (res.ok) {
          const data = await res.json();
          setAllPasskeys(data.passkeys || []);
        } else {
          setError('Impossible de charger les clés d\'accès');
        }
      } catch (e: any) {
        setError('Erreur lors du chargement');
      } finally {
        setLoading(false);
      }
    };

    useEffect(() => {
      loadAllPasskeys();
    }, []);

    const handleDeletePasskey = async (id: string, username: string, name: string) => {
      if (!confirm(`Supprimer la clé d'accès "${name}" de l'utilisateur ${username} ?`)) return;
      
      try {
        const res = await fetch(`/api/admin/passkeys/${encodeURIComponent(id)}`, { method: 'DELETE' });
        if (res.ok) {
          setAllPasskeys(prev => prev.filter(p => p.id !== id));
        } else {
          setError('Erreur lors de la suppression');
        }
      } catch (e: any) {
        setError('Erreur lors de la suppression');
      }
    };

    const handleDeleteAllUserPasskeys = async (username: string) => {
      const userPasskeys = allPasskeys.filter(p => p.username === username);
      if (userPasskeys.length === 0) return;
      
      if (!confirm(`Supprimer toutes les clés d'accès (${userPasskeys.length}) de l'utilisateur ${username} ?`)) return;
      
      try {
        const res = await fetch(`/api/admin/passkeys/user/${encodeURIComponent(username)}`, { method: 'DELETE' });
        if (res.ok) {
          const result = await res.json();
          setAllPasskeys(prev => prev.filter(p => p.username !== username));
          alert(`${result.deleted || userPasskeys.length} clé(s) d'accès supprimée(s)`);
        } else {
          setError('Erreur lors de la suppression');
        }
      } catch (e: any) {
        setError('Erreur lors de la suppression');
      }
    };

    return (
      <div>
        <div className="panel-title" style={{ fontWeight: 700, marginBottom: 6 }}>
          Administration des clés d'accès 🔐
        </div>
        
        {error && (
          <div style={{
            padding: '12px 16px',
            background: 'var(--warn-bg)',
            border: '1px solid var(--danger)',
            borderRadius: 8,
            color: 'var(--danger)',
            marginBottom: 16
          }}>
            {error}
          </div>
        )}

        {loading ? (
          <div style={{ color: 'var(--muted)', padding: 16, textAlign: 'center' }}>
            Chargement...
          </div>
        ) : (
          <div>
            <div style={{ marginBottom: 16, color: 'var(--muted)', fontSize: 14 }}>
              Total: {allPasskeys.length} clé(s) d'accès pour {new Set(allPasskeys.map(p => p.username)).size} utilisateur(s)
            </div>
            
            {allPasskeys.length === 0 ? (
              <div style={{ color: 'var(--muted)', padding: 16, textAlign: 'center' }}>
                Aucune clé d'accès configurée
              </div>
            ) : (
              <div style={{ display: 'grid', gap: 12 }}>
                {Object.entries(
                  allPasskeys.reduce((acc, passkey) => {
                    if (!acc[passkey.username]) acc[passkey.username] = [];
                    acc[passkey.username].push(passkey);
                    return acc;
                  }, {} as Record<string, typeof allPasskeys>)
                ).map(([username, userPasskeys]) => (
                  <div
                    key={username}
                    style={{
                      border: '1px solid var(--border)',
                      borderRadius: 8,
                      padding: '12px 16px',
                      background: 'var(--card)'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 16 }}>
                          {username}
                        </div>
                        <div style={{ color: 'var(--muted-2)', fontSize: 12 }}>
                          {userPasskeys.length} clé(s) d'accès
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleDeleteAllUserPasskeys(username)}
                        disabled={userPasskeys.length === 0}
                        style={{
                          padding: '6px 12px',
                          borderRadius: 6,
                          border: '1px solid var(--danger)',
                          background: userPasskeys.length === 0 ? 'var(--muted-2)' : 'var(--danger)',
                          color: 'white',
                          fontSize: 12,
                          fontWeight: 500,
                          cursor: userPasskeys.length === 0 ? 'not-allowed' : 'pointer'
                        }}
                      >
                        🗑️ Tout supprimer
                      </button>
                    </div>
                    
                    <div style={{ display: 'grid', gap: 6 }}>
                      {userPasskeys.map((passkey) => (
                        <div
                          key={passkey.id}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: 12,
                            padding: '8px 12px',
                            border: '1px solid var(--border)',
                            borderRadius: 6,
                            background: 'var(--panel)',
                            fontSize: 14
                          }}
                        >
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontWeight: 500, marginBottom: 2 }}>
                              {passkey.name}
                            </div>
                            <div style={{ color: 'var(--muted-2)', fontSize: 11 }}>
                              Créée le {new Date(passkey.createdAt).toLocaleString()} •{' '}
                              {passkey.credentialDeviceType === 'multiDevice' ? 'Multi-appareils' : 'Appareil unique'} •{' '}
                              {passkey.credentialBackedUp ? 'Sauvegardée' : 'Non sauvegardée'}
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleDeletePasskey(passkey.id, passkey.username, passkey.name)}
                            style={{
                              padding: '4px 8px',
                              borderRadius: 4,
                              border: '1px solid var(--danger)',
                              background: 'var(--danger)',
                              color: 'white',
                              fontSize: 11
                            }}
                          >
                            🗑️ Supprimer
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
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
        {loading ? <div>Chargement…</div> : error ? <div style={{ color: 'var(--overdue-text)' }}>{error}</div> : (
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
            
            <AdminPasskeyManagement />
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

  async function importAllToLibrary() {
    if (!requireEdit()) { alert('Import désactivé en mode consultation.'); return; }
    console.log('importAllToLibrary called', { importItems });
    const okItems = importItems.filter((it) => it.status === 'ok');
    console.log('okItems found:', okItems.length, okItems);
    if (okItems.length === 0) {
      alert('Aucun livre en statut OK à importer. Vérifiez que les lignes sont marquées OK (ou éditez les "Introuvable" puis cliquez sur « Marquer comme prêt »).');
      return;
    }
    
    // Calculer les IDs en dehors du callback setBooks
    const addedIds: number[] = [];
    const existingMatchIds: number[] = [];
    const existsByIsbn = new Set(books.map((b) => (b.isbn || '').toUpperCase()).filter(Boolean));
    const existsByBarcode = new Set(books.map((b) => (b.barcode || '')).filter(Boolean));
    const toAdd: Book[] = [];
    
    for (const it of okItems) {
      const isbnUp = (it.isbn || '').toUpperCase();
      console.log('Processing item:', it, 'isbnUp:', isbnUp);
      
      if ((isbnUp && existsByIsbn.has(isbnUp)) || (it.barcode && existsByBarcode.has(it.barcode))) {
        console.log('Skipping duplicate:', it);
        // Trouver l'ID du livre existant pour le popup
        const existingBook = books.find(b => 
          (isbnUp && (b.isbn || '').toUpperCase() === isbnUp) ||
          (it.barcode && b.barcode === it.barcode)
        );
        console.log('Found existing book for duplicate:', existingBook);
        if (existingBook) {
          existingMatchIds.push(existingBook.id);
          console.log('Added existing book ID to existingMatchIds:', existingBook.id);
        } else {
          console.log('ERROR: No existing book found but duplicate detected!');
        }
        continue;
      }
      
      const coverUrl = isbnUp ? `/covers/isbn/${isbnUp}?s=M` : undefined;
      const newBook: Book = {
        id: Date.now() + Math.floor(Math.random() * 1000),
        epc: genEpc96(),
        title: it.title || '(Sans titre)',
        author: it.author || '(Auteur inconnu)',
        read: false,
        createdAt: Date.now(),
        isbn: isbnUp || undefined,
        barcode: it.barcode,
        coverUrl,
      };
      
      toAdd.push(newBook);
      addedIds.push(newBook.id);
      if (isbnUp) existsByIsbn.add(isbnUp);
      if (it.barcode) existsByBarcode.add(it.barcode);
    }
    
    console.log('Books will be added:', toAdd.length, 'addedIds:', addedIds);
    console.log('Existing matches found:', existingMatchIds.length, 'existingMatchIds:', existingMatchIds);
    
    // Ouvrir le popup pour nouveaux livres OU livres existants (doublons)
    const allRelevantIds = [...addedIds, ...existingMatchIds];
    console.log('All relevant IDs for popup:', allRelevantIds, 'added:', addedIds, 'existing:', existingMatchIds);
    
    // Ajouter les nouveaux livres
    if (toAdd.length > 0) {
      setBooks((prev) => [...toAdd, ...prev]);
    }
    
    setImportItems((prev) => prev.filter((it) => it.status !== 'ok'));
    
    // Force immediate sync after import to prevent data loss
    if (toAdd.length > 0) {
      try {
        await syncToServer(true);
      } catch (error) {
        console.warn('Failed to sync after import:', error);
      }
    }

    if (allRelevantIds.length > 0) {
      console.log('Opening print modal for', allRelevantIds.length, 'books');
      setLastImportedIds(addedIds); // Pour le bandeau, utiliser seulement les nouveaux
      setPrintModalBooks(allRelevantIds); // Pour le popup, utiliser tous
      setSelectedForBatchPrint(new Set(allRelevantIds));
      try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch {}
      setShowPrintModal(true);
      console.log('Print modal opened with IDs:', allRelevantIds);
    } else {
      console.log('No books found for popup');
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

      // Marquer les livres comme imprimés après impression réussie
      await markBooksAsPrinted(ids);
      alert(items.length + (items.length > 1 ? " étiquettes envoyées à l'imprimante." : " étiquette envoyée à l'imprimante."));
    } catch (e: any) { alert('Erreur impression ZPL: ' + (e?.message || 'inconnue')); }
  }

  // Fonctions pour le popup d'impression en masse
  function executeBatchPrint() {
    const selectedIds = Array.from(selectedForBatchPrint);
    if (selectedIds.length === 0) {
      alert('Sélectionnez au moins un livre à imprimer.');
      return;
    }
    
    if (printerHost) {
      // Impression réseau si configurée
      printBatchZplNetwork(selectedIds);
    } else if (agentAvailable) {
      // Sinon via agent local si dispo
      printBatchViaLocalAgent(selectedIds);
    } else {
      alert("Aucune imprimante réseau configurée et agent local indisponible. Réglez l'imprimante dans Paramètres ou lancez l'agent local.");
      return;
    }
    
    setShowPrintModal(false);
  }

  function closePrintModal() {
    setShowPrintModal(false);
    setPrintModalBooks([]);
    setSelectedForBatchPrint(new Set());
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
          <h1
            onClick={() => navigate('/livres/disponibles')}
            role="link"
            tabIndex={0}
            title="Aller aux livres disponibles"
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') navigate('/livres/disponibles'); }}
            style={{ margin: 0, cursor: 'pointer', userSelect: 'none' }}
          >
            Bibliomanager
          </h1>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {syncStatus !== 'idle' && (
          <div 
            style={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: 6, 
              padding: '4px 8px', 
              borderRadius: 12, 
              fontSize: 12,
              fontWeight: 500,
              background: syncStatus === 'syncing' ? 'var(--accent-weak)' : 
                         syncStatus === 'success' ? 'var(--chip-ok-bg)' : 'var(--chip-bad-bg)',
              color: syncStatus === 'syncing' ? 'var(--accent)' : 
                     syncStatus === 'success' ? 'var(--chip-ok-text)' : 'var(--chip-bad-text)',
              border: '1px solid ' + (syncStatus === 'syncing' ? 'var(--accent)' : 
                                     syncStatus === 'success' ? 'var(--chip-ok-border)' : 'var(--chip-bad-border)')
            }}
            title={syncStatus === 'syncing' ? 'Synchronisation en cours...' : 
                   syncStatus === 'success' ? 'Données sauvegardées' : 'Erreur de synchronisation'}
          >
            {syncStatus === 'syncing' ? '⏳' : syncStatus === 'success' ? '✓' : '⚠️'}
            {syncStatus === 'syncing' ? 'Sync...' : syncStatus === 'success' ? 'Sauvé' : 'Erreur'}
          </div>
        )}
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

      {me.username && !isOnline && (
        <div style={{
          margin: '8px 0',
          padding: '8px 12px',
          borderRadius: 8,
          border: '1px solid var(--warn-text)',
          background: 'var(--warn-bg)',
          color: 'var(--warn-text)'
        }}>
          Mode hors ligne: modifications désactivées (consultation uniquement)
        </div>
      )}

      {route !== '/' && me.username && (
        <nav className={`main-nav${navOpen ? ' is-open' : ''}`} aria-label="Navigation principale" style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {[
            { to: '/livres/disponibles', label: 'Livres disponibles', show: true },
            { to: '/livres/nouveau', label: 'Gestion des livres', show: canImport },
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

      {/* Page d'accueil supprimée: redirection automatique vers /livres/disponibles */}

      {route === '/parametres' && (
        <section style={{ padding: 16, border: '1px solid var(--border)', borderRadius: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
            <h2 style={{ margin: 0 }}>Paramètres</h2>
            <div style={{ display: 'flex', gap: 4, background: 'var(--panel)', borderRadius: 8, padding: 4 }}>
              <button
                type="button"
                onClick={() => setShowAdvancedSettings(false)}
                style={{
                  padding: '8px 16px',
                  borderRadius: 4,
                  border: 'none',
                  background: !showAdvancedSettings ? 'var(--accent)' : 'transparent',
                  color: !showAdvancedSettings ? 'white' : 'var(--text)',
                  cursor: 'pointer',
                  fontSize: 14,
                  fontWeight: 500
                }}
              >
                Simple
              </button>
              <button
                type="button"
                onClick={() => setShowAdvancedSettings(true)}
                style={{
                  padding: '8px 16px',
                  borderRadius: 4,
                  border: 'none',
                  background: showAdvancedSettings ? 'var(--accent)' : 'transparent',
                  color: showAdvancedSettings ? 'white' : 'var(--text)',
                  cursor: 'pointer',
                  fontSize: 14,
                  fontWeight: 500
                }}
              >
                Avancé
              </button>
            </div>
          </div>

          {/* PARAMÈTRES SIMPLES */}
          {!showAdvancedSettings && (
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

              <PasskeyManagement />

              {isAdmin && (
                <div>
                  <div className="panel-title" style={{ fontWeight: 700, marginBottom: 6 }}>Actions administrateur</div>
                  <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      onClick={() => navigate('/corbeille')}
                      style={{
                        padding: '8px 12px',
                        borderRadius: 6,
                        border: '1px solid var(--accent)',
                        background: 'var(--accent)',
                        color: 'white',
                        cursor: 'pointer'
                      }}
                    >
                      📁 Corbeille ({books.filter(b => b.deleted).length})
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowAdvancedSettings(true)}
                      style={{
                        padding: '8px 12px',
                        borderRadius: 6,
                        border: '1px solid var(--border)',
                        background: 'var(--btn-secondary-bg)',
                        cursor: 'pointer'
                      }}
                    >
                      ⚙️ Paramètres avancés
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* PARAMÈTRES AVANCÉS */}
          <div style={{ display: showAdvancedSettings ? 'grid' : 'none', gap: 20 }}>
            <SettingsBlock title="Apparence">
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
            </SettingsBlock>
            {isAdmin && (
              <SettingsBlock title="Impression">
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
                  <div style={{ color: 'var(--muted)', fontSize: 13, marginTop: 6 }}>L'agent écoute sur http://localhost:9110.</div>
                </div>
              </SettingsBlock>
            )}

            {isAdmin && (
              <SettingsBlock title="Sécurité">
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
              </SettingsBlock>
            )}

            {isAdmin && (
              <SettingsBlock title="Sécurité">
              <div>
                <div className="panel-title" style={{ fontWeight: 700, marginBottom: 6 }}>Configuration WebAuthn/Passkeys 🔐</div>
                <div style={{ display: 'grid', gap: 12 }}>
                  <div style={{ color: 'var(--muted)', fontSize: 13 }}>
                    Ces paramètres remplacent les variables d'environnement RP_ID, RP_ORIGIN et RP_NAME. Laissez vide pour utiliser les valeurs par défaut.
                  </div>

                  <div style={{ display: 'grid', gap: 10 }}>
                    <div>
                      <label style={{ display: 'block', fontWeight: 600, marginBottom: 4 }}>Identifiant RP (RP_ID)</label>
                      <input
                        type="text"
                        placeholder="ex: services.beaupeyrat.com"
                        value={webauthnConfig.rpId}
                        onChange={(e) => setWebauthnConfig(prev => ({ ...prev, rpId: e.target.value }))}
                        style={{
                          width: '100%',
                          padding: '10px 12px',
                          borderRadius: 6,
                          border: '1px solid var(--border)',
                          background: 'var(--input-bg)'
                        }}
                      />
                      <div style={{ color: 'var(--muted)', fontSize: 12, marginTop: 2 }}>
                        Doit correspondre exactement au domaine où l'application est hébergée
                      </div>
                    </div>

                    <div>
                      <label style={{ display: 'block', fontWeight: 600, marginBottom: 4 }}>Origine RP (RP_ORIGIN)</label>
                      <input
                        type="text"
                        placeholder="ex: https://services.beaupeyrat.com"
                        value={webauthnConfig.rpOrigin}
                        onChange={(e) => setWebauthnConfig(prev => ({ ...prev, rpOrigin: e.target.value }))}
                        style={{
                          width: '100%',
                          padding: '10px 12px',
                          borderRadius: 6,
                          border: '1px solid var(--border)',
                          background: 'var(--input-bg)'
                        }}
                      />
                      <div style={{ color: 'var(--muted)', fontSize: 12, marginTop: 2 }}>
                        URL complète avec protocole et domaine
                      </div>
                    </div>

                    <div>
                      <label style={{ display: 'block', fontWeight: 600, marginBottom: 4 }}>Nom RP (RP_NAME)</label>
                      <input
                        type="text"
                        placeholder="ex: Bibliomanager"
                        value={webauthnConfig.rpName}
                        onChange={(e) => setWebauthnConfig(prev => ({ ...prev, rpName: e.target.value }))}
                        style={{
                          width: '100%',
                          padding: '10px 12px',
                          borderRadius: 6,
                          border: '1px solid var(--border)',
                          background: 'var(--input-bg)'
                        }}
                      />
                      <div style={{ color: 'var(--muted)', fontSize: 12, marginTop: 2 }}>
                        Nom affiché lors de l'enregistrement de passkeys
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={saveWebauthnConfig}
                      disabled={webauthnConfigSaved === 'saving'}
                      style={{
                        padding: '10px 16px',
                        borderRadius: 8,
                        border: '1px solid var(--accent)',
                        background: webauthnConfigSaved === 'saved' ? 'var(--chip-ok-bg)' :
                                   webauthnConfigSaved === 'error' ? 'var(--chip-bad-bg)' : 'var(--accent)',
                        color: webauthnConfigSaved === 'saved' ? 'var(--chip-ok-text)' :
                               webauthnConfigSaved === 'error' ? 'var(--chip-bad-text)' : 'white',
                        cursor: webauthnConfigSaved === 'saving' ? 'not-allowed' : 'pointer',
                        opacity: webauthnConfigSaved === 'saving' ? 0.6 : 1
                      }}
                    >
                      {webauthnConfigSaved === 'saving' ? 'Enregistrement...' :
                       webauthnConfigSaved === 'saved' ? 'Configuration sauvegardée ✓' :
                       webauthnConfigSaved === 'error' ? 'Erreur lors de la sauvegarde' :
                       'Enregistrer la configuration'}
                    </button>

                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            const r = await fetch('/api/admin/webauthn-debug');
                            if (r.ok) {
                              const debug = await r.json();
                              console.log('=== DEBUG WEBAUTHN ===');
                              console.log('Configuration Admin:', debug.adminConfig);
                              console.log('Configuration Effective:', debug.effectiveConfig);
                              console.log('Défauts Environnement:', debug.environmentDefaults);
                              console.log('Passkeys:', debug.passkeys);
                              alert(`Debug WebAuthn affiché dans la console.\nPasskeys: ${debug.passeysCount}\nrpID effectif: ${debug.effectiveConfig.rpID}`);
                            }
                          } catch (e) {
                            alert('Erreur lors du debug: ' + e);
                          }
                        }}
                        style={{
                          padding: '8px 12px',
                          borderRadius: 6,
                          border: '1px solid var(--border)',
                          background: 'var(--btn-secondary-bg)',
                          cursor: 'pointer'
                        }}
                      >
                        🔍 Debug WebAuthn
                      </button>

                      <button
                        type="button"
                        onClick={async () => {
                          if (!confirm('Supprimer TOUTES les passkeys de votre compte ?\n\nCeci est irréversible et vous devrez vous reconnecter avec mot de passe.')) return;
                          try {
                            const r = await fetch(`/api/admin/passkeys/user/${encodeURIComponent(me.username || '')}`, { method: 'DELETE' });
                            if (r.ok) {
                              const result = await r.json();
                              alert(`${result.deleted || 0} passkey(s) supprimée(s). Vous pouvez maintenant créer de nouvelles passkeys avec la bonne configuration.`);
                            } else {
                              alert('Erreur lors de la suppression');
                            }
                          } catch (e) {
                            alert('Erreur: ' + e);
                          }
                        }}
                        style={{
                          padding: '8px 12px',
                          borderRadius: 6,
                          border: '1px solid var(--danger-border)',
                          background: 'var(--danger-bg)',
                          color: 'var(--danger-text)',
                          cursor: 'pointer'
                        }}
                      >
                        🗑️ Supprimer mes passkeys
                      </button>
                    </div>
                  </div>
                </div>
              </div>
              </SettingsBlock>
            )}

            {isAdmin && (
              <SettingsBlock title="Données">
              <div>
                <div className="panel-title" style={{ fontWeight: 700, marginBottom: 6 }}>Corbeille</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                  <div style={{ color: 'var(--muted)', fontSize: 14 }}>
                    {(() => {
                      const deletedCount = books.filter(b => b.deleted).length;
                      return deletedCount === 0 ? 'Aucun livre dans la corbeille' : `${deletedCount} livre(s) dans la corbeille`;
                    })()}
                  </div>
                  <button
                    type="button"
                    onClick={() => navigate('/corbeille')}
                    style={{
                      padding: '8px 12px',
                      borderRadius: 6,
                      border: '1px solid var(--border)',
                      background: 'var(--btn-secondary-bg)',
                      color: 'var(--text)',
                      fontSize: 14,
                      fontWeight: 500
                    }}
                  >
                    🗑️ Gérer la corbeille
                  </button>
                </div>
                <div style={{ color: 'var(--muted)', fontSize: 13, marginTop: 6 }}>
                  Les livres supprimés sont conservés dans la corbeille jusqu'à suppression définitive.
                </div>
              </div>
              </SettingsBlock>
            )}

            {isAdmin && (
              <SettingsBlock title="Données">
              <div>
                <div className="panel-title" style={{ fontWeight: 700, marginBottom: 6 }}>Export / Import de la base de données</div>
                <div style={{ display: 'grid', gap: 12 }}>
                  <div>
                    <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 14 }}>Export</div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        onClick={exportToCSV}
                        style={{
                          padding: '8px 12px',
                          borderRadius: 6,
                          border: '1px solid var(--success)',
                          background: 'var(--success)',
                          color: 'white',
                          fontSize: 14,
                          fontWeight: 500
                        }}
                      >
                        📄 Exporter en CSV
                      </button>
                      <button
                        type="button"
                        onClick={exportToSQL}
                        style={{
                          padding: '8px 12px',
                          borderRadius: 6,
                          border: '1px solid var(--success)',
                          background: 'var(--success)',
                          color: 'white',
                          fontSize: 14,
                          fontWeight: 500
                        }}
                      >
                        🗃️ Exporter en SQL
                      </button>
                    </div>
                  </div>
                  <div>
                    <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 14 }}>Import SQL</div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                      <input
                        ref={sqlFileInputRef}
                        type="file"
                        accept=".sql,text/sql"
                        onChange={handleSQLFileImport}
                        style={{ display: 'none' }}
                      />
                      <button
                        type="button"
                        onClick={() => sqlFileInputRef.current?.click()}
                        style={{
                          padding: '8px 12px',
                          borderRadius: 6,
                          border: '1px solid var(--accent)',
                          background: 'var(--accent)',
                          color: 'white',
                          fontSize: 14,
                          fontWeight: 500
                        }}
                      >
                        📥 Importer depuis SQL
                      </button>
                    </div>
                  </div>
                </div>
                <div style={{ color: 'var(--muted)', fontSize: 13, marginTop: 6 }}>
                  Le CSV exporté est compatible avec l'import en masse. L'import SQL remplace complètement la base existante.
                </div>
              </div>
              </SettingsBlock>
            )}

            {me.username && (
              <SettingsBlock title="Sécurité">
                <PasskeyManagement />
              </SettingsBlock>
            )}

          </div>
        </section>
      )}

      {route === '/connexion' && (
        <div style={{ 
          display: 'grid', 
          placeItems: 'center', 
          minHeight: '80vh',
          background: 'linear-gradient(135deg, var(--panel) 0%, var(--card) 100%)',
          padding: '20px'
        }}>
          <div style={{ display: 'grid', gap: '12px', alignItems: 'center' }}>
            <h1 style={{ 
              margin: 0, 
              fontSize: 28, 
              fontWeight: 700, 
              textAlign: 'center',
              color: 'var(--text)'
            }}>
              Connexion
            </h1>
            
            <section style={{ 
              padding: '32px', 
              border: '1px solid var(--border)', 
              borderRadius: 16, 
              width: 'min(420px, 90vw)', 
              background: 'var(--panel)', 
              boxShadow: '0 8px 32px rgba(0, 0, 0, 0.1)'
            }}>
              {me.username ? (
                <div style={{ textAlign: 'center' }}>
                  <h2 style={{ margin: '0 0 16px 0', fontSize: 20, fontWeight: 600 }}>Déjà connecté</h2>
                  <p style={{ color: 'var(--muted)', margin: 0 }}>
                    Connecté en tant que <strong>{me.username}</strong>
                  </p>
                </div>
              ) : (
                <LoginForm onSubmit={async (u, p, remember) => { await login(u, p, remember); navigate('/livres/disponibles'); }} />
              )}
            </section>
          </div>
        </div>
      )}

      {route === '/livres/nouveau' && (
      <section style={{ padding: 16, border: '1px solid var(--border)', borderRadius: 8 }}>
        <h2 style={{ marginTop: 0 }}>Gestion des livres</h2>
        {!canImport && (
          <p style={{ color: 'var(--muted)' }}>Accès restreint. Connectez-vous avec un profil Administration ou Import/Ajouts.</p>
        )}
        <div className="add-form-wrapper" style={{ marginBottom: 12 }}>
          {!showEditionPicker && (
            <input
              aria-label="Rechercher un livre (ISBN, code-barres, titre, auteur)"
              placeholder="Rechercher un livre…"
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
              style={{ width: '100%', maxWidth: '100%', padding: '10px 12px', borderRadius: 6, border: '1px solid var(--border)', boxSizing: 'border-box' }}
            />
          )}
          {showEditionPicker && (
            <div style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 10, padding: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.1)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <strong>Choisir une édition</strong>
                <button type="button" onMouseDown={(e) => { e.preventDefault(); setShowEditionPicker(false); }} style={{ padding: '6px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--btn-secondary-bg)' }}>Fermer</button>
              </div>
              {editionLoading && <div style={{ padding: 8, color: 'var(--muted)' }}>Chargement des éditions…</div>}
              {editionError && <div style={{ padding: 8, color: 'var(--overdue-text)' }}>{editionError}</div>}
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
              border: '1px solid var(--accent)',
              background: 'var(--accent)',
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
              border: '1px solid var(--accent)',
              background: isAddDisabled ? 'var(--accent-weak)' : 'var(--accent)',
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
                    { s.coverUrl ? (
                      <img src={s.coverUrl} alt="" width={36} height={54} style={{ objectFit: 'cover', borderRadius: 4 }} />
                    ) : (s.isbn13 || s.isbn10) ? (
                      <img src={`/covers/isbn/${String(s.isbn13 || s.isbn10)}?s=S`} alt="" width={36} height={54} style={{ objectFit: 'cover', borderRadius: 4 }} />
                    ) : (
                      <div style={{ width: 36, height: 54, background: 'var(--card-placeholder)', borderRadius: 4 }} />
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
          <p style={{ color: 'var(--overdue-text)', fontSize: 13, marginTop: 8 }}>
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
            <option value="unprinted">Sans étiquettes</option>
            <option value="printed">Avec étiquettes</option>
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
                  {editingBookId === b.id ? (
                    // En mode édition : couverture cliquable pour scanner
                    <div
                      onClick={() => startCoverCapture(b.id)}
                      style={{
                        width: 36,
                        height: 54,
                        borderRadius: 4,
                        cursor: 'pointer',
                        position: 'relative',
                        border: '2px solid var(--accent)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        backgroundColor: b.coverUrl || b.isbn ? 'transparent' : 'var(--card-placeholder)',
                      }}
                      title="Cliquer pour prendre une photo de la couverture"
                    >
                      {b.coverUrl || b.isbn ? (
                        <img src={b.coverUrl || (b.isbn ? `/covers/isbn/${b.isbn}?s=S` : '')} alt="" width={32} height={50} style={{ objectFit: 'cover', borderRadius: 2 }} />
                      ) : (
                        <span style={{ fontSize: 20 }}>📷</span>
                      )}
                      <div style={{
                        position: 'absolute',
                        top: -2,
                        right: -2,
                        width: 12,
                        height: 12,
                        backgroundColor: 'var(--accent)',
                        borderRadius: '50%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 8,
                        color: 'white'
                      }}>📷</div>
                    </div>
                  ) : (
                    // Mode normal : affichage simple
                    b.coverUrl || b.isbn ? (
                      <img src={b.coverUrl || (b.isbn ? `/covers/isbn/${b.isbn}?s=S` : '')} alt="" width={36} height={54} style={{ objectFit: 'cover', borderRadius: 4 }} />
                    ) : (
                      <div style={{ width: 36, height: 54, background: 'var(--card-placeholder)', borderRadius: 4 }} />
                    )
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
                      <>
                        <span style={{ textDecoration: b.read ? 'line-through' : 'none' }}>{b.title}</span>
                        {!b.labelPrinted && (
                          <span
                            title="Étiquette à imprimer"
                            style={{
                              fontSize: '12px',
                              background: 'var(--warn-bg)',
                              color: 'var(--warn-text)',
                              padding: '2px 6px',
                              borderRadius: '12px',
                              fontWeight: 500
                            }}
                          >
                            🏷️ À imprimer
                          </span>
                        )}
                      </>
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
                      style={{ padding: '8px 10px', borderRadius: 6, border: '1px solid var(--accent-weak)', background: 'var(--accent-weak)', color: 'white' }}
                    >
                      Terminer
                    </button>
                  ) : (
                    <button
                      onClick={() => setEditingBookId(b.id)}
                      style={{ padding: '8px 10px', borderRadius: 6, border: '1px solid var(--accent)', background: 'var(--accent)', color: 'white' }}
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
                      border: '1px solid var(--danger)',
                      background: 'var(--danger)',
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
                  {b.coverUrl ? (
                    <img src={b.coverUrl} alt="" width={48} height={72} style={{ objectFit: 'cover', borderRadius: 6 }} />
                  ) : b.isbn ? (
                    <img src={`/covers/isbn/${b.isbn}?s=S`} alt="" width={48} height={72} style={{ objectFit: 'cover', borderRadius: 6 }} />
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
                {selectedAvailableBook.coverUrl ? (
                  <img src={selectedAvailableBook.coverUrl} alt="" width={96} height={144} style={{ objectFit: 'cover', borderRadius: 8 }} />
                ) : selectedAvailableBook.isbn ? (
                  <img src={`/covers/isbn/${selectedAvailableBook.isbn}?s=M`} alt="" width={96} height={144} style={{ objectFit: 'cover', borderRadius: 8 }} />
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
              placeholder="Rechercher livre…"
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
              style={{ width: '100%', maxWidth: '100%', padding: '10px 12px', borderRadius: 6, border: '1px solid var(--border)', boxSizing: 'border-box' }}
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
              {loanScanError && <span style={{ color: 'var(--overdue-text)' }}>{loanScanError}</span>}
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
          <p style={{ color: 'var(--overdue-text)', fontSize: 13, marginTop: 8 }}>
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
            CSV (titre,auteur,isbn,epc,id)
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
              {scanError && <span style={{ color: 'var(--overdue-text)' }}>{scanError}</span>}
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
            <label style={{ fontWeight: 600 }}>Coller du CSV (entêtes: title,author,isbn,epc,id)</label>
            <textarea
              aria-label="CSV"
              rows={6}
              placeholder="title,author,isbn,epc,id\nMon titre,Mon auteur,978...,ABCDEF0123456789ABCDEF01,123"
              value={csvText}
              onChange={(e) => { setCsvText(e.target.value); parseCsv(e.target.value); }}
              style={{ padding: 10, borderRadius: 8, border: '1px solid var(--border)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}
            />
            {csvError && <div style={{ color: 'var(--overdue-text)' }}>{csvError}</div>}
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
                      <div style={{ color: 'var(--muted)', fontSize: 12 }}>{it.isbn ? `ISBN ${it.isbn}` : 'ISBN non fourni'}{it.epc ? ` · EPC ${it.epc}` : ''}{it.id ? ` · ID ${it.id}` : ''}</div>
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

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
          <h3 style={{ margin: 0 }}>À importer ({importItems.length})</h3>
          <div style={{ display: 'flex', gap: 8 }}>
            <button 
              type="button" 
              onClick={() => {
                console.log('Test popup button clicked');
                setPrintModalBooks([1, 2, 3]); // IDs de test
                setSelectedForBatchPrint(new Set([1, 2, 3]));
                setShowPrintModal(true);
              }}
              style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--btn-secondary-bg)' }}
            >
              Test Popup
            </button>
            <button type="button" onClick={importAllToLibrary} disabled={importItems.every((it) => it.status !== 'ok')} style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--success)', background: importItems.some((it) => it.status === 'ok') ? 'var(--success)' : '#9ae6b4', color: 'white' }}>
              Importer les livres OK ({importItems.filter((it) => it.status === 'ok').length})
            </button>
          </div>
        </div>
        {importItems.length === 0 ? (
          <p>Aucun élément en file d'import.</p>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}>
            {importItems.map((it) => (
              <li key={it.barcode} style={{ display: 'grid', gridTemplateColumns: '1fr auto', alignItems: 'center', gap: 12, padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                  {it.coverUrl ? (
                    <img src={it.coverUrl} alt="" width={36} height={54} style={{ objectFit: 'cover', borderRadius: 4 }} />
                  ) : it.isbn ? (
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
                  <span style={{ padding: '4px 8px', borderRadius: 999, fontSize: 12, border: '1px solid var(--border)', background: it.status === 'ok' ? 'var(--chip-ok-bg)' : it.status === 'pending' ? 'var(--card-placeholder)' : it.status === 'not_found' ? 'var(--warn-bg)' : 'var(--chip-bad-bg)', color: it.status === 'ok' ? 'var(--chip-ok-text)' : it.status === 'not_found' ? 'var(--warn-text)' : it.status === 'error' ? 'var(--chip-bad-text)' : 'var(--text)' }}>
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

      {route === '/corbeille' && (
        <section style={{ padding: 16, border: '1px solid var(--border)', borderRadius: 8 }}>
          <h2 style={{ marginTop: 0 }}>Corbeille</h2>
          {!isAdmin ? (
            <p style={{ color: 'var(--muted)' }}>Accès réservé aux administrateurs.</p>
          ) : (() => {
            const deletedBooks = books.filter(b => b.deleted);
            
            if (deletedBooks.length === 0) {
              return (
                <p style={{ color: 'var(--muted)', textAlign: 'center', padding: 32 }}>
                  🗑️ La corbeille est vide
                </p>
              );
            }

            return (
              <div>
                <p style={{ marginBottom: 16, color: 'var(--muted)' }}>
                  {deletedBooks.length} livre(s) dans la corbeille
                </p>
                
                <div style={{ marginBottom: 16, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  <button 
                    onClick={() => {
                      if (!requireEdit()) return;
                      if (confirm('Êtes-vous sûr de vouloir vider entièrement la corbeille ? Cette action est irréversible.')) {
                        setBooks(prev => prev.filter(b => !b.deleted));
                      }
                    }}
                    style={{ 
                      padding: '8px 12px', 
                      borderRadius: 6, 
                      border: '1px solid var(--danger)', 
                      background: 'var(--danger)', 
                      color: 'white',
                      fontWeight: 500
                    }}
                  >
                    Vider la corbeille
                  </button>
                  <button 
                    onClick={() => {
                      if (!requireEdit()) return;
                      if (confirm('Êtes-vous sûr de vouloir restaurer tous les livres de la corbeille ?')) {
                        setBooks(prev => prev.map(b => b.deleted ? { ...b, deleted: false, deletedAt: undefined } : b));
                      }
                    }}
                    style={{ 
                      padding: '8px 12px', 
                      borderRadius: 6, 
                      border: '1px solid var(--success)', 
                      background: 'var(--success)', 
                      color: 'white',
                      fontWeight: 500
                    }}
                  >
                    Tout restaurer
                  </button>
                </div>

                <div style={{ display: 'grid', gap: 12 }}>
                  {deletedBooks.map((book) => (
                    <div key={book.id} style={{ 
                      display: 'flex', 
                      alignItems: 'center', 
                      gap: 12, 
                      padding: 12, 
                      border: '1px solid var(--border)', 
                      borderRadius: 8, 
                      background: 'var(--card)'
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
                        {book.coverUrl ? (
                          <img src={book.coverUrl} alt="" width={40} height={58} style={{ objectFit: 'cover', borderRadius: 4 }} />
                        ) : (
                          <div style={{ width: 40, height: 58, background: 'var(--card-placeholder)', borderRadius: 4 }} />
                        )}
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div style={{ fontWeight: 600, marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {book.title}
                          </div>
                          <div style={{ color: 'var(--muted)', fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {book.author}
                          </div>
                          <div style={{ color: 'var(--muted)', fontSize: 12, marginTop: 4 }}>
                            Supprimé le {new Date(book.deletedAt || 0).toLocaleDateString('fr-FR')}
                          </div>
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button
                          onClick={() => restoreBook(book.id)}
                          style={{
                            padding: '6px 10px',
                            borderRadius: 6,
                            border: '1px solid var(--success)',
                            background: 'var(--success)',
                            color: 'white',
                            fontSize: 14,
                            fontWeight: 500
                          }}
                        >
                          Restaurer
                        </button>
                        <button
                          onClick={() => permanentDeleteBook(book.id)}
                          style={{
                            padding: '6px 10px',
                            borderRadius: 6,
                            border: '1px solid var(--danger)',
                            background: 'var(--danger)',
                            color: 'white',
                            fontSize: 14,
                            fontWeight: 500
                          }}
                        >
                          Supprimer définitivement
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}
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

      {/* Modal de capture photo de couverture - Placé au niveau global */}
      {scanningCoverForBookId && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => stopCoverCapture()}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.9)',
            display: 'grid',
            placeItems: 'center',
            padding: 16,
            zIndex: 1000,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ 
              background: 'var(--panel)', 
              borderRadius: 12, 
              padding: 20, 
              width: 'min(520px, 95vw)', 
              boxShadow: '0 10px 30px rgba(0,0,0,0.3)',
              textAlign: 'center'
            }}
          >
            <h3 style={{ marginTop: 0, marginBottom: 16 }}>Photographier la couverture du livre</h3>
            <p style={{ color: 'var(--muted)', marginBottom: 20 }}>
              Positionnez la couverture du livre dans le cadre et cliquez sur "Capturer" pour prendre la photo.
            </p>
            
            <div style={{ marginBottom: 20 }}>
              <div style={{ 
                position: 'relative', 
                width: '300px', 
                height: '450px',
                margin: '0 auto',
                border: '3px solid var(--accent)',
                borderRadius: 8,
                overflow: 'hidden',
                backgroundColor: '#000'
              }}>
                <video
                  ref={videoRef}
                  style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover'
                  }}
                  autoPlay
                  muted
                  playsInline
                />
                {/* Overlay pour indiquer la zone de capture */}
                <div style={{
                  position: 'absolute',
                  top: '50%',
                  left: '50%',
                  transform: 'translate(-50%, -50%)',
                  width: '80%',
                  height: '80%',
                  border: '2px dashed rgba(255,255,255,0.7)',
                  borderRadius: 4,
                  pointerEvents: 'none'
                }} />
              </div>
              {scanError && (
                <div style={{ color: 'var(--danger)', marginTop: 12, fontSize: 14 }}>
                  {scanError}
                </div>
              )}
            </div>

            <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap', alignItems: 'center' }}>
              {isScanning && (
                <button 
                  type="button"
                  onClick={captureBookCover}
                  style={{ 
                    padding: '12px 24px', 
                    borderRadius: 8, 
                    border: '1px solid var(--accent)', 
                    background: 'var(--accent)', 
                    color: 'white',
                    fontSize: 16,
                    fontWeight: 600,
                    cursor: 'pointer'
                  }}
                >
                  📷 Capturer
                </button>
              )}
              
              {!isScanning && (
                <button 
                  type="button"
                  onClick={startCoverCameraStream}
                  style={{ 
                    padding: '12px 20px', 
                    borderRadius: 8, 
                    border: '1px solid var(--accent)', 
                    background: 'var(--accent)', 
                    color: 'white',
                    cursor: 'pointer'
                  }}
                >
                  Démarrer la caméra
                </button>
              )}
              
              <button 
                type="button" 
                onClick={() => stopCoverCapture()} 
                style={{ 
                  padding: '12px 20px', 
                  borderRadius: 8, 
                  border: '1px solid var(--border)', 
                  background: 'var(--btn-secondary-bg)',
                  cursor: 'pointer'
                }}
              >
                Annuler
              </button>
              
              {cameraDevices.length > 1 && isScanning && (
                <select
                  value={selectedCameraId}
                  onChange={async (e) => {
                    const id = e.target.value;
                    setSelectedCameraId(id);
                    await stopCoverCameraStream();
                    await startCoverCameraStream();
                  }}
                  style={{ 
                    padding: '10px 12px', 
                    borderRadius: 8, 
                    border: '1px solid var(--border)',
                    background: 'var(--panel)',
                    cursor: 'pointer'
                  }}
                >
                  {cameraDevices.map((d, i) => (
                    <option key={d.deviceId || i} value={d.deviceId}>
                      {(d.label && d.label.trim()) || `Caméra ${i + 1}`}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Popup d'impression en masse */}
      {showPrintModal && (console.log('Rendering print modal', { showPrintModal, printModalBooks })) && (
        <div 
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0, 0, 0, 0.5)',
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
          onClick={(e) => e.target === e.currentTarget && closePrintModal()}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'var(--panel)',
              borderRadius: 12,
              padding: 24,
              width: 'min(600px, 90vw)',
              maxHeight: '80vh',
              overflow: 'auto',
              boxShadow: '0 10px 30px rgba(0,0,0,0.3)'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <h2 style={{ margin: 0, fontSize: 20 }}>Impression des étiquettes</h2>
              <button
                onClick={closePrintModal}
                style={{
                  background: 'none',
                  border: 'none',
                  fontSize: 24,
                  cursor: 'pointer',
                  color: 'var(--muted)',
                  padding: 4
                }}
              >
                ×
              </button>
            </div>

            <p style={{ color: 'var(--muted)', marginBottom: 16 }}>
              {printModalBooks.length} livre(s) importé(s) avec succès. Sélectionnez ceux pour lesquels vous souhaitez imprimer des étiquettes :
            </p>

            <div style={{ marginBottom: 16, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                onClick={() => setSelectedForBatchPrint(new Set(printModalBooks))}
                style={{
                  padding: '6px 12px',
                  borderRadius: 6,
                  border: '1px solid var(--border)',
                  background: 'var(--btn-secondary-bg)',
                  cursor: 'pointer'
                }}
              >
                Tout sélectionner
              </button>
              <button
                onClick={() => setSelectedForBatchPrint(new Set())}
                style={{
                  padding: '6px 12px',
                  borderRadius: 6,
                  border: '1px solid var(--border)',
                  background: 'var(--btn-secondary-bg)',
                  cursor: 'pointer'
                }}
              >
                Désélectionner tout
              </button>
            </div>

            <div style={{ maxHeight: '300px', overflow: 'auto', marginBottom: 16 }}>
              {printModalBooks.map((bookId) => {
                const book = books.find(b => b.id === bookId);
                if (!book) return null;
                
                return (
                  <div
                    key={bookId}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      padding: '8px 12px',
                      border: '1px solid var(--border)',
                      borderRadius: 6,
                      marginBottom: 8,
                      background: selectedForBatchPrint.has(bookId) ? 'var(--nav-active-bg)' : 'transparent'
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={selectedForBatchPrint.has(bookId)}
                      onChange={(e) => {
                        const newSet = new Set(selectedForBatchPrint);
                        if (e.target.checked) {
                          newSet.add(bookId);
                        } else {
                          newSet.delete(bookId);
                        }
                        setSelectedForBatchPrint(newSet);
                      }}
                      style={{ marginRight: 8 }}
                    />
                    {book.coverUrl ? (
                      <img src={book.coverUrl} alt="" width={32} height={48} style={{ objectFit: 'cover', borderRadius: 4 }} />
                    ) : book.isbn ? (
                      <img src={`/covers/isbn/${book.isbn}?s=S`} alt="" width={32} height={48} style={{ objectFit: 'cover', borderRadius: 4 }} />
                    ) : (
                      <div style={{ width: 32, height: 48, background: 'var(--card-placeholder)', borderRadius: 4 }} />
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {book.title}
                      </div>
                      <div style={{ color: 'var(--muted)', fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {book.author}
                      </div>
                      {book.isbn && (
                        <div style={{ color: 'var(--muted-2)', fontSize: 12 }}>
                          ISBN {book.isbn}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
              <button
                onClick={closePrintModal}
                style={{
                  padding: '10px 16px',
                  borderRadius: 8,
                  border: '1px solid var(--border)',
                  background: 'var(--btn-secondary-bg)',
                  cursor: 'pointer'
                }}
              >
                Annuler
              </button>
              <button
                onClick={executeBatchPrint}
                disabled={selectedForBatchPrint.size === 0}
                style={{
                  padding: '10px 16px',
                  borderRadius: 8,
                  border: '1px solid var(--accent)',
                  background: selectedForBatchPrint.size > 0 ? 'var(--accent)' : 'var(--accent-weak)',
                  color: 'white',
                  cursor: selectedForBatchPrint.size > 0 ? 'pointer' : 'not-allowed'
                }}
              >
                Imprimer ({selectedForBatchPrint.size})
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
