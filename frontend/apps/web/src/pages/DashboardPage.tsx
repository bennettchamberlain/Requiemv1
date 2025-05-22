import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';
import { SidebarProvider, SidebarInset, SidebarTrigger } from '@/components/ui/sidebar';

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import { Separator } from '@/components/ui/separator';




import * as React from 'react';
import { BookOpen, Bot, Map, Settings2, SquareTerminal } from 'lucide-react';

import { NavMain } from '@/components/nav-main';
import { NavUser } from '@/components/nav-user';
import { Sidebar, SidebarContent, SidebarFooter, SidebarRail } from '@/components/ui/sidebar';
import { Collapsible } from '@/components/ui/collapsible';

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
      {
        title: 'Chat',
        url: '/chat',
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
    title: 'Chat',
    url: '/Chat',
    icon: Bot,
    collapsible: false
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
      {
        title: 'Admin',
        url: '/admin',
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
      <SidebarRail />
    </Sidebar>
  );
}




export function DashboardPage() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/');
  };

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="flex h-16 shrink-0 items-center gap-2 transition-[width,height] ease-linear group-has-[[data-collapsible=icon]]/sidebar-wrapper:h-12">
          <div className="flex items-center gap-2 px-4">
            <SidebarTrigger className="-ml-1" />
            <Separator orientation="vertical" className="mr-2 h-4" />
            <Breadcrumb>
              <BreadcrumbList>
                <BreadcrumbItem className="hidden md:block">
                  <BreadcrumbLink href="#">Dashboard</BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator className="hidden md:block" />
                <BreadcrumbItem>
                  <BreadcrumbPage>Home</BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>

            <div className="ml-auto flex items-center gap-2">
              <span className="text-sm font-medium">Welcome, {user?.name || user?.email}</span>
              <Button variant="outline" size="sm" onClick={handleLogout}>Logout</Button>
            </div>
          </div>
        </header>
        <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
          <div className="grid auto-rows-min gap-4 md:grid-cols-3">
            <div className="aspect-video rounded-xl bg-muted/50 flex items-center justify-center">
              <span className="text-lg font-medium">Dashboard Panel 1</span>
            </div>
            <div className="aspect-video rounded-xl bg-muted/50 flex items-center justify-center">
              <span className="text-lg font-medium">Dashboard Panel 2</span>
            </div>
            <div className="aspect-video rounded-xl bg-muted/50 flex items-center justify-center">
              <span className="text-lg font-medium">Dashboard Panel 3</span>
            </div>
          </div>
          <div className="min-h-[50vh] flex-1 rounded-xl bg-muted/50 flex items-center justify-center md:min-h-min">
            <span className="text-xl font-medium">Main Dashboard Content</span>
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
