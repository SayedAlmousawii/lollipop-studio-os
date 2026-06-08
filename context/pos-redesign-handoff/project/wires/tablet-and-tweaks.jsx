// Tablet + supporting sketches — quick studies of how the workspace
// compresses to iPad-portrait and shows secondary states (locked order,
// payment moment, edge-case "very large" order).

// ── Tablet portrait — Direction A compressed ───────────────────
function TabletA() {
  return (
    <div className="wf col" style={{ fontSize: 12 }}>
      <Topbar compact />
      <div className="row gap-8" style={{ padding: '10px 14px', borderBottom: '1px solid var(--line-faint)', background: 'var(--paper)' }}>
        <b style={{ fontSize: 15 }}>{MOCK.order.customer.name}</b>
        <span className="muted">·</span><span className="muted">{MOCK.order.session}</span>
        <div className="grow" />
        <span className="pill warn">Selection</span>
      </div>

      <div className="tabs" style={{ paddingLeft: 14, paddingRight: 14 }}>
        <div className="tab active">Order</div>
        <div className="tab">Photos<span className="count">14</span></div>
        <div className="tab">Pay<span className="count">120</span></div>
      </div>

      <div className="col gap-12" style={{ padding: 14, flex: 1, overflow: 'hidden', background: 'var(--cream)' }}>

        <div className="panel">
          <div className="row gap-8" style={{ padding: '10px 12px', borderBottom: '1px solid var(--line-faint)', background: 'var(--cream-soft)' }}>
            <span className="muted">{I.chevD}</span>
            <b style={{ fontSize: 13 }}>Cherry Blossom Premium</b>
            <span className="pill owned">Owned</span>
            <div className="grow" />
            <span className="tnum">BD 380</span>
          </div>
          <div>
            <div className="li"><span className="qty">×12</span><span className="name">Digital · 12 picked</span></div>
            <div className="li"><span className="qty">×4</span><span className="name">Prints 5×7 (swap)</span></div>
            <div className="li added"><span className="qty" style={{ background: 'var(--accent)' }}>+2</span><span className="name">Extra digital</span><span className="tnum">BD 20</span></div>
            <div className="li added"><span className="qty" style={{ background: 'var(--accent)' }}>+1</span><span className="name">Leather cover</span><span className="tnum">BD 45</span></div>
          </div>
        </div>

        <div className="panel" style={{ borderColor: 'var(--accent)' }}>
          <div className="row gap-8" style={{ padding: '10px 12px', background: 'var(--accent-soft)' }}>
            <span className="muted">{I.chevR}</span>
            <b style={{ fontSize: 13 }}>Maternity Add-on</b>
            <span className="pill staged">Staged</span>
            <div className="grow" />
            <span className="tnum">BD 140</span>
          </div>
        </div>

        <div className="totals">
          <div className="row"><span className="muted">Total</span><b className="tnum">BD {totalGrand}</b></div>
          <div className="row due"><span>Remaining</span><b className="tnum">BD {totalDue}</b></div>
        </div>

        <div className="col gap-6">
          <button className="btn accent" style={{ justifyContent: 'center' }}>{I.lock}<span style={{ marginLeft: 6 }}>Lock</span></button>
          <button className="btn" style={{ justifyContent: 'center' }}>{I.cash}<span style={{ marginLeft: 6 }}>Collect BD {totalDue}</span></button>
        </div>
      </div>

      <Anno x={20} y={400} w={170} arrow={{ x: 100, y: 360 }}>
        same hierarchy, just stacked — packages → totals → CTAs
      </Anno>
    </div>
  );
}

// ── Locked order state — adjustments post-lock ─────────────────
function LockedState() {
  return (
    <div className="wf col">
      <Topbar locked />

      <div className="row gap-16" style={{ padding: '14px 24px', borderBottom: '1px solid var(--line)', background: 'var(--paper)' }}>
        <div className="col">
          <div className="row gap-8"><b style={{ fontSize: 18 }}>{MOCK.order.customer.name}</b><span className="muted">{MOCK.order.session}</span></div>
          <span className="mono muted" style={{ fontSize: 11 }}>{MOCK.order.id} · locked 02 Jun · in Editing</span>
        </div>
        <div className="grow" />
        <span className="pill" style={{ background: '#eee' }}>{I.lock}<span style={{ marginLeft: 4 }}>Locked</span></span>
        <button className="btn sm">Request post-lock adjustment</button>
        <span className="hand muted" style={{ fontSize: 13 }}>manager approval needed</span>
      </div>

      <div className="row" style={{ flex: 1, minHeight: 0 }}>
        <div className="col grow" style={{ padding: 20, background: 'var(--cream)' }}>

          <div className="eyebrow" style={{ marginBottom: 8 }}>Locked composition · read-only</div>
          <div className="panel" style={{ background: 'var(--paper)', opacity: 0.92 }}>
            <div className="row gap-8" style={{ padding: '10px 12px', borderBottom: '1px solid var(--line-faint)' }}>
              <span className="muted">{I.lock}</span>
              <b style={{ fontSize: 13 }}>Cherry Blossom Premium</b>
              <span className="pill locked">Locked</span>
              <div className="grow" />
              <span className="tnum">BD 380</span>
            </div>
            <div>
              <div className="li locked"><span className="qty">×12</span><span className="name">Digital photos · all picked</span></div>
              <div className="li locked"><span className="qty">×4</span><span className="name">5 × 7 prints</span></div>
              <div className="li locked"><span className="qty">×1</span><span className="name">20-page album · leather</span></div>
              <div className="li locked"><span className="qty">+2</span><span className="name">Extra digital photos</span><span className="tnum">BD 20</span></div>
            </div>
          </div>

          <div className="row gap-12" style={{ marginTop: 16 }}>
            <button className="btn sm">{I.swap}<span style={{ marginLeft: 4 }}>Stage post-lock change</span></button>
            <span className="hand muted">stages a NEW set of staged edits — never silently mutates locked items</span>
          </div>

          {/* Post-lock staged adjustment shown below */}
          <div className="eyebrow" style={{ marginTop: 20, marginBottom: 8, color: 'var(--accent-dark)' }}>Post-lock adjustments · pending manager approval</div>
          <div className="panel" style={{ borderColor: 'var(--accent)', background: 'var(--paper)' }}>
            <div className="row gap-8" style={{ padding: '10px 12px', background: 'var(--accent-soft)' }}>
              <span style={{ color: 'var(--ink-3)' }}>{I.swap}</span>
              <b style={{ fontSize: 13 }}>Swap 2 of the leather-cover photos</b>
              <span className="pill warn">Awaiting manager</span>
              <div className="grow" />
              <span className="tnum">no charge</span>
            </div>
          </div>
        </div>

        <div className="col" style={{ width: 300, borderLeft: '1px solid var(--line-faint)', background: 'var(--paper)', padding: 16, gap: 12 }}>
          <div className="totals">
            <div className="row big"><span>Total</span><span className="tnum">BD {totalGrand}</span></div>
            <div className="row ok"><span className="muted">Paid in full</span><span className="tnum">BD {totalGrand}</span></div>
          </div>
          <div className="sk-box" style={{ padding: 10 }}>
            <div className="eyebrow" style={{ marginBottom: 6 }}>Activity</div>
            <div className="hand" style={{ fontSize: 14, color: 'var(--ink-2)' }}>
              02 Jun 16:04 — locked by Lana<br />
              02 Jun 16:08 — sent to editor (Ahmed)<br />
              03 Jun 09:12 — Sarah requested 2 swaps<br />
              03 Jun 09:13 — flagged for manager
            </div>
          </div>
        </div>
      </div>

      <Anno x={520} y={540} w={210} arrow={{ x: 400, y: 590 }}>
        post-lock edits land as their own band — never edit-in-place
      </Anno>
    </div>
  );
}

// ── Very large order — dense list mode ────────────────────────
function DenseState() {
  const rows = [
    { p: 'Cherry Blossom · Newborn Premium', qty: 1, k: 'Package', s: 'owned', amt: 380 },
    { p: 'Maternity Add-on', qty: 1, k: 'Package', s: 'staged', amt: 140 },
    { p: 'Family Group · Studio', qty: 1, k: 'Package', s: 'owned', amt: 220 },
    { p: '+2 extra digital photos', qty: 2, k: 'Photo', s: 'staged', amt: 20 },
    { p: '+4 extra digital photos', qty: 4, k: 'Photo', s: 'staged', amt: 40 },
    { p: '8×10 prints (swap → 5×7)', qty: 4, k: 'Print', s: 'swap', amt: 0 },
    { p: 'Album · leather cover', qty: 1, k: 'Album', s: 'staged', amt: 45 },
    { p: 'Album · 4-extra-page upgrade', qty: 1, k: 'Album', s: 'staged', amt: 25 },
    { p: 'USB keepsake', qty: 1, k: 'Product', s: 'owned', amt: 0 },
    { p: 'Wood frame · 11×14', qty: 2, k: 'Product', s: 'staged', amt: 60 },
    { p: 'Rush editing', qty: 1, k: 'Service', s: 'staged', amt: 30 },
    { p: 'Loyalty voucher', qty: 1, k: 'Credit', s: 'owned', amt: -80 },
    { p: 'Sibling discount', qty: 1, k: 'Credit', s: 'staged', amt: -40 },
  ];
  return (
    <div className="wf dense col">
      <Topbar />
      <div className="row gap-12" style={{ padding: '10px 18px', borderBottom: '1px solid var(--line-faint)', background: 'var(--paper)' }}>
        <b>{MOCK.order.customer.name}</b><span className="muted">· Family session · 2 days</span><span className="pill warn">Selection</span>
        <div className="grow" />
        <div className="seg"><div className="s">Cards</div><div className="s on">Dense</div></div>
        <span className="hand muted" style={{ fontSize: 13 }}>"power-user mode for very large orders"</span>
      </div>
      <div className="grow" style={{ overflow: 'hidden', padding: 16, background: 'var(--cream)' }}>
        <div className="panel" style={{ background: 'var(--paper)' }}>
          <div className="row" style={{ padding: '8px 14px', background: 'var(--cream-soft)', borderBottom: '1px solid var(--line-faint)', fontSize: 11, fontWeight: 600, color: 'var(--ink-3)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
            <span style={{ width: 30 }}>#</span>
            <span style={{ width: 70 }}>Kind</span>
            <span className="grow">Item</span>
            <span style={{ width: 60, textAlign: 'right' }}>Qty</span>
            <span style={{ width: 90 }}>Status</span>
            <span style={{ width: 80, textAlign: 'right' }}>Amount</span>
            <span style={{ width: 80 }}></span>
          </div>
          {rows.map((r, i) => (
            <div key={i} className={'row ' + (r.s === 'staged' ? 'added' : r.s === 'swap' ? '' : '')} style={{ padding: '7px 14px', borderTop: i ? '1px dashed var(--line-faint)' : 0, background: r.s === 'staged' ? 'rgba(242,232,214,0.4)' : '', fontSize: 12 }}>
              <span className="mono muted" style={{ width: 30 }}>{String(i + 1).padStart(2, '0')}</span>
              <span className="muted" style={{ width: 70 }}>{r.k}</span>
              <span className="grow">{r.p}</span>
              <span className="tnum" style={{ width: 60, textAlign: 'right' }}>×{r.qty}</span>
              <span style={{ width: 90 }}><span className={'pill ' + (r.s === 'staged' ? 'staged' : r.s === 'swap' ? 'info' : 'owned')}>{r.s === 'swap' ? 'Swap' : r.s === 'staged' ? 'Staged' : 'Owned'}</span></span>
              <span className="tnum" style={{ width: 80, textAlign: 'right', color: r.amt < 0 ? 'var(--ok)' : '' }}>{r.amt === 0 ? '—' : `BD ${r.amt}`}</span>
              <span style={{ width: 80, textAlign: 'right', color: 'var(--ink-4)' }}>{I.more}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="row gap-16" style={{ padding: '12px 18px', background: 'var(--paper)', borderTop: '1px solid var(--line-faint)' }}>
        <div className="col"><span className="eyebrow">13 lines · 3 packages</span><b className="tnum">BD 920</b></div>
        <div className="grow" />
        <button className="btn">{I.cash}<span style={{ marginLeft: 6 }}>Split payment</span></button>
        <button className="btn accent">{I.lock}<span style={{ marginLeft: 6 }}>Review & lock</span></button>
      </div>
    </div>
  );
}

window.TabletA = TabletA;
window.LockedState = LockedState;
window.DenseState = DenseState;
