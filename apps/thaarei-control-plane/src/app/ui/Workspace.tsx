'use client';
import { usePathname } from 'next/navigation';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { Icon, type IconName } from './Icon.tsx';

const navigation: Array<{ href: string; label: string; icon: IconName; admin?: boolean }> = [
  { href: '/', label: 'Overview', icon: 'overview' },
  { href: '/clients', label: 'Clients & installations', icon: 'clients' },
  { href: '/modules', label: 'Module catalogues', icon: 'modules' },
  { href: '/reports', label: 'Usage & health', icon: 'reports' },
  { href: '/staff', label: 'Staff access', icon: 'staff', admin: true },
];
export function Workspace({
  staff,
  children,
}: {
  staff: { name: string; email: string; role: string };
  children: ReactNode;
}) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const navigationRef = useRef<HTMLElement>(null);
  const menuRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    navigationRef.current?.querySelector('a')?.focus();
    const closeWithEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      menuRef.current?.focus();
    };
    document.addEventListener('keydown', closeWithEscape);
    return () => document.removeEventListener('keydown', closeWithEscape);
  }, [open]);
  const active = (href: string) => (href === '/' ? path === '/' : path.startsWith(href));
  const current = navigation.find((n) => active(n.href))?.label ?? 'Your account';
  return (
    <div className="workspace">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <aside className={`sidebar ${open ? 'is-open' : ''}`}>
        <a className="brand" href="/" aria-label="Thaarei Control Plane home">
          <span className="brand-symbol">t</span>
          <span>
            thaarei<span className="brand-caption">CONTROL PLANE</span>
          </span>
        </a>
        <p className="nav-caption">WORKSPACE</p>
        <nav ref={navigationRef} id="workspace-navigation" aria-label="Main navigation">
          {navigation
            .filter((n) => !n.admin || staff.role === 'admin')
            .map((n) => (
              <a
                key={n.href}
                href={n.href}
                className={active(n.href) ? 'nav-link active' : 'nav-link'}
                aria-current={active(n.href) ? 'page' : undefined}
                onClick={() => setOpen(false)}
              >
                <Icon name={n.icon} />
                {n.label}
              </a>
            ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="private-label">
            <Icon name="lock" />
            <span>Private staff workspace</span>
          </div>
          <a
            className="account-link"
            href="/account"
            aria-current={path === '/account' ? 'page' : undefined}
          >
            <span className="avatar">{staff.name.slice(0, 1).toUpperCase()}</span>
            <span className="account-name">
              {staff.name}
              <small>
                {staff.role === 'admin'
                  ? 'Administrator'
                  : staff.role === 'operator'
                    ? 'Operator'
                    : 'Viewer'}
              </small>
            </span>
            <Icon name="user" />
          </a>
        </div>
      </aside>
      <div className="workspace-body">
        <div className="topbar">
          <button
            className="secondary menu-button"
            ref={menuRef}
            type="button"
            aria-label={open ? 'Close navigation' : 'Open navigation'}
            aria-expanded={open}
            aria-controls="workspace-navigation"
            onClick={() => setOpen(!open)}
          >
            <Icon name="menu" />
          </button>
          <span className="topbar-location">
            Workspace <span>/</span> <strong>{current}</strong>
          </span>
          <span className="topbar-label">
            <span className="small-dot" />
            Central administration
          </span>
        </div>
        <div id="main-content" tabIndex={-1}>
          {children}
        </div>
        <footer className="workspace-footer">
          <span>Thaarei Control Plane</span>
          <span>Customer infrastructure stays independently managed.</span>
        </footer>
      </div>
    </div>
  );
}
