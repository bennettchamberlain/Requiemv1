import { Suspense, lazy } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';

// Import contexts
import { ThemeProvider } from '@/contexts/ThemeContext';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';

// Import pages

import SplashPage from '@/pages/SplashPage';
import LoginPage from '@/pages/LoginPage';
import SignupPage from '@/pages/SignupPage';
import { DashboardPage } from '@/pages/DashboardPage';
import AdminPage from '@/pages/AdminPage';
import AnswersPage from '@/pages/AnswersPage';
import QuestionsPage from '@/pages/QuestionsPage';
import { ChatPage } from '@/pages/ChatPage';
import { MemoryPage } from '@/pages/MemoryPage';

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
    items: [
      {
        title: 'Recommendations',
        url: '/memory',
        icon: Bot,
      },
      {
        title: 'Amusing Statistics',
        url: '/memory',
        icon: Bot,
      },
      {
        title: 'Recent Activity',
        url: '/memory',
        icon: Bot,
      },
      {
        title: 'Recent Notifications',
        url: '/memory',
        icon: Bot,
      },
    ]
  },

  {
    title: 'Talk to an AI',
    url: '/memory',
    icon: Bot,
    items: [
      {
        title: 'Text Talk to AI',
        url: '/memory',
        icon: Bot,
      },
      {
        title: 'Voice Talk to AI',
        url: '/memory',
        icon: Bot,
      },
      {
        title: 'Visual Camera Mode',
        url: '/memory',
        icon: Bot,
      },
    ]
  },

  {
    title: 'Counsel',
    url: '/memory',
    icon: Bot,
    items: [
      {
        title: 'Active Coaches',
        url: '/memory',
        icon: Bot,
      },
      {
        title: 'Available Coaches',
        url: '/memory',
        icon: Bot,
      },
      {
        title: 'Priorities / Swim Lanes',
        url: '/memory',
        icon: Bot,
      },
      {
        title: 'About you (Questions)',
        url: '/questions',
        icon: Bot,
      },
      {
        title: 'Your Answers',
        url: '/answers',
        icon: Bot,
      },
      {
        title: 'Insights / Context',
        url: '/memory',
        icon: Bot,
      },
      {
        title: 'Actions for you to do',
        url: '/memory',
        icon: Bot,
      },
    ]
  },

  {
    title: 'Memory',
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
    ]
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
          <NavMain items={items} />
        </SidebarContent>
        <SidebarRail />
        <SidebarFooter>
          <NavUser user={currentUser} />
        </SidebarFooter>
      </Sidebar>
      <SidebarInset>
        {children}
      </SidebarInset>
    </SidebarProvider>
  );
}


  
export function AppSidebarUnused({ children }: AppSideBarProps) {
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
            <Route
              path="/answers"
              element={
                <ProtectedRoute>
                  <AppSidebar>
                    <AnswersPage />
                  </AppSidebar>
                </ProtectedRoute>
              }
            />
            <Route
              path="/questions"
              element={
                <ProtectedRoute>
                  <AppSidebar>
                    <QuestionsPage />
                  </AppSidebar>
                </ProtectedRoute>
              }
            />
            <Route
              path="/memory"
              element={
                <ProtectedRoute>
                  <AppSidebar>
                    <MemoryPage />
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
