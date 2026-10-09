import React, { useState, useEffect } from 'react';
import { Switch, Route, Redirect } from 'wouter';
import { api, ApiError } from './api';
import { User } from '../shared/types';
import { Navbar } from './components/Navbar';
import { Login } from './pages/Login';
import { Contracts } from './pages/Contracts';
import { Settings } from './pages/Settings';

export const App: React.FC = () => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  // Check auth on load
  const checkAuth = async () => {
    try {
      const res = await api.get<{ user: User }>('/api/auth/me');
      setUser(res.user);
    } catch (err: unknown) {
      if (err instanceof ApiError && err.status === 401) {
        setUser(null);
      } else {
        console.error('Failed to check auth state:', err);
        setUser(null);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    checkAuth();
  }, []);

  const handleLogout = () => {
    setUser(null);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="flex flex-col items-center space-y-3">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          <span className="text-sm text-gray-500">加载 dueping ...</span>
        </div>
      </div>
    );
  }

  // Not authenticated: any page redirects to /login
  if (!user) {
    return (
      <Switch>
        <Route path="/login">
          <Login onLoginSuccess={(loggedInUser) => setUser(loggedInUser)} />
        </Route>
        <Route>
          <Redirect to="/login" />
        </Route>
      </Switch>
    );
  }

  // Authenticated
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col text-gray-900">
      <Navbar user={user} onLogout={handleLogout} />

      <main className="flex-1 pb-16">
        <Switch>
          <Route path="/">
            <Redirect to="/contracts" />
          </Route>
          <Route path="/contracts">
            <Contracts user={user} />
          </Route>
          <Route path="/settings">
            <Settings user={user} onUserUpdate={(updated) => setUser(updated)} />
          </Route>
          <Route path="/login">
            <Redirect to="/contracts" />
          </Route>
          <Route>
            <Redirect to="/contracts" />
          </Route>
        </Switch>
      </main>

      <footer className="border-t border-gray-200 py-6 text-center text-xs text-gray-400">
        <div className="max-w-6xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-2">
          <span>dueping &copy; {new Date().getFullYear()} — 超轻量合同到期提醒应用</span>
        </div>
      </footer>
    </div>
  );
};
