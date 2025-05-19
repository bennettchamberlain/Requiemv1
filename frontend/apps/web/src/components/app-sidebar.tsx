import * as React from 'react';
import { BookOpen, Bot, Map, Settings2, SquareTerminal } from 'lucide-react';

import { NavMain } from '@/components/nav-main';
import { NavUser } from '@/components/nav-user';
import { Sidebar, SidebarContent, SidebarFooter, SidebarRail } from '@/components/ui/sidebar';

const exampleUser = {
  name: 'John Smith',
  email: 'John@Smith.com',
  avatar: '/avatars/shadcn.jpg',
};

const navigationChoices = [
  {
    title: 'Dashboard',
    url: '#',
    icon: SquareTerminal,
    isActive: true,
  },
  {
    title: 'Memory',
    url: '#',
    icon: Bot,
    items: [
      {
        title: 'List',
        url: '#',
        icon: Bot,
      },
      {
        title: 'Feed',
        url: '#',
        icon: Bot,
      },
      {
        title: 'Map',
        url: '#',
        icon: Map,
      },
      {
        title: 'Calendar',
        url: '#',
        icon: Bot,
      },
    ],
  },
  {
    title: 'Questions',
    url: '#',
    icon: BookOpen,
    items: [
      {
        title: 'Questions',
        url: '#',
      },
      {
        title: 'Insights',
        url: '#',
      },
    ],
  },
  {
    title: 'Settings',
    url: '#',
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
    ],
  },
];

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarContent>
        <NavMain items={navigationChoices} />
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={exampleUser} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
