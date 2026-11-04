import {
  Home01Icon,
  Menu01Icon,
  Settings01Icon,
  SidebarLeftIcon,
} from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import type { UserSessionDto } from '@thaarei/turnstile-contracts';
import { useEffect, useId, useRef, useState } from 'react';
import { useLocation } from 'react-router';
import { ButtonLink } from '@/components/button-link';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { canReadUnits, company } from '@/features/people/client';
import { cn } from '@/lib/utils';

export type WorkspaceDestination = {
  label: string;
  href: string;
  active: boolean;
  icon: typeof Home01Icon;
};

export function workspaceDestinations(
  path: string,
  canManage: boolean,
  session?: UserSessionDto,
): WorkspaceDestination[] {
  return [
    { label: 'Home', href: '/', active: path === '/', icon: Home01Icon },
    ...(session
      ? [
          ...(company(session, 'turnstile:people:manage')
            ? [
                {
                  label: 'Members',
                  href: '/people/members',
                  active: path === '/people/members',
                  icon: Settings01Icon,
                },
                {
                  label: 'Invitations',
                  href: '/people/invitations',
                  active: path === '/people/invitations',
                  icon: Settings01Icon,
                },
              ]
            : []),
          ...(company(session, 'turnstile:roles:manage')
            ? [
                {
                  label: 'Roles',
                  href: '/people/roles',
                  active: path === '/people/roles',
                  icon: Settings01Icon,
                },
              ]
            : []),
          ...(canReadUnits(session)
            ? [
                {
                  label: 'Structure',
                  href: '/structure',
                  active: path === '/structure',
                  icon: Settings01Icon,
                },
              ]
            : []),
        ]
      : []),
    ...(canManage
      ? [
          {
            label: 'Settings',
            href: '/settings',
            active: path === '/settings' || path.startsWith('/settings/'),
            icon: Settings01Icon,
          },
        ]
      : []),
  ];
}

function WorkspaceLinks({
  destinations,
  collapsed = false,
  id,
}: {
  destinations: WorkspaceDestination[];
  collapsed?: boolean;
  id?: string;
}) {
  return (
    <nav id={id} aria-label="Workspace navigation" className="workspace-navigation">
      {destinations.map(({ label, href, active, icon }) => (
        <Tooltip key={href} disabled={!collapsed}>
          <TooltipTrigger
            render={
              <ButtonLink
                href={href}
                variant={active ? 'secondary' : 'ghost'}
                aria-current={active ? 'page' : undefined}
                aria-label={label}
                className={cn('justify-start', collapsed && 'justify-center px-0')}
              />
            }
          >
            <HugeiconsIcon icon={icon} aria-hidden="true" data-icon="inline-start" />
            <span className={cn(collapsed && 'sr-only')}>{label}</span>
          </TooltipTrigger>
          <TooltipContent side="right">{label}</TooltipContent>
        </Tooltip>
      ))}
    </nav>
  );
}

/** Collapse lives only in this mounted workspace. Base UI owns modal focus and dismissal. */
export function WorkspaceNavigation({ destinations }: { destinations: WorkspaceDestination[] }) {
  const [collapsed, setCollapsed] = useState(false);
  const [open, setOpen] = useState(false);
  const { key } = useLocation();
  const previous = useRef(key);
  const navigated = useRef(false);
  const collapseButton = useRef<HTMLButtonElement>(null);
  const id = useId();
  useEffect(() => {
    if (previous.current === key) return;
    previous.current = key;
    navigated.current = true;
    setOpen(false);
  }, [key]);
  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 761px)');
    const closeOnDesktop = () => {
      if (desktop.matches) setOpen(false);
    };
    desktop.addEventListener('change', closeOnDesktop);
    return () => desktop.removeEventListener('change', closeOnDesktop);
  }, []);
  return (
    <TooltipProvider delay={250}>
      <aside className="workspace-sidebar" data-collapsed={collapsed}>
        <div className="workspace-sidebar-controls">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  ref={collapseButton}
                  size="icon"
                  variant="ghost"
                  aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
                  aria-expanded={!collapsed}
                  aria-controls={id}
                  onClick={() => setCollapsed(!collapsed)}
                />
              }
            >
              <HugeiconsIcon icon={SidebarLeftIcon} aria-hidden="true" />
            </TooltipTrigger>
            <TooltipContent side="right">
              {collapsed ? 'Expand navigation' : 'Collapse navigation'}
            </TooltipContent>
          </Tooltip>
        </div>
        <WorkspaceLinks id={id} destinations={destinations} collapsed={collapsed} />
      </aside>
      <Sheet
        open={open}
        onOpenChange={(value) => {
          if (value) navigated.current = false;
          setOpen(value);
        }}
      >
        <div className="workspace-mobile-navigation">
          <SheetTrigger render={<Button variant="ghost" size="sm" />}>
            <HugeiconsIcon icon={Menu01Icon} data-icon="inline-start" aria-hidden="true" />
            Open navigation
          </SheetTrigger>
          <span className="text-sm text-muted-foreground">
            {destinations.find((item) => item.active)?.label ?? 'Workspace'}
          </span>
        </div>
        <SheetContent
          side="left"
          className="workspace-navigation-sheet"
          finalFocus={() => {
            if (window.matchMedia('(min-width: 761px)').matches) return collapseButton.current;
            if (navigated.current)
              return document.querySelector<HTMLElement>('[aria-label="Workspace content"]');
            return true;
          }}
        >
          <SheetHeader>
            <SheetTitle>Workspace navigation</SheetTitle>
            <SheetDescription>Turnstile 360</SheetDescription>
          </SheetHeader>
          <WorkspaceLinks destinations={destinations} />
        </SheetContent>
      </Sheet>
    </TooltipProvider>
  );
}
