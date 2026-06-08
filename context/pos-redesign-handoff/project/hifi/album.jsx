// Album tab — Studio OS
// One card per album on the order (whether bundled in a package or
// sold as a standalone add-on). The Configure modal opens over a
// blurred scrim and stages changes (no immediate commits).

// ── Configure album modal ─────────────────────────────────────
function ConfigureAlbumModal({ album, onClose }) {
  // Local state so the pills + textarea feel live without persisting
  // anywhere — this is a design prototype, not the wired app.
  const initial = album.config;
  const [albumType, setAlbumType] = React.useState(initial.albumType.selected);
  const [pages,     setPages]     = React.useState(initial.pages.selected);
  const [thread,    setThread]    = React.useState(initial.thread.selected);
  const [layout,    setLayout]    = React.useState(initial.layout.selected);
  const [notes,     setNotes]     = React.useState(initial.instructions);

  // Close on Esc
  React.useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Lock body scroll while open
  React.useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  // Synthesise a price-impact preview from selected pills (rough)
  const priceImpact = album.priceImpact;

  return (
    <div className="al-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="al-modal" role="dialog" aria-modal="true" aria-labelledby="al-modal-title">
        <header className="al-modal-head">
          <div className="text">
            <div className="eyebrow">Configure</div>
            <h2 id="al-modal-title">{album.title}</h2>
            <div className="sub">Changes will be staged for review before commit.</div>
          </div>
          <button className="al-modal-close" onClick={onClose} aria-label="Close">
            <Icon.X size={18} />
          </button>
        </header>

        <div className="al-modal-body">
          <div className="al-fields-grid">
            <PillGroup label="Album type"   options={initial.albumType.options} value={albumType} onChange={setAlbumType} />
            <PillGroup label="Pages"        options={initial.pages.options}     value={pages}     onChange={setPages} />
            <PillGroup label="Thread color" options={initial.thread.options}    value={thread}    onChange={setThread} />
            <PillGroup label="Layout style" options={initial.layout.options}    value={layout}    onChange={setLayout} />
          </div>

          <div>
            <div className="al-field-label">Editor instructions</div>
            <textarea
              className="al-textarea"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Notes for the editor — sequence, hero shots, anything to flag."
            />
          </div>
        </div>

        <footer className="al-modal-foot">
          <div className="al-price-impact">
            <span className="label">Price impact:</span>
            <span className={'amount' + (priceImpact === 0 ? ' zero' : '')}>
              {priceImpact === 0 ? '—' : `+BD ${priceImpact.toLocaleString()}.00`}
            </span>
          </div>
          <div className="spacer" />
          <button className="btn btn-outline" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={onClose}>Stage change</button>
        </footer>
      </div>
    </div>
  );
}

function PillGroup({ label, options, value, onChange }) {
  return (
    <div className="al-field-block">
      <div className="al-field-label">{label}</div>
      <div className="al-pills" role="radiogroup" aria-label={label}>
        {options.map((opt) => (
          <button
            key={opt}
            type="button"
            role="radio"
            aria-checked={opt === value}
            className={'al-pill' + (opt === value ? ' is-active' : '')}
            onClick={() => onChange(opt)}>
            {opt}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Album card ────────────────────────────────────────────────
function AlbumCard({ album, onConfigure }) {
  return (
    <article className={'al-card' + (album.hasStagedChanges ? ' is-staged' : '')}>
      <div className="al-card-eyebrow">
        <span className="k">Album</span>
        <span className="src">
          {album.sourceLabel}
          {album.sourcePkgId && <span className="ref">· {album.sourcePkgId.toUpperCase()}</span>}
        </span>
        <span className="spacer" />
        {album.hasStagedChanges && (
          <span className="staged-flag">
            <span className="dot" />
            Pending changes
          </span>
        )}
      </div>

      <div className="al-card-body">
        <div className="al-cover">
          <div className="al-cover-bg" style={{ background: album.coverBg }} />
          {album.coverRef && <span className="al-cover-tag">{album.coverRef}</span>}
          <div className="al-cover-text">
            <div className="nm">{album.coverName}</div>
            <div className="dt">{album.coverDate}</div>
          </div>
        </div>

        <div className="al-specs">
          {album.fields.map((f, i) => (
            <div key={i} className="al-spec">
              <div className="left">
                <div className="label">{f.k}</div>
                <div className={'value' + (f.muted ? ' muted' : '')}>{f.v}</div>
              </div>
              {f.accent && <div className="accent-meta">{f.accent}</div>}
            </div>
          ))}
        </div>
      </div>

      <div className="al-card-foot">
        <button className="al-edit-btn" onClick={() => onConfigure(album)}>
          <Icon.Edit size={15} />
          Edit album configuration
        </button>
      </div>
    </article>
  );
}

// ── Album tab body ────────────────────────────────────────────
function AlbumMain() {
  const [configuring, setConfiguring] = React.useState(null);

  if (!ALBUMS.length) {
    return (
      <div className="al-empty">
        <div className="ico"><Icon.BookOpen size={22} /></div>
        <div className="t">No albums on this order yet.</div>
        <div className="s">Add an album by upgrading a package or attaching a standalone keepsake.</div>
      </div>
    );
  }

  return (
    <div className="col-main">
      <div className="al-intro">
        <div className="left">
          <h2>Album configuration</h2>
          <div className="sub">
            {ALBUMS.length} album{ALBUMS.length === 1 ? '' : 's'} on this order — bound, paged and ready for the editor.
          </div>
        </div>
        <div className="right">
          <span className="count-pill"><b>{ALBUMS.length}</b> active</span>
          <button className="btn btn-outline btn-sm">
            <Icon.Plus size={14} />
            Add album
          </button>
        </div>
      </div>

      <div className="al-list">
        {ALBUMS.map((a) => (
          <AlbumCard key={a.id} album={a} onConfigure={setConfiguring} />
        ))}
      </div>

      {configuring && (
        <ConfigureAlbumModal album={configuring} onClose={() => setConfiguring(null)} />
      )}
    </div>
  );
}

window.AlbumMain = AlbumMain;
