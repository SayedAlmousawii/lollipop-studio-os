// Direction A — Sales workspace, Composition tab on a finalized order
//
// Patterns lifted from the reference screenshot:
//   · Tabs at the top of the work area (Composition · Photo selection · Album · Notes)
//   · Package cards with thumbnail + status pill + base price
//   · 2-column grid of content tiles with progress bars (e.g. 32/40)
//   · Per-package action chips (Upgrade tier · Swap · Configure album · Remove)
//   · Right rail: Staged changes panel (semantic descriptions, not just $)
//     followed by Order summary card with a highlighted "Previous → Delta →
//     After commit" block.
//   · Bottom sticky bar with Adjustment mode pill + staged summary + Save
//     draft + Review & commit.
// Visual translation: dark walnut chrome stays on the side rail; the work
// area keeps the cream parchment palette of the Studio OS system; champagne
// accent replaces the reference's yellow CTA.

// ── Local mock for the Composition tab ─────────────────────────
const PACKAGES = [
  {
    id: 'pkg-1',
    name: 'Heritage Portrait — Full Day',
    tier: 'HERITAGE',
    state: 'finalized',
    sessionDate: '23 May 2026',
    sessionMeta: 'Family · 3hr session',
    base: 2480,
    thumb: 'linear-gradient(135deg, #b58c66 0%, #8a6446 60%, #4a3624 100%)',
    items: [
      { icon: I.pic,    name: 'Edited digital photos',  used: 32, total: 40 },
      { icon: I.album,  name: 'Fine-art prints',         used: 8,  total: 12, sub: '8×10 archival' },
      { icon: I.album,  name: 'Linen-bound album',       qty: 1,             sub: '30 pages · Walnut spine' },
      { icon: I.edit,   name: 'Retouching credits',      used: 9,  total: 15, sub: 'Advanced skin & color' },
      { icon: I.album,  name: 'Framed centerpiece',      qty: 1,             sub: '16×20 oak float frame' },
    ],
    customerNote: "Outdoor + studio combo. Bring grandmother's locket for hero shot.",
  },
  {
    id: 'pkg-2',
    name: 'Add-on · Newborn Mini',
    tier: 'ESSENTIALS',
    state: 'draft',
    sessionDate: '23 May 2026',
    sessionMeta: 'Studio · 45 min',
    base: 640,
    thumb: 'linear-gradient(135deg, #e4d6c4 0%, #b89e84 60%, #6f5d4a 100%)',
    items: [],
    customerNote: '',
  },
];

const STAGED = [
  { tone: 'info',   title: 'Heritage album → Atelier leather album', sub: 'Customer requested Italian leather, sage thread.', amount: +340 },
  { tone: 'accent', title: '+8 extra edited digital photos',         sub: 'From outdoor reel — Iris flagged 8 strong frames.', amount: +224 },
  { tone: 'accent', title: 'Gallery canvas 20×30',                   sub: 'Living room piece — hero family portrait.',         amount: +285 },
  { tone: 'ok',     title: 'Loyalty credit applied',                 sub: '',                                                   amount: -120 },
];

const SUMMARY = {
  ref: 'STU-2026-0418',
  subtotal: 3120,
  packageDiscount: -180,
  loyaltyCredit: -120,
  previousTotal: 2820,
  pendingDelta: +729,
  afterCommit: 3549,
  deposit: -1200,
  prevPayments: -800,
  remaining: 2563.84,
};

// ── Content tile (with optional progress bar) ──────────────────
function ContentTile({ icon, name, used, total, qty, sub }) {
  const showProgress = total != null;
  const pct = showProgress ? Math.min(100, (used / total) * 100) : 0;
  const over = showProgress && used > total;
  return (
    <div className="sk-box" style={{ padding: 12, background: 'var(--paper)', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
      <div style={{ width: 36, height: 36, display: 'grid', placeItems: 'center', background: 'var(--cream-soft)', borderRadius: 8, flexShrink: 0, color: 'var(--ink-3)', border: '1px solid var(--line-faint)' }}>
        {icon}
      </div>
      <div className="col grow" style={{ minWidth: 0, gap: 3 }}>
        <div className="row gap-6">
          <b style={{ fontSize: 13 }}>{name}</b>
          <span className="grow" />
          {showProgress
            ? <span className="tnum" style={{ fontSize: 12, fontWeight: 600, color: over ? 'var(--accent-dark)' : 'var(--ink-2)' }}>{used}/{total}</span>
            : <span className="tnum muted" style={{ fontSize: 12 }}>×{qty}</span>
          }
        </div>
        {sub && <span className="muted" style={{ fontSize: 11 }}>{sub}</span>}
        {showProgress && (
          <div style={{ marginTop: 4, height: 4, borderRadius: 9999, background: 'var(--cream-soft)', overflow: 'hidden', border: '1px solid var(--line-faint)' }}>
            <div style={{ width: pct + '%', height: '100%', background: over ? 'var(--accent-dark)' : 'var(--accent)' }} />
          </div>
        )}
      </div>
    </div>
  );
}

// ── Package card ────────────────────────────────────────────────
function PackageCard({ pkg, expanded }) {
  const statePill = {
    finalized: { cls: 'ok',     icon: I.lock, label: 'FINALIZED' },
    draft:     { cls: 'info',   icon: I.edit, label: 'DRAFT' },
    staged:    { cls: 'staged', icon: I.plus, label: 'STAGED' },
  }[pkg.state];

  return (
    <div className="panel" style={{ background: 'var(--paper)' }}>
      <div className="row gap-16" style={{ padding: 14, alignItems: 'center' }}>
        {/* Thumbnail */}
        <div style={{
          width: 84, height: 84, borderRadius: 10,
          background: pkg.thumb || 'var(--cream-soft)',
          border: '1px solid var(--line-faint)',
          display: 'flex', alignItems: 'flex-end', justifyContent: 'flex-start',
          flexShrink: 0, position: 'relative',
        }}>
          <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.16em', color: '#fff', textShadow: '0 1px 2px rgba(0,0,0,0.4)', padding: '6px 8px' }}>{pkg.tier}</span>
        </div>
        <div className="col grow" style={{ minWidth: 0 }}>
          <div className="row gap-8" style={{ marginBottom: 2 }}>
            <span className={'pill ' + statePill.cls} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              {statePill.icon}<span>{statePill.label}</span>
            </span>
            <span className="muted" style={{ fontSize: 12 }}>{pkg.sessionMeta}</span>
          </div>
          <b style={{ fontSize: 19, lineHeight: 1.25 }}>{pkg.name}</b>
          <span className="muted" style={{ fontSize: 12, marginTop: 2 }}>{pkg.items.length} included item{pkg.items.length === 1 ? '' : 's'}<span style={{ margin: '0 6px' }}>·</span>{pkg.sessionDate}</span>
        </div>
        <div className="col" style={{ alignItems: 'flex-end' }}>
          <b className="tnum" style={{ fontSize: 24 }}>BD {pkg.base.toLocaleString()}</b>
          <span className="eyebrow">BASE</span>
        </div>
        <span style={{ color: 'var(--ink-3)', marginLeft: 4 }}>{expanded ? I.chevD : I.chevR}</span>
      </div>

      {expanded && pkg.items.length > 0 && (
        <div className="col gap-12" style={{ padding: '0 14px 14px' }}>
          <div className="hr" />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
            {pkg.items.map((item, i) => <ContentTile key={i} {...item} />)}
          </div>
          {pkg.customerNote && (
            <div className="sk-box" style={{ padding: 12, display: 'flex', gap: 10, alignItems: 'flex-start', background: 'var(--cream-soft)' }}>
              <span style={{ color: 'var(--ink-3)', marginTop: 2, flexShrink: 0 }}>{I.note}</span>
              <div className="col" style={{ gap: 2 }}>
                <span className="eyebrow">Customer note</span>
                <span style={{ fontSize: 13 }}>{pkg.customerNote}</span>
              </div>
            </div>
          )}
          <div className="row gap-8" style={{ flexWrap: 'wrap' }}>
            <button className="btn sm">✨<span style={{ marginLeft: 4 }}>Upgrade tier</span></button>
            <button className="btn sm">{I.swap}<span style={{ marginLeft: 4 }}>Swap package</span></button>
            <button className="btn sm">{I.album}<span style={{ marginLeft: 4 }}>Configure album</span></button>
            <div className="grow" />
            <button className="btn sm ghost" style={{ color: 'var(--bad)' }}>Remove</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Staged-changes row ─────────────────────────────────────────
function StagedChangeRow({ tone, title, sub, amount, last }) {
  return (
    <div className="row gap-10" style={{ padding: '12px 14px', borderTop: '1px solid var(--line-faint)', alignItems: 'flex-start' }}>
      <span className={'dot ' + tone} style={{ marginTop: 7, flexShrink: 0, width: 9, height: 9 }} />
      <div className="col grow" style={{ gap: 2, minWidth: 0 }}>
        <span style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.3 }}>{title}</span>
        {sub && <span className="muted" style={{ fontSize: 12, lineHeight: 1.3 }}>{sub}</span>}
      </div>
      <span className="tnum" style={{ fontSize: 13, fontWeight: 700, color: amount > 0 ? 'var(--ink)' : 'var(--ok)', whiteSpace: 'nowrap', marginTop: 2 }}>
        {amount > 0 ? '+' : '−'}BD {Math.abs(amount).toFixed(0)}
      </span>
    </div>
  );
}

// ── DirA ──────────────────────────────────────────────────────
function DirA() {
  return (
    <div className="wf" style={{ display: 'flex', paddingBottom: 76 }}>
      <SideRail active="sales" />

      <div className="row grow" style={{ minWidth: 0, alignItems: 'stretch' }}>

        {/* ── MAIN WORK AREA ─────────────────────────────── */}
        <div className="col grow" style={{ minWidth: 0, background: 'var(--cream)' }}>
          <Topbar />

          {/* Tabs */}
          <div className="row" style={{ borderBottom: '1px solid var(--line-faint)', background: 'var(--paper)', paddingRight: 20 }}>
            <div className="tabs" style={{ borderBottom: 0, paddingLeft: 20 }}>
              <div className="tab active">{I.pkg}<span style={{ marginLeft: 6 }}>Composition</span><span className="count">2</span></div>
              <div className="tab">{I.pic}<span style={{ marginLeft: 6 }}>Photo selection</span><span className="count">32</span></div>
              <div className="tab">{I.album}<span style={{ marginLeft: 6 }}>Album</span></div>
              <div className="tab">{I.note}<span style={{ marginLeft: 6 }}>Notes</span><span className="count">4</span></div>
            </div>
            <div className="grow" />
            <div className="row gap-6" style={{ alignSelf: 'center', fontSize: 12, color: 'var(--ink-3)' }}>
              <span className="sk-box mono" style={{ padding: '2px 6px', fontSize: 11, background: 'var(--cream-soft)' }}>⌥</span>
              <span>+</span>
              <span className="sk-box mono" style={{ padding: '2px 6px', fontSize: 11, background: 'var(--cream-soft)' }}>P</span>
              <span>quick package</span>
            </div>
          </div>

          {/* Scrollable content */}
          <div className="col" style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden' }}>
            <div className="col gap-16" style={{ padding: '20px 24px' }}>

              {/* Page header */}
              <div className="row gap-16" style={{ alignItems: 'flex-end' }}>
                <div className="col">
                  <h1 style={{ margin: 0, fontSize: 26, fontFamily: 'var(--font-script), var(--sans)', fontWeight: 600, letterSpacing: '0.005em' }}>Package composition</h1>
                  <span className="muted" style={{ fontSize: 13, marginTop: 2 }}>Editing finalized order — changes will be staged for review.</span>
                </div>
                <div className="grow" />
                <button className="btn accent">{I.plus}<span style={{ marginLeft: 4 }}>Add package or product</span></button>
              </div>

              {/* Package cards */}
              <PackageCard pkg={PACKAGES[0]} expanded={true} />
              <PackageCard pkg={PACKAGES[1]} expanded={false} />

              {/* Add-another CTA (dashed) */}
              <div style={{ border: '1.5px dashed var(--line-soft)', borderRadius: 12, padding: '18px 14px', textAlign: 'center', color: 'var(--ink-3)', background: 'transparent' }}>
                <span style={{ marginRight: 6, color: 'var(--ink-3)' }}>{I.plus}</span>
                Add another package, add-on, or product
              </div>

            </div>
          </div>
        </div>

        {/* ── RIGHT RAIL ─────────────────────────────────── */}
        <div className="col gap-16" style={{ width: 380, flexShrink: 0, padding: 16, background: 'var(--cream-soft)', borderLeft: '1px solid var(--line-faint)', overflowY: 'auto' }}>

          {/* Staged changes */}
          <div className="panel" style={{ background: 'var(--paper)' }}>
            <div className="row gap-10" style={{ padding: 14, alignItems: 'flex-start' }}>
              <div style={{ width: 36, height: 36, borderRadius: 9, background: 'var(--accent-soft)', display: 'grid', placeItems: 'center', color: 'var(--accent-dark)', flexShrink: 0 }}>
                {I.swap}
              </div>
              <div className="col grow">
                <b style={{ fontSize: 15 }}>Staged changes</b>
                <span className="eyebrow" style={{ marginTop: 2 }}>{STAGED.length} pending · uncommitted</span>
              </div>
            </div>
            {STAGED.map((s, i) => <StagedChangeRow key={i} {...s} />)}
            <div style={{ padding: 12, borderTop: '1px solid var(--line-faint)', background: 'var(--cream-soft)' }}>
              <button className="btn accent" style={{ width: '100%', justifyContent: 'center', padding: '10px 12px' }}>
                Review & commit <span style={{ marginLeft: 4 }}>→</span>
              </button>
            </div>
          </div>

          {/* Order summary */}
          <div className="panel" style={{ background: 'var(--paper)' }}>
            <div className="row gap-8" style={{ padding: '12px 14px', borderBottom: '1px solid var(--line-faint)' }}>
              <b style={{ fontSize: 14 }}>Order summary</b>
              <span className="grow" />
              <span className="mono muted" style={{ fontSize: 11 }}>{SUMMARY.ref}</span>
            </div>

            <div className="col" style={{ padding: '12px 14px', gap: 4, fontSize: 13 }}>
              <div className="row"><span>Subtotal</span><span className="grow" /><span className="tnum">BD {SUMMARY.subtotal.toLocaleString()}</span></div>
              <div className="row"><span className="muted">Package discount</span><span className="grow" /><span className="tnum muted">− BD {Math.abs(SUMMARY.packageDiscount)}</span></div>
              <div className="row"><span className="muted">Loyalty credit</span><span className="grow" /><span className="tnum muted">− BD {Math.abs(SUMMARY.loyaltyCredit)}</span></div>

              <div style={{ alignSelf: 'center', marginTop: 12 }}>
                <span className="eyebrow">Staged changes</span>
              </div>
              <div className="sk-box" style={{ padding: 12, background: 'var(--accent-soft)', borderColor: 'var(--accent)', marginTop: 4 }}>
                <div className="row"><span>Previous total</span><span className="grow" /><span className="tnum">BD {SUMMARY.previousTotal.toLocaleString()}</span></div>
                <div className="row" style={{ color: 'var(--accent-dark)', marginTop: 4 }}><span>Pending delta</span><span className="grow" /><span className="tnum" style={{ fontWeight: 600 }}>+BD {SUMMARY.pendingDelta}</span></div>
                <div className="row" style={{ marginTop: 8, paddingTop: 8, borderTop: '1px dashed var(--accent-dark)', alignItems: 'baseline' }}>
                  <span style={{ fontWeight: 600 }}>After commit</span>
                  <span className="grow" />
                  <b className="tnum" style={{ fontSize: 22 }}>BD {SUMMARY.afterCommit.toLocaleString()}</b>
                </div>
              </div>

              <div className="row" style={{ marginTop: 10 }}><span className="muted">Deposit</span><span className="grow" /><span className="tnum muted">− BD {Math.abs(SUMMARY.deposit).toLocaleString()}</span></div>
              <div className="row"><span className="muted">Previous payments</span><span className="grow" /><span className="tnum muted">− BD {Math.abs(SUMMARY.prevPayments)}</span></div>
            </div>

            <div className="row" style={{ padding: 14, background: 'var(--cream-soft)', borderTop: '1px solid var(--line-faint)', alignItems: 'flex-end', gap: 12 }}>
              <div className="col grow">
                <span className="eyebrow">Remaining balance</span>
                <b className="tnum" style={{ fontSize: 24 }}>BD {SUMMARY.remaining.toLocaleString(undefined, { minimumFractionDigits: 2 })}</b>
              </div>
              <button className="btn accent">{I.cash}<span style={{ marginLeft: 4 }}>Collect</span></button>
            </div>
          </div>

        </div>
      </div>

      {/* ── Sticky bottom action bar ─────────────────────────── */}
      <div className="row gap-16" style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 76, padding: '0 24px', background: 'var(--paper)', borderTop: '1px solid var(--line)', boxShadow: '0 -8px 24px rgba(31,31,31,0.05)', zIndex: 2, alignItems: 'center' }}>
        <div className="row gap-8" style={{ padding: '8px 14px', background: 'var(--accent-soft)', borderRadius: 9999, border: '1px solid var(--accent)' }}>
          <span className="dot accent" />
          <span className="eyebrow" style={{ color: 'var(--accent-dark)' }}>Adjustment mode</span>
        </div>
        <div className="row gap-6" style={{ alignItems: 'baseline' }}>
          <b style={{ fontSize: 15 }}>{STAGED.length} staged</b>
          <b className="tnum" style={{ fontSize: 17, color: 'var(--accent-dark)' }}>+BD {SUMMARY.pendingDelta}</b>
        </div>
        <span className="muted" style={{ fontSize: 12 }}>across {PACKAGES.length} packages</span>
        <div className="grow" />
        <span className="muted" style={{ fontSize: 12 }}>Last edit · 2 min ago by Abrar</span>
        <button className="btn">Save draft</button>
        <button className="btn accent">Review & commit <span style={{ marginLeft: 4 }}>→</span></button>
      </div>

      <Anno x={520} y={282} w={170} arrow={{ x: 620, y: 320 }}>
        progress bars give "used / included" at a glance — no need to expand
      </Anno>
      <Anno x={1090} y={520} w={170} arrow={{ x: 1180, y: 560 }}>
        staged-changes panel uses semantic descriptions, not bare $ deltas
      </Anno>
      <Anno x={220} y={920} w={210} arrow={{ x: 380, y: 940 }}>
        adjustment-mode pill makes the staff aware they're editing a finalized order
      </Anno>
    </div>
  );
}

window.DirA = DirA;
