// Mock data for the sales workspace.
// The mental model: this represents the LIVE order's current state.
// There is no "staged vs owned" — the workspace is always editable, and
// financial commits happen behind the scenes when the user collects/saves.

const ORDER = {
  ref: 'ORD-2026-0418',
  bookingRef: 'BK-2401',
  customer: {
    name: 'Sarah Al-Kuwari',
    phone: '+973 3399 0214',
    initials: 'SK',
  },
  sessionType: 'Newborn — Studio',
  sessionDate: 'Mon 03 Jun · 09:30',
  duration: '3 hr',
  photographer: 'Maya Hassan',
  state: 'Selection',  // operational phase; not a financial state
};

const PACKAGES = [
  {
    id: 'pkg-1',
    name: 'Heritage Portrait — Full Day',
    tier: 'HERITAGE',
    sessionMeta: 'Family · 3 hr session',
    sessionDate: '23 May 2026',
    base: 880,
    thumbBg: 'linear-gradient(135deg, #c6a182 0%, #8b6a4b 55%, #4a3624 100%)',
    items: [
      { icon: 'Image',    name: 'Edited digital photos', used: 32, total: 40 },
      { icon: 'Frame',    name: 'Fine-art prints',       used: 8,  total: 12, sub: '8 × 10 archival' },
      { icon: 'BookOpen', name: 'Linen-bound album',     qty: 1,             sub: '30 pages · walnut spine · Atelier leather cover' },
      { icon: 'Wand',     name: 'Retouching credits',    used: 9,  total: 15, sub: 'Advanced skin & colour' },
      { icon: 'Frame',    name: 'Framed centerpiece',    qty: 1,             sub: '16 × 20 oak float frame' },
    ],
    customerNote: "Outdoor + studio combo. Bring grandmother's locket for hero shot.",
  },
  {
    id: 'pkg-2',
    name: 'Add-on · Newborn Mini',
    tier: 'ESSENTIALS',
    sessionMeta: 'Studio · 45 min',
    sessionDate: '23 May 2026',
    base: 240,
    thumbBg: 'linear-gradient(135deg, #e7d9c6 0%, #b89e84 55%, #6f5d4a 100%)',
    items: [
      { icon: 'Image', name: 'Edited digital photos', used: 6, total: 12 },
      { icon: 'Frame', name: 'Fine-art prints',       used: 0, total: 4, sub: '5 × 7 archival' },
    ],
    customerNote: '',
  },
];

const SUMMARY = {
  subtotal: 1120,
  packageDiscount: -60,
  loyaltyCredit: -40,
  total: 1020,
  deposit: -400,
  prevPayments: -280,
  remaining: 340,
  // Direction A — staged adjustment context
  previousTotal: 780,
  pendingDelta: 505,
  afterCommit: 1285,
};

// Staged changes — semantic descriptions of pending edits, not bare $ deltas.
// Tones: info (config/swap), accent (additions), ok (credits/discounts), warn (removals).
const STAGED = [
  { tone: 'info',   title: 'Album cover → Atelier leather',           sub: 'Customer requested Italian leather, sage thread.',     amount:  +90 },
  { tone: 'accent', title: 'Newborn Mini add-on package',             sub: '45 min studio session · 12 edited photos · 4 prints.', amount: +240 },
  { tone: 'accent', title: 'Fine-art prints upgraded to 8 × 10',      sub: 'From 5 × 7 archival; same paper stock.',                amount:  +50 },
  { tone: 'ok',     title: 'Loyalty credit applied',                  sub: '',                                                       amount:  -40 },
  { tone: 'info',   title: 'Retouching credits +5',                   sub: 'Advanced skin & colour package.',                       amount:  +60 },
  { tone: 'warn',   title: 'Removed framed centerpiece',              sub: '16 × 20 oak float frame — customer postponed.',         amount: -180 },
  { tone: 'accent', title: 'Gallery canvas 20 × 30',                  sub: 'Living-room piece — hero family portrait.',             amount: +285 },
];

// Recent activity — operational edits in plain language, no "staged"
// framing. Older entries fade off the end; full history is in a side
// panel reachable via "View all".
const ACTIVITY = [
  { dot: 'accent',  who: 'Maya Hassan', text: 'added Newborn Mini add-on package',                    when: '3 min ago',   delta: '+BD 240' },
  { dot: 'accent',  who: 'Maya Hassan', text: 'upgraded album cover to Atelier leather',              when: '6 min ago',   delta: '+BD 90'  },
  { dot: 'accent',  who: 'Maya Hassan', text: 'changed fine-art prints to 8 × 10 archival',           when: '8 min ago',   delta: null      },
  { dot: 'info',    who: 'Maya Hassan', text: 'selected 32 photos from the outdoor reel',             when: '14 min ago',  delta: null      },
  { dot: 'success', who: 'Lana B.',     text: 'applied loyalty credit',                                when: 'earlier today', delta: '−BD 40'  },
  { dot: 'success', who: 'Reception',   text: 'recorded mid-payment',                                  when: '02 Jun',      delta: '+BD 200' },
  { dot: 'success', who: 'Reception',   text: 'recorded deposit',                                     when: '14 May',      delta: '+BD 400' },
];

// Albums on the order — either bundled inside a package or sold as a
// standalone add-on. Each album owns its own configuration record so it
// can be edited independently in the Album tab.
const ALBUMS = [
  {
    id: 'alb-1',
    sourceKind: 'package',                                    // 'package' | 'addon'
    sourcePkgId: 'pkg-1',
    sourceLabel: 'Included with Heritage Portrait — Full Day',
    title: 'Heritage album',
    subtitle: 'Linen-bound Heritage album · walnut spine',
    coverBg: 'linear-gradient(140deg, #efe2cf 0%, #d8b994 38%, #a78562 78%, #5a4226 100%)',
    coverName: 'The Hartwells',
    coverDate: 'Spring · Twenty Twenty-Six',
    coverRef: 'ph-008',
    fields: [
      { k: 'Album type',  v: 'Linen Heritage · Walnut spine' },
      { k: 'Pages',       v: '30 pages', accent: '+10 available' },
      { k: 'Cover image', v: 'ph-008 · mother + daughter' },
      { k: 'Cover text',  v: 'The Hartwells · Spring 2026' },
      { k: 'Thread',      v: 'Sage green' },
      { k: 'Layout style',v: 'Editorial · airy whitespace' },
    ],
    config: {
      albumType:    { options: ['Linen Heritage', 'Italian leather Atelier', 'Velvet Signature'], selected: 'Italian leather Atelier' },
      pages:        { options: ['20 pages', '30 pages', '40 pages', '50 pages'], selected: '30 pages' },
      thread:       { options: ['Cream', 'Sage', 'Charcoal', 'Bordeaux'], selected: 'Sage' },
      layout:       { options: ['Editorial', 'Classic', 'Cinematic'], selected: 'Editorial' },
      instructions: "Use ph-008 for cover. Family shots first, then individual portraits. Grandmother's solo on facing page to family group.",
    },
    priceImpact: 340,
    hasStagedChanges: true,
  },
  {
    id: 'alb-2',
    sourceKind: 'addon',
    sourcePkgId: null,
    sourceLabel: 'Standalone add-on',
    title: 'Parents keepsake mini',
    subtitle: 'Velvet Signature mini · square 8 × 8',
    coverBg: 'linear-gradient(135deg, #f3e6d6 0%, #d4b894 45%, #8c6a47 100%)',
    coverName: 'Yusuf & Layla',
    coverDate: 'Anniversary · 2026',
    coverRef: null,
    fields: [
      { k: 'Album type',  v: 'Velvet Signature · Square 8 × 8' },
      { k: 'Pages',       v: '20 pages' },
      { k: 'Cover image', v: 'Not selected yet', muted: true },
      { k: 'Cover text',  v: 'Yusuf & Layla' },
      { k: 'Thread',      v: 'Cream' },
      { k: 'Layout style',v: 'Classic · gallery grid' },
    ],
    config: {
      albumType:    { options: ['Linen Heritage', 'Italian leather Atelier', 'Velvet Signature'], selected: 'Velvet Signature' },
      pages:        { options: ['20 pages', '30 pages', '40 pages', '50 pages'], selected: '20 pages' },
      thread:       { options: ['Cream', 'Sage', 'Charcoal', 'Bordeaux'], selected: 'Cream' },
      layout:       { options: ['Editorial', 'Classic', 'Cinematic'], selected: 'Classic' },
      instructions: '',
    },
    priceImpact: 0,
    hasStagedChanges: false,
  },
];

window.ORDER = ORDER;
window.PACKAGES = PACKAGES;
window.SUMMARY = SUMMARY;
window.STAGED = STAGED;
window.ACTIVITY = ACTIVITY;
window.ALBUMS = ALBUMS;
