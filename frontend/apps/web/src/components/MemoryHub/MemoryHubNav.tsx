import { cn } from '@ci/shadcn';
import { Link, useLocation } from 'react-router-dom';

import { useFeatures } from '@/common/feature';

type HubSection = {
  to: string;
  label: string;
  match: (path: string) => boolean;
  flag?: string;
};

const SECTIONS: HubSection[] = [
  { to: '/memory', label: 'Events', match: (p) => p === '/memory' },
  { to: '/memory/people', label: 'People', match: (p) => p === '/memory/people' || p.startsWith('/people/') },
  { to: '/memory/places', label: 'Places', match: (p) => p === '/memory/places' || p.startsWith('/places/') },
  {
    to: '/memory/things',
    label: 'Things',
    match: (p) => p === '/memory/things' || p.startsWith('/inventory'),
    flag: 'enable.inventory.page',
  },
  { to: '/memory/content', label: 'Content', match: (p) => p === '/memory/content', flag: 'files.page' },
  { to: '/memory/tags', label: 'Tags', match: (p) => p === '/memory/tags', flag: 'tags.page' },
  {
    to: '/memory/questions',
    label: 'Questions',
    match: (p) => p === '/memory/questions',
    flag: 'insights.page',
  },
];

export function MemoryHubNav() {
  const { pathname } = useLocation();
  const { isFeatureEnabled } = useFeatures();

  const visible = SECTIONS.filter((section) => !section.flag || isFeatureEnabled(section.flag));

  return (
    <nav
      aria-label="Memory sections"
      className="flex shrink-0 flex-wrap items-center gap-1 border-b border-border px-2 py-2 md:gap-2 md:px-3"
    >
      {visible.map((section) => {
        const active = section.match(pathname);

        return (
          <Link
            key={section.to}
            to={section.to}
            className={cn(
              'rounded-md px-2.5 py-1 text-sm font-medium transition-colors',
              active
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
            )}
          >
            {section.label}
          </Link>
        );
      })}
    </nav>
  );
}
