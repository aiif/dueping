import React from 'react';
import { Link, useLocation } from 'wouter';
import { User } from '../../shared/types';
import { api } from '../api';

interface NavbarProps {
  user: User;
  onLogout: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({ user, onLogout }) => {
  const [location] = useLocation();

  const handleLogout = async () => {
    try {
      await api.post('/api/auth/logout');
    } catch (e) {
      console.error('Logout error:', e);
    } finally {
      onLogout();
    }
  };

  const navLinkClass = (path: string) => {
    const isActive = location === path || (path === '/contracts' && location === '/');
    return `px-3 py-2 rounded-md text-sm font-medium transition-colors ${
      isActive
        ? 'bg-blue-50 text-blue-700 font-semibold'
        : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
    }`;
  };

  return (
    <header className="bg-white border-b border-gray-200 sticky top-0 z-20 shadow-xs">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <div className="flex items-center space-x-6">
            <Link href="/contracts" className="flex items-center space-x-2 text-blue-600 font-bold text-xl tracking-tight">
              <span className="text-2xl">🔔</span>
              <span>dueping</span>
            </Link>
            <nav className="hidden sm:flex space-x-1">
              <Link href="/contracts" className={navLinkClass('/contracts')}>
                合同管理
              </Link>
              <Link href="/settings" className={navLinkClass('/settings')}>
                提醒设置
              </Link>
            </nav>
          </div>

          <div className="flex items-center space-x-3">
            <div className="hidden md:flex flex-col text-right">
              <span className="text-xs text-gray-400">当前账号</span>
              <span className="text-sm font-medium text-gray-700 truncate max-w-[200px]" title={user.email}>
                {user.email}
              </span>
            </div>
            <button
              onClick={handleLogout}
              className="text-xs sm:text-sm text-gray-600 hover:text-red-600 hover:bg-red-50 border border-gray-200 hover:border-red-200 px-3 py-1.5 rounded-md transition-colors"
            >
              退出登录
            </button>
          </div>
        </div>

        {/* Mobile Submenu */}
        <div className="sm:hidden flex border-t border-gray-100 py-2 space-x-2">
          <Link href="/contracts" className={`flex-1 text-center ${navLinkClass('/contracts')}`}>
            合同管理
          </Link>
          <Link href="/settings" className={`flex-1 text-center ${navLinkClass('/settings')}`}>
            提醒设置
          </Link>
        </div>
      </div>
    </header>
  );
};
