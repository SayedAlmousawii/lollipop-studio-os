// Shared chrome + primitives + mock data for all wireframe directions.
// Exposes: Topbar, SideRail, PhotoTile, Pill, Btn, Step, Section, Tabs,
// PackageRow, mock customer/order data, and a SketchyRect SVG primitive.

// ── Mock domain data ───────────────────────────────────────────
const MOCK = {
  order: {
    id: 'ORD-2390',
    booking: 'BK-2401',
    customer: { name: 'Sarah Al-Kuwari', phone: '+973 3399 0214' },
    session: 'Newborn — Studio',
    photographer: 'Abrar A.',
    sessionDate: 'Mon 03 Jun',
    state: 'Selection',           // Pending / Confirmed / Checked-in / Selection / Editing / Production / Delivered
    locked: false,
    photosAvailable: 84,
  },
  packages: [
    {
      id: 'pkg-1', name: 'Cherry Blossom — Newborn Premium', tier: 'Premium',
      price: 380, status: 'owned',
      includes: [
        { name: '12 retouched digital photos', q: 12, kind: 'digital', selected: 12 },
        { name: '8 × 10 prints', q: 4, kind: 'print', selected: 4 },
        { name: '20-page matte album', q: 1, kind: 'album', noted: true },
        { name: 'USB keepsake', q: 1, kind: 'product' },
      ],
      extras: [
        { name: '+2 extra digital photos', q: 2, price: 20, kind: 'digital', staged: true },
      ],
      photoNote: 'Pose with grandmother in 4 images',
    },
    {
      id: 'pkg-2', name: 'Maternity Add-on', tier: 'Add-on',
      price: 140, status: 'staged',
      includes: [
        { name: '6 retouched digital photos', q: 6, kind: 'digital', selected: 4 },
        { name: '5 × 7 prints', q: 2, kind: 'print', selected: 0 },
      ],
      extras: [],
      photoNote: '',
    },
  ],
  addons: [
    { name: 'Album cover upgrade — leather', price: 45, staged: true },
    { name: 'Rush editing (3-day)', price: 30, staged: true },
  ],
  payments: [
    { ref: 'DEP-0941', label: 'Deposit', amount: 80, when: '14 May · card', state: 'cleared' },
    { ref: 'INV-1041', label: 'Mid-payment', amount: 150, when: '02 Jun · cash', state: 'cleared' },
  ],
};

const totalOwned   = 380 + 80;     // previous package + previous voucher
const totalStaged  = 140 + 20 + 45 + 30; // staged package + extra photos + add-ons
const totalGrand   = totalOwned + totalStaged - 80; // minus voucher
const totalPaid    = 80 + 150;
const totalDue     = totalGrand - totalPaid;

// ── Mini SVG icon set (Lucide-ish stroked) ─────────────────────
const Icon = ({ d, size = 14, stroke = 1.75, fill = 'none' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
    {typeof d === 'string' ? <path d={d} /> : d}
  </svg>
);
const I = {
  plus:    <Icon d="M12 5v14M5 12h14" />,
  search:  <Icon d={<><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>} />,
  filter:  <Icon d="M3 5h18M6 12h12M10 19h4" />,
  chevR:   <Icon d="m9 6 6 6-6 6" />,
  chevD:   <Icon d="m6 9 6 6 6-6" />,
  more:    <Icon d={<><circle cx="5" cy="12" r="1.2" /><circle cx="12" cy="12" r="1.2" /><circle cx="19" cy="12" r="1.2" /></>} />,
  x:       <Icon d="M18 6 6 18M6 6l12 12" />,
  check:   <Icon d="M5 12l5 5L20 7" />,
  lock:    <Icon d={<><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></>} />,
  pkg:     <Icon d={<><path d="m3 7 9-4 9 4-9 4-9-4Z" /><path d="M3 7v10l9 4 9-4V7" /><path d="M12 11v10" /></>} />,
  camera:  <Icon d={<><path d="M4 7h3l2-3h6l2 3h3v12H4z" /><circle cx="12" cy="13" r="3.5" /></>} />,
  pic:     <Icon d={<><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="1.5" /><path d="m21 16-5-5-9 9" /></>} />,
  edit:    <Icon d="M4 20h4l10-10-4-4L4 16v4Z" />,
  cash:    <Icon d={<><rect x="2" y="6" width="20" height="12" rx="2" /><circle cx="12" cy="12" r="3" /></>} />,
  user:    <Icon d={<><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>} />,
  cal:     <Icon d={<><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 9h18M8 3v4M16 3v4" /></>} />,
  baby:    <Icon d={<><circle cx="12" cy="8" r="4" /><path d="M6 21c0-3 3-5 6-5s6 2 6 5" /></>} />,
  swap:    <Icon d="m7 7 4-4 4 4M17 17l-4 4-4-4M7 7v14M17 17V3" />,
  album:   <Icon d={<><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M4 9h16" /></>} />,
  bell:    <Icon d="M6 8a6 6 0 0 1 12 0v5l2 3H4l2-3V8ZM10 19a2 2 0 0 0 4 0" />,
  trash:   <Icon d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13" />,
  note:    <Icon d={<><path d="M5 4h11l4 4v12H5z" /><path d="M16 4v4h4" /></>} />,
};

// ── Topbar ────────────────────────────────────────────────────
function Topbar({ compact = false, showStepper = false, currentStep = 1, locked = false }) {
  return (
    <div className="wf-top" style={compact ? { height: 48, padding: '0 16px' } : {}}>
      <div className="logo">L</div>
      <div className="crumbs">
        <span className="muted">Sales</span>
        <span className="muted">/</span>
        <span className="ref">{MOCK.order.id}</span>
        <span className="muted">·</span>
        <span>{MOCK.order.session}</span>
        <span className="muted">·</span>
        <span className="ref">{MOCK.order.booking}</span>
      </div>
      {showStepper && (
        <div style={{ marginLeft: 16 }}>
          <div className="stepper">
            <div className={'st ' + (currentStep > 1 ? 'done' : currentStep === 1 ? 'active' : '')}><span className="n">1</span>Compose</div>
            <div className={'st ' + (currentStep > 2 ? 'done' : currentStep === 2 ? 'active' : '')}><span className="n">2</span>Review</div>
            <div className={'st ' + (currentStep > 3 ? 'done' : currentStep === 3 ? 'active' : '')}><span className="n">3</span>Lock</div>
            <div className={'st ' + (currentStep > 4 ? 'done' : currentStep === 4 ? 'active' : '')}><span className="n">4</span>Paid</div>
          </div>
        </div>
      )}
      <div className="spacer" />
      <span className={'pill ' + (locked ? 'locked' : 'warn')}>{locked ? 'Locked' : 'Selection · open'}</span>
      <div className="cust">
        <b>{MOCK.order.customer.name}</b>
        <span className="mono">{MOCK.order.customer.phone}</span>
      </div>
      <button className="btn sm ghost" title="Notifications">{I.bell}</button>
      <div className="sk-box" style={{ width: 28, height: 28, borderRadius: 9999, background: 'var(--accent-soft)', display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 700 }}>AB</div>
    </div>
  );
}

// ── Left vertical nav rail (dark walnut) ──────────────────────
function SideRail({ active = 'sales' }) {
  const items = [
    { id: 'home', icon: '◇' },
    { id: 'cal',  icon: '▦' },
    { id: 'sales',icon: '◉' },
    { id: 'cust', icon: '◯' },
    { id: 'pkg',  icon: '▣' },
    { id: 'pic',  icon: '▤' },
    { id: 'pay',  icon: '$' },
    { id: 'set',  icon: '⚙' },
  ];
  return (
    <div className="wf-side">
      <div className="logo" style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--accent)', color: 'var(--ink)', display: 'grid', placeItems: 'center', fontFamily: 'var(--hand)', fontWeight: 700, marginBottom: 6 }}>L</div>
      {items.map(it => (
        <div key={it.id} className={'ico ' + (it.id === active ? 'active' : '')} title={it.id}>{it.icon}</div>
      ))}
    </div>
  );
}

// ── Sketchy hand-drawn rectangle (used for annotation callouts)
function SketchArrow({ from, to, color = 'var(--accent-dark)' }) {
  // Cubic bezier arrow from {x,y} to {x,y}, in artboard coords
  const dx = to.x - from.x, dy = to.y - from.y;
  const cx1 = from.x + dx * 0.4, cy1 = from.y;
  const cx2 = to.x - dx * 0.4, cy2 = to.y;
  return (
    <svg style={{ position: 'absolute', left: 0, top: 0, pointerEvents: 'none', overflow: 'visible' }} width="1" height="1">
      <path d={`M${from.x},${from.y} C${cx1},${cy1} ${cx2},${cy2} ${to.x},${to.y}`}
            stroke={color} strokeWidth="1.5" fill="none" strokeDasharray="4 3" />
      <polygon points={`${to.x},${to.y} ${to.x - 6},${to.y - 4} ${to.x - 6},${to.y + 4}`} fill={color} />
    </svg>
  );
}

// ── Annotation: handwritten note with optional arrow ──────────
function Anno({ x, y, w = 180, children, arrow }) {
  return (
    <>
      <div className="anno" style={{ left: x, top: y, width: w }}>
        {children}
      </div>
      {arrow && <SketchArrow from={{ x: x + 10, y: y + 24 }} to={arrow} />}
    </>
  );
}

// ── Photo tile (compact) ──────────────────────────────────────
function Photo({ state, sz = 'sq', n }) {
  return (
    <div style={{ position: 'relative' }}>
      <div className={'sk-photo ' + sz} data-state={state} />
      {state === 'picked' && <span className="pill accent" style={{ position: 'absolute', top: 4, left: 4, padding: '1px 5px', fontSize: 9 }}>✓</span>}
      {state === 'extra'  && <span className="pill info"   style={{ position: 'absolute', top: 4, left: 4, padding: '1px 5px', fontSize: 9 }}>+</span>}
      {state === 'owned'  && <span className="pill ok"     style={{ position: 'absolute', top: 4, left: 4, padding: '1px 5px', fontSize: 9 }}>•</span>}
      {n != null && <span className="mono" style={{ position: 'absolute', bottom: 3, right: 4, fontSize: 9, color: 'var(--ink-3)', background: 'rgba(255,255,255,0.85)', padding: '0 3px', borderRadius: 3 }}>{String(n).padStart(3, '0')}</span>}
    </div>
  );
}

// Quick package row used by several directions
function PkgHeader({ pkg, expanded, onClick }) {
  return (
    <div className="row gap-12" style={{ padding: '12px 14px', background: pkg.status === 'staged' ? 'var(--accent-soft)' : 'var(--cream-soft)', borderBottom: expanded ? '1px solid var(--line-faint)' : '0', cursor: 'pointer' }} onClick={onClick}>
      <span style={{ width: 16, color: 'var(--ink-3)' }}>{expanded ? I.chevD : I.chevR}</span>
      <span style={{ color: 'var(--ink-3)' }}>{I.pkg}</span>
      <div className="col grow">
        <div className="row gap-6">
          <b style={{ fontSize: 14 }}>{pkg.name}</b>
          <span className={'pill ' + (pkg.status === 'staged' ? 'staged' : 'owned')}>{pkg.status === 'staged' ? 'Staged · new' : 'Owned'}</span>
        </div>
        <span className="muted" style={{ fontSize: 12 }}>{pkg.tier} · {pkg.includes.length} included items · {pkg.extras.length} extra</span>
      </div>
      <div className="col" style={{ alignItems: 'flex-end' }}>
        <b className="tnum" style={{ fontSize: 14 }}>BD {pkg.price.toFixed(0)}</b>
        <span className="hand muted" style={{ fontSize: 13 }}>{pkg.status === 'staged' ? 'this session' : 'previous'}</span>
      </div>
    </div>
  );
}

// Make components global so other Babel files can use them.
Object.assign(window, {
  MOCK, totalOwned, totalStaged, totalGrand, totalPaid, totalDue,
  Icon, I, Topbar, SideRail, SketchArrow, Anno, Photo, PkgHeader,
});
