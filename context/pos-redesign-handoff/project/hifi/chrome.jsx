// Sidebar + Topbar chrome — Studio OS conventions.

const SIDE_SECTIONS = [
  [{ key: 'dashboard', label: 'Dashboard', icon: 'LayoutDashboard' }],
  [
    { key: 'bookings',  label: 'Bookings',  icon: 'CalendarCheck' },
    { key: 'calendar',  label: 'Calendar',  icon: 'Calendar' },
    { key: 'customers', label: 'Customers', icon: 'Users' },
    { key: 'orders',    label: 'Orders',    icon: 'Receipt' },
    { key: 'packages',  label: 'Packages',  icon: 'Package' },
    { key: 'invoices',  label: 'Invoices',  icon: 'FileText' },
  ],
  [
    { key: 'sessions',  label: 'Sessions',  icon: 'Camera' },
    { key: 'selection', label: 'Selection', icon: 'Image' },
    { key: 'editing',   label: 'Editing',   icon: 'Pen' },
    { key: 'delivery',  label: 'Delivery',  icon: 'Truck' },
  ],
  [
    { key: 'commissions', label: 'Commissions', icon: 'Dollar' },
    { key: 'reports',     label: 'Reports',     icon: 'BarChart' },
  ],
  [{ key: 'settings', label: 'Settings', icon: 'Settings' }],
];

function Sidebar({ activeKey }) {
  const [collapsed, setCollapsed] = React.useState(() => {
    try { return localStorage.getItem('studio-sb-collapsed') === '1'; }
    catch (e) { return false; }
  });
  const toggle = () => {
    setCollapsed(c => {
      const next = !c;
      try { localStorage.setItem('studio-sb-collapsed', next ? '1' : '0'); } catch (e) {}
      return next;
    });
  };
  return (
    <aside className={'sb' + (collapsed ? ' collapsed' : '')}>
      <div className="sb-logo">
        <div className="mark" aria-label="Lollipop" />
        <span className="name">Studio OS</span>
        <button
          className="sb-toggle"
          onClick={toggle}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-expanded={!collapsed}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <Icon.PanelLeft size={16} />
        </button>
      </div>
      <nav className="sb-nav">
        {SIDE_SECTIONS.map((group, gi) => (
          <div key={gi} className="sb-group">
            {group.map(item => {
              const I = Icon[item.icon];
              const active = item.key === activeKey;
              return (
                <div
                  key={item.key}
                  className={'sb-link' + (active ? ' active' : '')}
                  title={collapsed ? item.label : undefined}
                >
                  <I size={16} />
                  <span>{item.label}</span>
                </div>
              );
            })}
          </div>
        ))}
      </nav>
      <div className="sb-user" title={collapsed ? 'Abrar Alabdulla · Manager' : undefined}>
        <div className="avatar">AA</div>
        <div className="who">
          <div className="nm">Abrar Alabdulla</div>
          <div className="role">Manager</div>
        </div>
      </div>
    </aside>
  );
}

function Topbar({ orderRef, customer }) {
  return (
    <header className="tb">
      <div className="tb-crumbs">
        <a href="#" onClick={e => e.preventDefault()} className="crumb-link">
          <Icon.ChevronLeft size={13} />
          <span>Orders</span>
        </a>
        <span className="sep">/</span>
        <span className="ref">{orderRef}</span>
        <span className="sep">·</span>
        <span>{customer}</span>
      </div>
      <div className="spacer" />
      <div className="saved" title="Auto-saved 12 seconds ago">
        <span className="dot" />
        <span>Saved · 12s ago</span>
      </div>
      <button className="icon-btn" aria-label="Notifications">
        <Icon.Bell size={16} />
        <span className="badge-dot" />
      </button>
      <div className="avatar">AA</div>
    </header>
  );
}

window.Sidebar = Sidebar;
window.Topbar = Topbar;
