import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';

// Import contexts
import { ThemeProvider } from '@/contexts/ThemeContext';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';

// Import pages
import { SplashPage } from '@/pages/SplashPage';
import { LoginPage } from '@/pages/LoginPage';
import { SignupPage } from '@/pages/SignupPage';
import { DashboardPage } from '@/pages/DashboardPage';
import { AdminPage } from '@/pages/AdminPage';
import { ChatPage } from '@/pages/ChatPage';

// Protected route component
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return <div className="flex items-center justify-center min-h-svh">Loading...</div>;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" />;
  }

  return <>{children}</>;
}

/////////////////////////////////////////////////////////////////////////////////

import { useNavigate } from 'react-router-dom';
import { BookOpen, Bot, Map, Settings2, SquareTerminal } from 'lucide-react';
import { NavMain } from '@/components/nav-main';
import { NavUser } from '@/components/nav-user';
import { Collapsible } from '@/components/ui/collapsible';

import {
    SidebarProvider,
    Sidebar,
    SidebarMenu,
    SidebarMenuItem,
    SidebarMenuButton,
    SidebarContent,
    SidebarInset,
    SidebarGroup,
    SidebarGroupLabel,
    SidebarGroupContent,
    SidebarRail,
    SidebarTrigger,
    SidebarHeader,
    SidebarFooter,
} from '@/components/ui/sidebar';

const items = [
  {
    title: 'Dashboard',
    url: '/dashboard',
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
];

interface AppSideBarProps {
  children: React.ReactNode;
}

export function AppSidebarUnused({ children }: AppSideBarProps) {
  return (
    <SidebarProvider>
      <Sidebar>
        <SidebarContent>
          <NavMain items={items} />
        </SidebarContent>
        <SidebarRail />
      </Sidebar>
      <SidebarInset>
        {children}
      </SidebarInset>
    </SidebarProvider>
  );
}


  
export function AppSidebar({ children }: AppSideBarProps) {
  const { user } = useAuth();
  
  const currentUser = {
    name: user?.name || user?.email || 'User',
    email: user?.email || '',
    avatar: '/avatars/shadcn.jpg',
  };
  return (
    <SidebarProvider>
      <Sidebar>
        <SidebarContent>
          <SidebarHeader>
            Companion Intelligence
          </SidebarHeader>
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                {items.map((item) => (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton asChild>
                      <a href={item.url}>
                        <span>{item.title}</span>
                      </a>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter>
          <NavUser user={currentUser} />
        </SidebarFooter>
      </Sidebar>
      <SidebarInset>
        {children}
      </SidebarInset>
    </SidebarProvider>
  )
}

///////////////////////////////////////////////////////////////////////////////////


function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <Router>
          <Routes>
            <Route path="/" element={<SplashPage />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/signup" element={<SignupPage />} />
            <Route
              path="/chat"
              element={
                <ProtectedRoute>
                  <AppSidebar>
                    <ChatPage />
                  </AppSidebar>
                </ProtectedRoute>
              }
            />
            <Route
              path="/dashboard"
              element={
                <ProtectedRoute>
                  <AppSidebar>
                    <DashboardPage />
                  </AppSidebar>
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin"
              element={
                <ProtectedRoute>
                  <AppSidebar>
                    <AdminPage />
                  </AppSidebar>
                </ProtectedRoute>
              }
            />
            <Route path="*" element={<Navigate to="/" />} />
          </Routes>
        </Router>
      </AuthProvider>
    </ThemeProvider>
  );
}

export default App;
