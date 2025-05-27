import { Suspense, lazy } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar';

// Lazy load pages
const LoginPage = lazy(() => import('@/pages/LoginPage'));
const DashboardPage = lazy(() => import('@/pages/DashboardPage'));
const AdminPage = lazy(() => import('@/pages/AdminPage'));
const ChatPage = lazy(() => import('@/pages/ChatPage'));
const MemoryPage = lazy(() => import('@/pages/MemoryPage'));
const QuestionsPage = lazy(() => import('@/pages/QuestionsPage'));

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  
  if (loading) {
    return <div className="flex items-center justify-center min-h-svh">Loading...</div>;
  }
  
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  
  return <>{children}</>;
}

function AppContent() {
  const location = useLocation();
  const { user } = useAuth();
  
  const showSidebar = user && location.pathname !== '/login';

  return (
    <div className="flex h-screen">
      {showSidebar ? (
        <SidebarProvider>
          <SidebarInset>
            <Routes>
              <Route path="/login" element={<Navigate to="/" replace />} />
              <Route path="/" element={
                <ProtectedRoute>
                  <Suspense fallback={<div>Loading...</div>}>
                    <DashboardPage />
                  </Suspense>
                </ProtectedRoute>
              } />
              <Route path="/admin/*" element={
                <ProtectedRoute>
                  <Suspense fallback={<div>Loading...</div>}>
                    <AdminPage />
                  </Suspense>
                </ProtectedRoute>
              } />
              <Route path="/chat" element={
                <ProtectedRoute>
                  <Suspense fallback={<div>Loading...</div>}>
                    <ChatPage />
                  </Suspense>
                </ProtectedRoute>
              } />
              <Route path="/memory" element={
                <ProtectedRoute>
                  <Suspense fallback={<div>Loading...</div>}>
                    <MemoryPage />
                  </Suspense>
                </ProtectedRoute>
              } />
              <Route path="/questions" element={
                <ProtectedRoute>
                  <Suspense fallback={<div>Loading...</div>}>
                    <QuestionsPage />
                  </Suspense>
                </ProtectedRoute>
              } />
            </Routes>
          </SidebarInset>
        </SidebarProvider>
      ) : (
        <div className="w-full">
          <Routes>
            <Route path="/login" element={
              <Suspense fallback={<div>Loading...</div>}>
                <LoginPage />
              </Suspense>
            } />
            <Route path="/signup" element={
              <Suspense fallback={<div>Loading...</div>}>
                <LoginPage />
              </Suspense>
            } />
            <Route path="*" element={<Navigate to="/login" replace />} />
          </Routes>
        </div>
      )}
    </div>
  );
}

function App() {
  return (
    <Router>
      <AuthProvider>
        <AppContent />
      </AuthProvider>
    </Router>
  );
}

export default App;
