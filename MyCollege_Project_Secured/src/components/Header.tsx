import React, { useState, useEffect } from 'react';
import {
  Bell,
  Search,
  CheckCircle2,
  Sparkles,
  
  User as UserIcon,
  Shield,
  GraduationCap,
  Briefcase,
  ArrowLeft,
  ChevronDown,
  LogOut,
  Users,
  Moon,
  Sun,
} from 'lucide-react';
import type { AppNotification, Institution, User, UserRole } from '../types';
import { api, setActiveUserId } from '../services/api';

interface HeaderProps {
  currentUser: User;
  institutions: Institution[];
  currentInstitution: Institution;
  allUsers: User[];
  notifications: AppNotification[];
  searchQuery: string;
  onSearchChange: (q: string) => void;
  onSelectInstitution: (inst: Institution) => void;
  onSwitchUser: (user: User) => void;
  onOpenNotifications: () => void;
  onOpenProfile: () => void;
  onGoBack?: () => void;
  canGoBack?: boolean;
  onLogout?: () => void;
  theme?: 'light' | 'dark';
  onToggleTheme?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  currentUser,
  institutions,
  currentInstitution,
  allUsers,
  notifications,
  searchQuery,
  onSearchChange,
  onSelectInstitution,
  onSwitchUser,
  onOpenNotifications,
  onOpenProfile,
  onGoBack,
  canGoBack,
  onLogout,
  theme,
  onToggleTheme,
}) => {
  const [showRoleSwitcher, setShowRoleSwitcher] = useState(false);
  const [showInstSelector, setShowInstSelector] = useState(false);

  const unreadCount = notifications.filter((n) => !n.isRead).length;

  const getRoleIcon = (role: UserRole) => {
    switch (role) {
      case 'admin':
        return <Shield className="w-3.5 h-3.5 text-indigo-600" />;
      case 'faculty':
        return <Briefcase className="w-3.5 h-3.5 text-blue-600" />;
      case 'coordinator':
        return <Users className="w-3.5 h-3.5 text-teal-600" />;
      default:
        return <GraduationCap className="w-3.5 h-3.5 text-emerald-600" />;
    }
  };

  const getRoleLabel = (role: UserRole) => {
    switch (role) {
      case 'admin':
        return 'Administrator';
      case 'faculty':
        return 'Faculty';
      case 'coordinator':
        return 'Coordinator';
      default:
        return 'Student';
    }
  };

  return (
    <header
      className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-slate-200 w-full max-w-full overflow-x-clip"
      style={{ paddingTop: 'max(env(safe-area-inset-top, 0px), 10px)' }}
    >
      <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-14 sm:h-16 gap-2 sm:gap-4">
          {/* Brand Zone */}
          <div className="flex items-center gap-2 min-w-0 flex-1 overflow-hidden">
            {onGoBack && canGoBack && (
              <button
                type="button"
                onClick={onGoBack}
                className="flex items-center gap-1 px-2 py-1 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-blue-50 hover:text-blue-700 hover:border-blue-200 rounded-lg transition-all border border-slate-200 shadow-2xs cursor-pointer mr-0.5 shrink-0"
                title="Return to previous screen"
              >
                <ArrowLeft className="w-4 h-4 text-slate-600 group-hover:text-blue-600" />
                <span className="hidden sm:inline">Back</span>
              </button>
            )}

            <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-white font-bold text-base shadow-sm shrink-0">
              M
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="font-bold text-base sm:text-lg text-slate-900 tracking-tight shrink-0">MyCollege</span>
                <span className="text-[10px] sm:text-[11px] font-medium text-blue-700 bg-blue-50 border border-blue-100 rounded px-1.5 py-0.2 shrink-0">
                  Campus OS
                </span>
              </div>
              {/* Institution Switcher dropdown */}
              <div className="relative">
                <span className="block truncate max-w-[130px] sm:max-w-xs text-[11px] text-slate-500">
                  {currentInstitution.name}
                </span>
                {showInstSelector && (
                  <div className="absolute left-0 mt-1 w-72 bg-white rounded-lg shadow-lg border border-slate-200 py-1.5 z-50">
                    <div className="px-3 py-1 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                      Select Institution
                    </div>
                    {institutions.map((inst) => (
                      <button
                        key={inst.id}
                        onClick={() => {
                          onSelectInstitution(inst);
                          setShowInstSelector(false);
                        }}
                        className={`w-full text-left px-3 py-2 text-xs flex items-center justify-between hover:bg-slate-50 transition-colors ${
                          inst.id === currentInstitution.id
                            ? 'text-blue-600 font-semibold bg-blue-50/50'
                            : 'text-slate-700'
                        }`}
                      >
                        <div>
                          <div className="font-medium">{inst.name}</div>
                          <div className="text-[11px] text-slate-500">{inst.city}</div>
                        </div>
                        {inst.id === currentInstitution.id && (
                          <CheckCircle2 className="w-4 h-4 text-blue-600 shrink-0 ml-2" />
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Search bar */}
          <div className="hidden sm:flex flex-1 max-w-md mx-2">
            <div className="relative w-full">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                <Search className="w-4 h-4" />
              </div>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => onSearchChange(e.target.value)}
                placeholder="Search notices, exams, hackathons, departments..."
                className="w-full pl-9 pr-4 py-2 bg-slate-50 hover:bg-slate-100/70 focus:bg-white text-xs sm:text-sm text-slate-900 placeholder:text-slate-400 rounded-lg border border-slate-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none transition-all"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => onSearchChange('')}
                  className="absolute inset-y-0 right-0 pr-2.5 flex items-center text-xs text-slate-400 hover:text-slate-600"
                >
                  Clear
                </button>
              )}
            </div>
          </div>

          {/* Action Zone: Theme, Notifications, Profile, Logout */}
          <div className="flex items-center gap-1 sm:gap-2.5 shrink-0 ml-auto">
            {/* Quick Role Tester Switcher (Dev Mode) */}
            {import.meta.env.DEV &&
              currentUser.role !== 'student' &&
              currentUser.role !== 'faculty' && (
              <div className="relative hidden md:block">
                <button
                  type="button"
                  onClick={() => setShowRoleSwitcher(!showRoleSwitcher)}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-200 hover:border-slate-300 bg-white hover:bg-slate-50 text-xs text-slate-700 transition-colors shadow-2xs"
                  title="Switch active user to preview all 4 roles"
                >
                  {getRoleIcon(currentUser.role)}
                  <span className="hidden md:inline font-medium">{currentUser.name.split(' ')[0]}</span>
                  <span className="text-[11px] text-slate-500 capitalize hidden sm:inline">
                    ({getRoleLabel(currentUser.role)})
                  </span>
                  <ChevronDown className="w-3 h-3 text-slate-400" />
                </button>

                {showRoleSwitcher && (
                  <div className="absolute right-0 mt-1 w-64 bg-white rounded-lg shadow-lg border border-slate-200 py-2 z-50">
                    <div className="px-3 py-1 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                      Switch Test Account
                    </div>
                    {allUsers.map((u) => (
                      <button
                        key={u.id}
                        onClick={() => {
                          setActiveUserId(u.id);
                          onSwitchUser(u);
                          setShowRoleSwitcher(false);
                        }}
                        className={`w-full text-left px-3 py-2 text-xs flex items-center justify-between hover:bg-slate-50 transition-colors ${
                          u.id === currentUser.id
                            ? 'bg-blue-50 text-blue-700 font-semibold'
                            : 'text-slate-700'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          {getRoleIcon(u.role)}
                          <div className="font-medium text-slate-900">{u.name}</div>
                        </div>
                        {u.id === currentUser.id && (
                          <CheckCircle2 className="w-4 h-4 text-blue-600 shrink-0" />
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Dark / Light Mode Toggle Button */}
            {onToggleTheme && (
              <button
                type="button"
                onClick={onToggleTheme}
                className="p-1.5 sm:p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
                title={`Switch to ${theme === 'light' ? 'Dark' : 'Light'} Mode`}
                aria-label="Toggle theme mode"
              >
                {theme === 'dark' ? (
                  <Sun className="w-4 h-4 sm:w-5 sm:h-5 text-amber-500" />
                ) : (
                  <Moon className="w-4 h-4 sm:w-5 sm:h-5 text-slate-600" />
                )}
              </button>
            )}

            {/* Notification Bell */}
            <button
              type="button"
              onClick={onOpenNotifications}
              className="relative p-1.5 sm:p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
              aria-label="View notifications"
            >
              <Bell className="w-5 h-5" />
              {unreadCount > 0 && (
                <span className="absolute top-1 right-1 flex items-center justify-center min-w-[16px] h-[16px] px-1 text-[9px] font-bold text-white bg-rose-600 rounded-full tabular-nums border-2 border-white">
                  {unreadCount}
                </span>
              )}
            </button>

            {/* User Profile avatar */}
            <button
              type="button"
              onClick={onOpenProfile}
              className="flex items-center gap-1.5 p-1 pl-1 pr-1 sm:pr-2 rounded-lg hover:bg-slate-100 border border-transparent hover:border-slate-200 transition-colors cursor-pointer"
              aria-label="Open user profile"
            >
              <div className="w-7 h-7 rounded-full bg-blue-100 text-blue-700 font-semibold text-xs flex items-center justify-center shrink-0">
                {currentUser.name
                  .split(' ')
                  .map((n) => n[0])
                  .join('')
                  .slice(0, 2)}
              </div>
              <div className="hidden lg:flex flex-col text-left">
                <span className="text-xs font-semibold text-slate-900 leading-tight">
                  {currentUser.name}
                </span>
                {currentUser.designation && (
                  <span className="text-[10px] text-blue-700 leading-tight">
                    {currentUser.designation}
                  </span>
                )}
              </div>
            </button>

            {/* Secure Sign Out Button */}
            {onLogout && (
              <button
                type="button"
                onClick={onLogout}
                className="p-1.5 sm:p-2 text-slate-500 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                title="Sign out securely"
                aria-label="Sign out"
              >
                <LogOut className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* Mobile search bar */}
        <div className="sm:hidden pb-3">
          <div className="relative w-full">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
              <Search className="w-4 h-4" />
            </div>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Search announcements, exams, events..."
              className="w-full pl-9 pr-4 py-2 bg-slate-50 text-xs text-slate-900 placeholder:text-slate-400 rounded-lg border border-slate-200 outline-none"
            />
          </div>
        </div>
      </div>
    </header>
  );
};
