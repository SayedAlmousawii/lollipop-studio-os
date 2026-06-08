// Photo Selection tab — package-scoped post-session photo picks.
// Each package owns its own selection state: included allowance, chosen
// photo IDs, extras (digital/print/split), editing guidance, and any
// pending unsaved edits. The right rail (StagedChanges + OrderSummary)
// continues to show order-wide context.

// ── Status meta ──────────────────────────────────────────────
const PHOTO_STATUS = {
  'not-started':        { label: 'Not started',         badge: 'badge-neutral' },
  'in-progress':        { label: 'In progress',         badge: 'badge-info' },
  'needs-confirmation': { label: 'Needs confirmation',  badge: 'badge-warning' },
  'completed':          { label: 'Selection complete',  badge: 'badge-success' },
};

// ── Per-package selection state ──────────────────────────────
const PHOTO_SELECTION = {
  'pkg-1': {
    status: 'in-progress',
    selected: [
      'IMG_0012','IMG_0014','IMG_0015','IMG_0019','IMG_0023','IMG_0028',
      'IMG_0031','IMG_0037','IMG_0040','IMG_0042','IMG_0045','IMG_0048',
      'IMG_0051','IMG_0055','IMG_0058','IMG_0061','IMG_0064','IMG_0067',
      'IMG_0071','IMG_0073','IMG_0076','IMG_0079','IMG_0082','IMG_0085',
      'IMG_0088','IMG_0091','IMG_0094','IMG_0097','IMG_0101','IMG_0104',
      'IMG_0107','IMG_0110',
    ],
    newlyAdded: ['IMG_0094','IMG_0097','IMG_0101','IMG_0104'],
    extras: {
      mode: 'split',          // 'digital' | 'print' | 'split'
      digitalCount: 4,
      digitalPrice: 8,
      printCount: 2,
      printPrice: 12,
    },
    customerNotes:
      "Warm, golden tones throughout. Keep skin natural — no heavy smoothing. " +
      "Outdoor reel is the family's favourite — prioritise those for the album hero.",
    photographerNote:
      "Outdoor reel (IMG_0070 onward) has the strongest expressions. " +
      "Hero candidate: IMG_0079 with grandmother's locket.",
    guidance: [
      { k: 'Skin retouching', v: 'Light · blemish removal only' },
      { k: 'Background',      v: 'Keep studio cream · no replacement' },
      { k: 'Crop',            v: 'Loose · breathing room around subject' },
      { k: 'Color grade',     v: 'Warm · golden · soft contrast' },
      { k: 'B&W versions',    v: 'Include 6 · editor\u2019s choice' },
      { k: 'Delivery',        v: 'JPEG 4K · 300 dpi for prints' },
    ],
    pending: [
      { tone: 'accent', label: 'Added 6 extras',         sub: '2 print · 4 digital',                       amount: +56 },
      { tone: 'info',   label: 'Extras mode → split',    sub: 'was: digital only' },
      { tone: 'accent', label: 'Added 4 photo IDs',      sub: 'IMG_0094 · IMG_0097 · IMG_0101 · IMG_0104' },
    ],
  },
  'pkg-2': {
    status: 'not-started',
    selected: [],
    newlyAdded: [],
    extras: { mode: 'digital', digitalCount: 0, digitalPrice: 8, printCount: 0, printPrice: 12 },
    customerNotes: '',
    photographerNote: '',
    guidance: [],
    pending: [],
  },
};

// ── Helpers ──────────────────────────────────────────────────
function ps_fmt(n) { return `BD ${Math.abs(n).toLocaleString()}`; }
function ps_fmtSigned(n) {
  if (n === 0) return 'BD 0';
  return (n > 0 ? '+BD ' : '−BD ') + Math.abs(n).toLocaleString();
}
function ps_extrasCount(e) {
  if (e.mode === 'digital') return e.digitalCount;
  if (e.mode === 'print')   return e.printCount;
  return e.digitalCount + e.printCount;
}
function ps_extrasTotal(e) {
  if (e.mode === 'digital') return e.digitalCount * e.digitalPrice;
  if (e.mode === 'print')   return e.printCount   * e.printPrice;
  return e.digitalCount * e.digitalPrice + e.printCount * e.printPrice;
}
function ps_includedFor(pkg) {
  const it = pkg.items.find(i => i.icon === 'Image');
  return it ? it.total : 0;
}

// ── Eyebrow / section title ──────────────────────────────────
function PSSection({ eyebrow, count, action, children }) {
  return (
    <div className="ps-section">
      <div className="ps-section-head">
        <span className="eyebrow">{eyebrow}</span>
        {count != null && <span className="ps-section-count">{count}</span>}
        <span className="ps-section-line" />
        {action}
      </div>
      {children}
    </div>);
}

// ── Allowance meter + stat strip ─────────────────────────────
function AllowanceBlock({ included, selected, extras, extrasPrice }) {
  const within = Math.min(selected, included);
  const remaining = Math.max(0, included - selected);
  const over = Math.max(0, selected - included);
  const fillPct = included === 0 ? 0 : Math.min(100, (within / included) * 100);
  const overPct = included === 0 ? 0 : Math.min(100, (over / included) * 100);
  // For the meter, the included region (full width minus the optional extras
  // appendage) reflects the package allowance; the small appendage on the
  // right shows reserved extras as a separate region.
  return (
    <div className="ps-allowance">
      <div className="ps-meter-row">
        <div className="ps-meter">
          <div className="ps-meter-fill" style={{ width: fillPct + '%' }} />
          {over > 0 &&
            <div className="ps-meter-over" style={{ width: overPct + '%', left: '100%' }} />}
        </div>
        {extras > 0 &&
          <div className="ps-meter-extras" title={extras + ' extras reserved'}>
            <div className="ps-meter-extras-fill" />
            <span className="ps-meter-extras-label">+{extras}</span>
          </div>}
      </div>
      <div className="ps-stats">
        <div className="ps-stat">
          <div className="k">Included</div>
          <div className="v">{included}</div>
          <div className="s">Package allowance</div>
        </div>
        <div className="ps-stat">
          <div className="k">Selected</div>
          <div className="v">{selected}</div>
          <div className="s">Photo IDs recorded</div>
        </div>
        <div className="ps-stat">
          <div className="k">Remaining</div>
          <div className={'v' + (remaining === 0 && !over ? ' is-zero' : '')}>{remaining}</div>
          <div className="s">{over > 0 ? `${over} over allowance` : 'Within allowance'}</div>
        </div>
        <div className={'ps-stat is-extras' + (extras === 0 ? ' is-muted' : '')}>
          <div className="k">Extras</div>
          <div className="v">{extras > 0 ? '+' + extras : '0'}</div>
          <div className="s">{extras > 0 ? ps_fmtSigned(extrasPrice) : 'No extras'}</div>
        </div>
      </div>
    </div>);
}

// ── Photo ID chips ───────────────────────────────────────────
function PhotoIdChips({ ids, newlyAdded }) {
  const [expanded, setExpanded] = React.useState(false);
  const VISIBLE = 14;
  const overflow = Math.max(0, ids.length - VISIBLE);
  const show = expanded ? ids : ids.slice(0, VISIBLE);
  const newSet = new Set(newlyAdded || []);
  return (
    <div className="ps-chips">
      {show.map((id) =>
        <span key={id} className={'ps-chip' + (newSet.has(id) ? ' is-new' : '')}>
          <span className="id">{id}</span>
          <button className="x" aria-label="Remove"><Icon.X size={12} /></button>
        </span>)}
      {overflow > 0 && !expanded &&
        <button className="ps-chip-more" onClick={() => setExpanded(true)}>
          +{overflow} more
        </button>}
      {expanded && ids.length > VISIBLE &&
        <button className="ps-chip-more" onClick={() => setExpanded(false)}>
          Collapse
        </button>}
      <button className="ps-chip-add">
        <Icon.Plus size={12} /> Add ID
      </button>
    </div>);
}

// ── Stepper ──────────────────────────────────────────────────
function Stepper({ value, onChange, min = 0, disabled }) {
  return (
    <div className={'ps-stepper' + (disabled ? ' is-disabled' : '')}>
      <button disabled={disabled || value <= min} onClick={() => onChange(value - 1)}>−</button>
      <span className="v">{value}</span>
      <button disabled={disabled} onClick={() => onChange(value + 1)}>+</button>
    </div>);
}

// ── Extras block (mode + steppers + math) ────────────────────
function ExtrasBlock({ extras: initial }) {
  const [extras, setExtras] = React.useState(initial);
  const setMode = (mode) => setExtras({ ...extras, mode });
  const setDigital = (digitalCount) => setExtras({ ...extras, digitalCount: Math.max(0, digitalCount) });
  const setPrint   = (printCount)   => setExtras({ ...extras, printCount:   Math.max(0, printCount) });

  const showDigital = extras.mode === 'digital' || extras.mode === 'split';
  const showPrint   = extras.mode === 'print'   || extras.mode === 'split';

  const digSubtotal = extras.digitalCount * extras.digitalPrice;
  const prtSubtotal = extras.printCount   * extras.printPrice;
  const totalCount  = ps_extrasCount(extras);
  const totalPrice  = ps_extrasTotal(extras);

  return (
    <div className="ps-extras">
      <div className="ps-mode">
        <button className={'ps-mode-btn' + (extras.mode === 'digital' ? ' active' : '')} onClick={() => setMode('digital')}>
          <Icon.Monitor size={14} /> Digital only
        </button>
        <button className={'ps-mode-btn' + (extras.mode === 'print' ? ' active' : '')} onClick={() => setMode('print')}>
          <Icon.Printer size={14} /> Print only
        </button>
        <button className={'ps-mode-btn' + (extras.mode === 'split' ? ' active' : '')} onClick={() => setMode('split')}>
          <Icon.Replace size={14} /> Split mix
        </button>
      </div>

      <div className="ps-extra-rows">
        {showDigital &&
          <div className="ps-extra-row">
            <div className="ico"><Icon.Monitor size={16} /></div>
            <div className="label-block">
              <div className="nm">Digital extras</div>
              <div className="sub">JPEG 4K · delivered via WeTransfer · {ps_fmt(extras.digitalPrice)} each</div>
            </div>
            <Stepper value={extras.digitalCount} onChange={setDigital} />
            <div className="price">
              <div className="v">{ps_fmt(digSubtotal)}</div>
              <div className="l">{extras.digitalCount} × {ps_fmt(extras.digitalPrice)}</div>
            </div>
          </div>}
        {showPrint &&
          <div className="ps-extra-row">
            <div className="ico"><Icon.Printer size={16} /></div>
            <div className="label-block">
              <div className="nm">Print extras</div>
              <div className="sub">8 × 10 archival · matte finish · {ps_fmt(extras.printPrice)} each</div>
            </div>
            <Stepper value={extras.printCount} onChange={setPrint} />
            <div className="price">
              <div className="v">{ps_fmt(prtSubtotal)}</div>
              <div className="l">{extras.printCount} × {ps_fmt(extras.printPrice)}</div>
            </div>
          </div>}
      </div>

      <div className="ps-extras-total">
        <div className="l">
          <Icon.Tag size={13} /> Extras total
          <span className="mutedish">· {totalCount} {totalCount === 1 ? 'photo' : 'photos'}</span>
        </div>
        <div className="v">{totalPrice === 0 ? 'BD 0' : '+' + ps_fmt(totalPrice)}</div>
      </div>
    </div>);
}

// ── Card head ────────────────────────────────────────────────
function CardHead({ pkg, sel, status, selected, included, extrasCount }) {
  return (
    <div className="ps-head">
      <div className="thumb" style={{ background: pkg.thumbBg }}>
        <span className="tier-label">{pkg.tier}</span>
      </div>
      <div className="titlewrap">
        <h2>
          {pkg.name}
          <span className={'badge ' + status.badge}>{status.label}</span>
        </h2>
        <div className="meta">
          {pkg.sessionMeta}
          <span className="dot">·</span>
          {pkg.sessionDate}
          <span className="dot">·</span>
          <span className="mono">{pkg.id.toUpperCase()}</span>
        </div>
      </div>
      <div className="right">
        <div className="col">
          <div className="key">Selected</div>
          <div className="val">
            <span className={selected > included ? 'accent' : ''}>{selected}</span>
            <span className="dim">/{included}</span>
          </div>
        </div>
        <div className="col">
          <div className="key">Extras</div>
          <div className="val accent">{extrasCount > 0 ? '+' + extrasCount : '—'}</div>
        </div>
      </div>
    </div>);
}

// ── Pending band ─────────────────────────────────────────────
function PendingBand({ items }) {
  if (!items || items.length === 0) return null;
  const total = items.reduce((s, i) => s + (i.amount || 0), 0);
  return (
    <div className="ps-pending">
      <div className="ico"><Icon.History size={14} /></div>
      <div className="body">
        <div className="row1">
          <span className="label">Pending · {items.length} {items.length === 1 ? 'edit' : 'edits'}</span>
          {total !== 0 && <span className="amt">{ps_fmtSigned(total)}</span>}
          <span className="muted-small">uncommitted on this package</span>
        </div>
        <div className="list">
          {items.map((it, i) =>
            <span key={i} className="item">
              <span className={'kind ' + it.tone} />
              <span className="t">{it.label}</span>
              {it.sub && <span className="s">{it.sub}</span>}
            </span>)}
        </div>
      </div>
      <button className="btn btn-outline btn-sm">View diff</button>
    </div>);
}

// ── Empty (not-started) card body ───────────────────────────
function NotStartedBody({ included }) {
  return (
    <div className="ps-empty">
      <div className="ico"><Icon.Image size={22} /></div>
      <div className="title">Selection hasn't started yet</div>
      <div className="sub">
        Begin once the customer has reviewed the gallery. {included} edited photos are included
        in this package — extras can be added on top once the picks land.
      </div>
      <div className="actions">
        <button className="btn btn-primary btn-sm"><Icon.Plus size={14} />Begin selection</button>
        <button className="btn btn-outline btn-sm"><Icon.MessageSquare size={14} />Add editing notes</button>
      </div>
    </div>);
}

// ── Per-package selection card ───────────────────────────────
function PhotoSelectionCard({ pkg, sel }) {
  const status = PHOTO_STATUS[sel.status];
  const included    = ps_includedFor(pkg);
  const selected    = sel.selected.length;
  const extrasCount = ps_extrasCount(sel.extras);
  const extrasPrice = ps_extrasTotal(sel.extras);

  if (sel.status === 'not-started') {
    return (
      <article className="ps-card is-not-started">
        <CardHead pkg={pkg} sel={sel} status={status}
                  selected={selected} included={included} extrasCount={extrasCount} />
        <NotStartedBody included={included} />
      </article>);
  }

  return (
    <article className={'ps-card is-' + sel.status}>
      <CardHead pkg={pkg} sel={sel} status={status}
                selected={selected} included={included} extrasCount={extrasCount} />

      <PSSection eyebrow="Allowance">
        <AllowanceBlock
          included={included}
          selected={selected}
          extras={extrasCount}
          extrasPrice={extrasPrice} />
      </PSSection>

      <PSSection
        eyebrow="Selected photo IDs"
        count={selected + ' picked'}
        action={
          <button className="btn btn-ghost btn-sm"><Icon.Edit size={12} />Bulk paste</button>
        }>
        <PhotoIdChips ids={sel.selected} newlyAdded={sel.newlyAdded} />
      </PSSection>

      <PSSection
        eyebrow="Extras beyond allowance"
        action={
          extrasPrice > 0 &&
          <span className="ps-section-side">
            <Icon.Tag size={12} />
            {extrasCount} {extrasCount === 1 ? 'extra' : 'extras'}
            <b>+{ps_fmt(extrasPrice)}</b>
          </span>
        }>
        <ExtrasBlock extras={sel.extras} />
      </PSSection>

      <PSSection
        eyebrow="Editing guidance"
        action={
          <button className="btn btn-ghost btn-sm"><Icon.Plus size={12} />Add field</button>
        }>
        {sel.customerNotes &&
          <div className="ps-note">
            <Icon.MessageSquare size={14} />
            <div className="body">
              <div className="label">Customer note</div>
              <div className="text">{sel.customerNotes}</div>
            </div>
          </div>}
        {sel.photographerNote &&
          <div className="ps-note ps-note-alt">
            <Icon.Camera size={14} />
            <div className="body">
              <div className="label">Photographer note · Maya Hassan</div>
              <div className="text">{sel.photographerNote}</div>
            </div>
          </div>}
        {sel.guidance.length > 0 &&
          <div className="ps-guidance">
            {sel.guidance.map((g, i) =>
              <div key={i} className="ps-guidance-row">
                <div className="k">{g.k}</div>
                <div className="v">{g.v}</div>
              </div>)}
          </div>}
      </PSSection>

      <PendingBand items={sel.pending} />
    </article>);
}

// ── Tab header summary (above the cards) ────────────────────
function PhotoTabHeader({ packages, selection }) {
  let totalSelected = 0, totalIncluded = 0, totalExtras = 0, totalExtraPrice = 0;
  packages.forEach((p) => {
    const s = selection[p.id] || { selected: [], extras: { mode:'digital', digitalCount:0, printCount:0, digitalPrice:0, printPrice:0 } };
    totalSelected   += s.selected.length;
    totalIncluded   += ps_includedFor(p);
    totalExtras     += ps_extrasCount(s.extras);
    totalExtraPrice += ps_extrasTotal(s.extras);
  });
  return (
    <div className="ps-header-bar">
      <div className="ps-header-icon"><Icon.Image size={18} /></div>
      <div className="text-block">
        <h2>Photo selection</h2>
        <div className="sub">
          Customer's picks, extras, and editing guidance — managed separately per package.
        </div>
      </div>
      <div className="tally">
        <div className="col">
          <div className="k">Selected</div>
          <div className="v">{totalSelected}<span className="dim">/{totalIncluded}</span></div>
        </div>
        <div className="col">
          <div className="k">Extras</div>
          <div className="v accent">{totalExtras > 0 ? '+' + totalExtras : '—'}</div>
        </div>
        <div className="col">
          <div className="k">Impact</div>
          <div className="v accent">{totalExtraPrice === 0 ? 'BD 0' : '+' + ps_fmt(totalExtraPrice)}</div>
        </div>
      </div>
      <div className="ps-header-actions">
        <button className="btn btn-outline btn-sm"><Icon.FileText size={14} />Export ID list</button>
        <button className="btn btn-dark btn-sm"><Icon.Check size={14} />Confirm all</button>
      </div>
    </div>);
}

// ── Photo Selection main body (replaces CompositionMain for this tab) ──
function PhotoSelectionMain() {
  return (
    <div className="col-main">
      <PhotoTabHeader packages={PACKAGES} selection={PHOTO_SELECTION} />
      {PACKAGES.map((p) =>
        <PhotoSelectionCard key={p.id} pkg={p} sel={PHOTO_SELECTION[p.id]} />)}
      <div className="ps-foot-note">
        <Icon.MessageSquare size={13} />
        Album layout and cover are configured in the <b>Album</b> tab — these picks feed into it.
      </div>
    </div>);
}

window.PhotoSelectionMain = PhotoSelectionMain;
