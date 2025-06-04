import { ReactNode, lazy } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';

import { ProtectedRoute } from './components/ProtectedRoute';
import { SidebarProvider } from './components/ui/sidebar';
import { AuthProvider } from './hooks';
import { Main as MainLayout } from './layouts';
import LoginPage from './pages/LoginPage';
import NotFound from './pages/NotFound';
import SignupPage from './pages/SignupPage';
import SplashPage from './pages/SplashPage';

const AdminPage = lazy(() => import('./pages/AdminPage'));
const AnswersPage = lazy(() => import('./pages/AnswersPage'));
const ChatPage = lazy(() => import('./pages/ChatPage'));
const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const FilesGalleryPage = lazy(() => import('./pages/FilesGalleryPage'));
const MemoryPage = lazy(() => import('./pages/MemoryPage'));
const QuestionsPage = lazy(() => import('./pages/QuestionsPage'));
const SearchPage = lazy(() => import('./pages/SearchPage'));

function Providers({ children }: { children: ReactNode }) {
  return (
    <Router>
      <AuthProvider args={[]}>
        <SidebarProvider>{children}</SidebarProvider>
      </AuthProvider>
    </Router>
  );
}

function AppRoutes() {
  return (
    <Routes>
      {/* No navigation for these pages */}
      <Route path="/" element={<SplashPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/signup" element={<SignupPage />} />

      {/* Main layout routes */}
      <Route element={<MainLayout />}>
        <Route
          path="/dashboard"
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
          path="/answers"
          element={
            <ProtectedRoute>
              <AnswersPage />
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

        <Route
          path="/files"
          element={
            <ProtectedRoute>
              <FilesGalleryPage />
            </ProtectedRoute>
          }
        />
      </Route>

      {/* Fallback */}
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

export default function App() {
  return (
    <Providers>
      <AppRoutes />
    </Providers>
  );
}
