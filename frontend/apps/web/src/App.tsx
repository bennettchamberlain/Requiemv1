import { Suspense, lazy } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { BookOpen, Bot, Map, Settings2, SquareTerminal, Search } from 'lucide-react';
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

import SplashPage from '@/pages/SplashPage';
import LoginPage from '@/pages/LoginPage';
import SignupPage from '@/pages/SignupPage';
import { DashboardPage } from '@/pages/DashboardPage';
import AdminPage from '@/pages/AdminPage';
import AnswersPage from '@/pages/AnswersPage';
import QuestionsPage from '@/pages/QuestionsPage';
import SearchPage from '@/pages/SearchPage';
import { ChatPage } from '@/pages/ChatPage';
import { MemoryPage } from '@/pages/MemoryPage';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return <div className="flex items-center justify-center min-h-svh">Loading...</div>;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}

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
];

export function AppContent() {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return <div className="flex items-center justify-center min-h-svh">Loading...</div>;
  }

  const showSidebar = user && location.pathname !== '/login';

  if (!showSidebar) {
    return (
      <div className="w-full">
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signup" element={<SignupPage />} />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </div>
    );
  }

  const currentUser = {
    name: user?.name || user?.email || 'User',
    email: user?.email || '',
    avatar: '/avatars/shadcn.jpg',
  };

  return (
    <div className="flex h-screen">
      <SidebarProvider>
        <Sidebar>
          <SidebarContent>
            <SidebarHeader>Companion Intelligence</SidebarHeader>
            <NavMain items={navItems} />
          </SidebarContent>
          <SidebarRail />
          <SidebarFooter>
            <NavUser user={currentUser} />
          </SidebarFooter>
        </Sidebar>
        <SidebarInset>
          <Routes>
            <Route path="/login" element={<Navigate to="/" replace />} />
            <Route
              path="/"
              element={
                <ProtectedRoute>
                  <DashboardPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin/*"
              element={
                <ProtectedRoute>
                  <AdminPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/chat"
              element={
                <ProtectedRoute>
                  <ChatPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/memory"
              element={
                <ProtectedRoute>
                  <MemoryPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/questions"
              element={
                <ProtectedRoute>
                  <QuestionsPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/search"
              element={
                <ProtectedRoute>
                  <SearchPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/memory"
              element={
                <ProtectedRoute>
                  <QuestionsPage />
                </ProtectedRoute>
              }
            />
          </Routes>
        </SidebarInset>
      </SidebarProvider>
    </div>
  );
}

export default function App() {
  return (
    <Router>
      <AuthProvider>
        <AppContent />
      </AuthProvider>
    </Router>
  );
}
