import { Suspense, lazy } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';

// Import contexts
import { ThemeProvider } from '@/contexts/ThemeContext';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';

// Import pages
const SplashPage = lazy(() => import('@/pages/SplashPage'));
const LoginPage = lazy(() => import('@/pages/LoginPage'));
const SignupPage = lazy(() => import('@/pages/SignupPage'));
const DashboardPage = lazy(() => import('@/pages/DashboardPage'));
const AdminPage = lazy(() => import('@/pages/AdminPage'));

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

function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <Router>
          <Suspense fallback={<p>Loading…</p>}>
            <Routes>
              <Route path="/" element={<SplashPage />} />
              <Route path="/login" element={<LoginPage />} />
              <Route path="/signup" element={<SignupPage />} />
              <Route
                path="/dashboard"
                element={
                  <ProtectedRoute>
                    <DashboardPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/admin"
                element={
                  <ProtectedRoute>
                    <AdminPage />
                  </ProtectedRoute>
                }
              />
              <Route path="*" element={<Navigate to="/" />} />
            </Routes>
          </Suspense>
        </Router>
      </AuthProvider>
    </ThemeProvider>
  );
}

export default App;
