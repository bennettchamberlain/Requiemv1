import { Suspense } from 'react';
import { LoadingPage } from '@ci/common';
import { Sidebar } from '@ci/shadcn';
import { Bot, Map, Settings2, SquareTerminal, Search, Camera } from '@ci/shadcn/icons';
import { Outlet } from 'react-router-dom';

import { NavMain } from '@/components/nav-main';
import { NavUser } from '@/components/nav-user';
import { useAuth } from '@/hooks';

const navItems = [
  {
    title: 'Dashboard',
    url: '/dashboard',
    icon: SquareTerminal,
    isActive: true,
    items: [
      {
        title: 'Recommendations',
        url: '/dashboard',
        icon: Bot,
      },
      {
        title: 'Amusing Statistics',
        url: '/dashboard',
        icon: Bot,
      },
      {
        title: 'Recent Activity',
        url: '/dashboard',
        icon: Bot,
      },
      {
        title: 'Recent Notifications',
        url: '/dashboard',
        icon: Bot,
      },
    ],
  },
  {
    title: 'Chat',
    url: '/chat',
    icon: Bot,
    items: [
      {
        title: 'Text Talk to AI',
        url: '/chat',
        icon: Bot,
      },
      {
        title: 'Voice Talk to AI',
        url: '/chat',
        icon: Bot,
      },
      {
        title: 'Visual Camera Mode',
        url: '/chat',
        icon: Bot,
      },
    ],
  },
  {
    title: 'Search',
    url: '/search',
    icon: Search,
    items: [
      {
        title: 'Semantic Search',
        url: '/search',
        icon: Search,
      },
      {
        title: 'Advanced Search',
        url: '/search?advanced=true',
        icon: Search,
      },
    ],
  },
  {
    title: 'Your Agents',
    url: '/agents',
    icon: Bot,
    items: [
      {
        title: 'Active',
        url: '/agents?active=true',
        icon: Bot,
      },
      {
        title: 'All',
        url: '/agents',
        icon: Bot,
      },
      {
        title: 'Priorities / Swim Lanes',
        url: '/memory',
        icon: Bot,
      },
    ],
  },
  {
    title: 'Digital Memory Browser',
    url: '/memory',
    icon: Bot,
    items: [
      {
        title: 'List',
        url: '/memory',
        icon: Bot,
      },
      {
        title: 'Feed',
        url: '/memory?tab=feed',
        icon: Bot,
      },
      {
        title: 'Map',
        url: '/memory?tab=map',
        icon: Map,
      },
      {
        title: 'Timeline',
        url: '/memory?tab=calendar',
        icon: Bot,
      },
    ],
  },
  {
    title: 'Questions',
    url: '/questions',
    icon: Bot,
    items: [
      {
        title: 'Questions',
        url: '/questions',
        icon: Bot,
      },
      {
        title: 'Answers',
        url: '/answers',
        icon: Bot,
      },
      {
        title: 'Insights',
        url: '/insights',
        icon: Bot,
      },
    ],
  },
  {
    title: 'Tasks',
    url: '/admin',
    icon: Settings2,
    items: [
      {
        title: 'Active',
        url: '#',
      },
      {
        title: 'Available',
        url: '#',
      },
      {
        title: 'Analysis',
        url: '#',
      },
    ],
  },
  {
    title: 'Settings',
    url: '/admin',
    icon: Settings2,
    items: [
      {
        title: 'General',
        url: '#',
      },
      {
        title: 'Billing',
        url: '#',
      },
      {
        title: 'Privacy',
        url: '#',
      },
      {
        title: 'Admin',
        url: '/admin',
      },
    ],
  },
  {
    title: 'Files',
    url: '/files',
    icon: Camera,
    items: [
      {
        title: 'Files',
        url: '/files',
      },
    ],
  },
];

export function Main() {
  const [{ user }] = useAuth();

  const currentUser = {
    name: user?.name || user?.email || 'User',
    email: user?.email || '',
    avatar: '/avatars/shadcn.jpg',
  };

  return (
    <div className="flex h-screen">
      <Sidebar>
        <Sidebar.Content>
          <Sidebar.Header>Companion Intelligence</Sidebar.Header>
          <NavMain items={navItems} />
        </Sidebar.Content>
        <Sidebar.Rail />
        <Sidebar.Footer>
          <NavUser user={currentUser} />
        </Sidebar.Footer>
      </Sidebar>
      <Sidebar.Inset>
        <Suspense fallback={<LoadingPage />}>
          <Outlet />
        </Suspense>
      </Sidebar.Inset>
    </div>
  );
}
