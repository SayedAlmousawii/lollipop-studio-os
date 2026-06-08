// Sales workspace — main page component.
// One unified, always-editable workspace. No "adjustment mode", no
// FINALIZED/DRAFT badges on packages, no "staged changes" panel. The
// workspace represents the customer's current live order; financial
// commits happen behind the scenes when the user collects or saves.

function fmt(n) {
  const sign = n < 0 ? '−' : '';
  return `${sign}BD ${Math.abs(n).toLocaleString()}`;
}
function fmtPositive(n) {
  return `BD ${Math.abs(n).toLocaleString()}`;
}

// ── Content tile (with optional progress bar) ─────────────────
function ContentTile({ icon, name, used, total, qty, sub }) {
  const showProgress = total != null;
  const pct = showProgress ? Math.min(100, used / total * 100) : 0;
  const over = showProgress && used > total;
  const IconCmp = Icon[icon] || Icon.Package;
  return (
    <div className="tile">
      <div className="ico"><IconCmp size={16} /></div>
      <div className="body">
        <div className="top">
          <span className="name">{name}</span>
          {showProgress ?
          <span className={'count' + (over ? ' over' : '')}>{used}/{total}</span> :
          <span className="count muted">×{qty}</span>}
        </div>
        {sub && <span className="sub">{sub}</span>}
        {showProgress &&
        <div className="bar">
            <div className={over ? 'over' : ''} style={{ width: pct + '%' }} />
          </div>
        }
      </div>
    </div>);

}

// ── Package card ──────────────────────────────────────────────
function PackageCard({ pkg, defaultOpen }) {
  const [open, setOpen] = React.useState(defaultOpen);
  return (
    <article className="pkg">
      <div className="pkg-head" onClick={() => setOpen(!open)} role="button" tabIndex={0}>
        <div className="thumb" style={{ background: pkg.thumbBg }}>
          <span className="tier-label">{pkg.tier}</span>
        </div>
        <div className="title-block">
          <h2>{pkg.name}</h2>
          <div className="meta">
            {pkg.sessionMeta}
            <span style={{ margin: '0 6px', color: 'var(--color-text-muted)' }}>·</span>
            {pkg.items.length} included items
            <span style={{ margin: '0 6px', color: 'var(--color-text-muted)' }}>·</span>
            {pkg.sessionDate}
          </div>
        </div>
        <div className="price">
          <div className="v">{fmtPositive(pkg.base)}</div>
          <div className="l">Base</div>
        </div>
        <div className="chev">
          {open ? <Icon.ChevronDown size={18} /> : <Icon.ChevronRight size={18} />}
        </div>
      </div>

      {open &&
      <div className="pkg-body">
          <div className="divider" />
          <div className="tiles">
            {pkg.items.map((it, i) => <ContentTile key={i} {...it} />)}
          </div>

          {pkg.customerNote &&
        <div className="note-row">
              <Icon.MessageSquare size={15} />
              <div>
                <div className="label">Customer note</div>
                <div className="text">{pkg.customerNote}</div>
              </div>
            </div>
        }

          <div className="pkg-actions">
            <button className="btn btn-outline btn-sm"><Icon.Sparkles size={14} />Upgrade tier</button>
            <button className="btn btn-outline btn-sm"><Icon.Replace size={14} />Swap package</button>
            <button className="btn btn-outline btn-sm"><Icon.BookOpen size={14} />Configure album</button>
            <button className="btn btn-outline btn-sm"><Icon.MessageSquare size={14} />Add note</button>
            <div className="spacer" />
            <button className="btn btn-destructive-ghost btn-sm">Remove</button>
          </div>
        </div>
      }
    </article>);

}

// ── Staged changes (right rail) ───────────────────────────────
function StagedChanges() {
  return (
    <section className="card">
      <div className="staged-head">
        <div className="staged-icon"><Icon.Replace size={16} /></div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3>Staged changes</h3>
          <div className="eyebrow" style={{ marginTop: 2 }}>{STAGED.length} pending · uncommitted</div>
        </div>
      </div>
      <div className="staged-list">
        {STAGED.map((s, i) =>
        <div key={i} className="staged-row">
            <span className={'sdot ' + s.tone} />
            <div className="body">
              <div className="t">{s.title}</div>
              {s.sub && <div className="s">{s.sub}</div>}
            </div>
            <span className={'amt ' + (s.amount > 0 ? 'up' : 'down')}>
              {s.amount > 0 ? '+' : '−'}BD {Math.abs(s.amount)}
            </span>
          </div>
        )}
      </div>
      <div className="card-foot">
        <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }}>
          Review &amp; commit <Icon.ChevronRight size={14} />
        </button>
      </div>
    </section>);

}

// ── Order summary (right rail) ────────────────────────────────
function OrderSummary() {
  const s = SUMMARY;
  return (
    <section className="card">
      <div className="card-head">
        <h3>Order summary</h3>
        <div style={{ flex: 1 }} />
        <span className="mono muted">{ORDER.ref}</span>
      </div>
      <div className="card-pad">
        <div className="summary-list">
          <div className="summary-row">
            <span className="l">Subtotal</span>
            <span className="v">{fmtPositive(s.subtotal)}</span>
          </div>
          <div className="summary-row muted">
            <span className="l">Package discount</span>
            <span className="v">{fmt(s.packageDiscount)}</span>
          </div>
          <div className="summary-row muted">
            <span className="l">Loyalty credit</span>
            <span className="v">{fmt(s.loyaltyCredit)}</span>
          </div>

          <div className="staged-eyebrow">Staged changes</div>
          <div className="staged-block">
            <div className="r">
              <span className="l">Previous total</span>
              <span className="v">{fmtPositive(s.previousTotal)}</span>
            </div>
            <div className="r delta">
              <span className="l">Pending delta</span>
              <span className="v">+BD {s.pendingDelta}</span>
            </div>
            <div className="r after">
              <span className="l">After commit</span>
              <span className="v">{fmtPositive(s.afterCommit)}</span>
            </div>
          </div>

          <div className="summary-row muted" style={{ marginTop: 10 }}>
            <span className="l">Deposit · 14 May</span>
            <span className="v">{fmt(s.deposit)}</span>
          </div>
          <div className="summary-row muted">
            <span className="l">Mid-payment · 02 Jun</span>
            <span className="v">{fmt(s.prevPayments)}</span>
          </div>
        </div>
      </div>
      <div className="collect-row">
        <div style={{ flex: 1 }}>
          <div className="amt">Remaining</div>
          <div className="v">{fmtPositive(s.remaining)}</div>
        </div>
        <button className="btn btn-primary btn-lg">
          <Icon.CreditCard size={15} />Collect
        </button>
      </div>
    </section>);

}

// ── Sticky bottom action bar ──────────────────────────────────
function ActionBar() {
  return (
    <div className="action-bar">
      <div className="adj-pill">
        <span className="dot" />
        <span>Adjustment mode</span>
      </div>
      <div className="staged-stat">
        <b>{STAGED.length} staged</b>
        <b className="delta">+BD {SUMMARY.pendingDelta}</b>
        <span className="muted">across {PACKAGES.length} packages</span>
      </div>
      <div style={{ flex: 1 }} />
      <span className="muted last-edit">Last edit · 2 min ago by Abrar</span>
      <button className="btn btn-outline"><Icon.Save size={14} />Save draft</button>
      <button className="btn btn-primary">
        Review &amp; commit <Icon.ChevronRight size={14} />
      </button>
    </div>);

}

// ── Page header ───────────────────────────────────────────────
function PageHeader() {
  return (
    <div className="page-hd">
      <div className="h-left">
        <div className="ref-row">
          <span className="ref">{ORDER.ref}</span>
          <span className="badge badge-warning">{ORDER.state}</span>
          <span className="badge badge-neutral">{ORDER.sessionType}</span>
        </div>
        <h1>{ORDER.customer.name}</h1>
        <div className="meta">
          <span className="m"><Icon.Calendar size={14} />{ORDER.sessionDate}</span>
          <span className="m"><Icon.Clock size={14} />{ORDER.duration}</span>
          <span className="m"><Icon.Camera size={14} />{ORDER.photographer}</span>
          <span className="m"><Icon.Phone size={14} /><span className="mono">{ORDER.customer.phone}</span></span>
        </div>
      </div>
    </div>);

}

// ── Tabs row ──────────────────────────────────────────────────
function TabsRow({ active, onChange }) {
  const tabs = [
  { id: 'composition', label: 'Composition', icon: 'Package', count: PACKAGES.length },
  { id: 'photo', label: 'Photo selection', icon: 'Image', count: 38 },
  { id: 'album', label: 'Album', icon: 'BookOpen', count: null },
  { id: 'notes', label: 'Notes', icon: 'MessageSquare', count: 4 },
  { id: 'payments', label: 'Payments', icon: 'CreditCard', count: null }];

  return (
    <div className="tabs-row">
      <div className="tabs">
        {tabs.map((t) => {
          const I = Icon[t.icon];
          return (
            <div key={t.id}
            className={'tab' + (active === t.id ? ' active' : '')}
            onClick={() => onChange(t.id)}>
              <I size={14} />
              <span>{t.label}</span>
              {t.count != null && <span className="count">{t.count}</span>}
            </div>);

        })}
      </div>
      <div className="tabs-actions">
        <button className="btn btn-outline btn-sm btn-timeline" title="Order timeline">
          <Icon.History size={14} />
          <span className="btn-timeline-label">Order timeline</span>
        </button>
        <button className="btn btn-dark btn-sm" style={{ padding: "0px 10px", gap: "6px", margin: "0px", width: "100px" }}>
          <Icon.Plus size={14} />Add package
        </button>
      </div>
    </div>);

}

// ── Composition tab body (left column content only) ──────────
function CompositionMain() {
  return (
    <div className="col-main">
      {PACKAGES.map((p, i) =>
      <PackageCard key={p.id} pkg={p} defaultOpen={i === 0} />
      )}
      <div className="add-row" role="button" tabIndex={0}>
        <Icon.Plus size={15} />
        <span>Add another package, add-on, or product</span>
      </div>
    </div>);

}

// ── Workspace root ────────────────────────────────────────────
function SalesWorkspace() {
  const [tab, setTab] = React.useState('album');
  return (
    <div className="app">
      <Sidebar activeKey="orders" />
      <div className="workspace">
        <Topbar orderRef={ORDER.ref} customer={ORDER.customer.name} />
        <div className="scroll">
          <div className="page">
            <div className="page-grid">
              <div className="page-left">
                <PageHeader />
                <TabsRow active={tab} onChange={setTab} />
                {tab === 'composition' && <CompositionMain />}
                {tab === 'photo' && <PhotoSelectionMain />}
                {tab === 'album' && <AlbumMain />}
                {tab !== 'composition' && tab !== 'photo' && tab !== 'album' &&
                <div className="card card-pad" style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--color-text-muted)' }}>
                    <Icon.Package size={28} />
                    <div style={{ marginTop: 12, fontSize: 14 }}>
                      The <b>{tab}</b> tab lives here. Composition and Photo selection are built
                      out at hi-fi — ask to mock the rest.
                    </div>
                  </div>
                }
              </div>
              <div className="page-rail">
                <StagedChanges />
                <OrderSummary />
              </div>
            </div>
          </div>
        </div>
        <ActionBar />
      </div>
    </div>);

}

window.SalesWorkspace = SalesWorkspace;