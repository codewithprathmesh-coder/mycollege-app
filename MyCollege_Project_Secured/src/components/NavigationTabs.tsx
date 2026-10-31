import React from 'react';
import {
  Home,
  Compass,
  MessageSquare,
  BookmarkCheck,
  LayoutDashboard,
  ShieldCheck,
  Users,
} from 'lucide-react';
import type { UserRole } from '../types';

export type ActiveTab = 'home' | 'explore' | 'chat' | 'directory' | 'activities' | 'desk' | 'admin';

interface NavigationTabsProps {
  activeTab: ActiveTab;
  onTabChange: (tab: ActiveTab) => void;
  userRole: UserRole;
  pendingApprovalsCount?: number;
  savedCount?: number;
  unreadChatCount?: number;
}

export const NavigationTabs: React.FC<NavigationTabsProps> = ({
  activeTab,
  onTabChange,
  userRole,
  pendingApprovalsCount = 0,
  savedCount = 0,
  unreadChatCount = 0,
}) => {
  const isFacultyOrCoord = userRole === 'faculty' || userRole === 'coordinator';
  const isAdmin = userRole === 'admin';

  return (
    <div className="bg-white border-b border-slate-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <nav className="flex items-center gap-1 sm:gap-2 -mb-px overflow-x-auto no-scrollbar py-2">
          <button
            type="button"
            onClick={() => onTabChange('home')}
            className={`flex items-center gap-2 px-3.5 py-2 text-xs sm:text-sm font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'home'
                ? 'bg-blue-50 text-blue-700 font-semibold'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100/70'
            }`}
          >
            <Home className="w-4 h-4" />
            <span>{userRole === 'faculty' ? 'Faculty Dashboard' : 'Feed & Notices'}</span>
          </button>

          {userRole !== 'faculty' && <button
            type="button"
            onClick={() => onTabChange('explore')}
            className={`flex items-center gap-2 px-3.5 py-2 text-xs sm:text-sm font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'explore'
                ? 'bg-blue-50 text-blue-700 font-semibold'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100/70'
            }`}
          >
            <Compass className="w-4 h-4" />
            <span>Explore Opportunities</span>
          </button>}

          {/* Student Class & Interest Circles Chat */}
          <button
            type="button"
            onClick={() => onTabChange('chat')}
            className={`relative flex items-center gap-2 px-3.5 py-2 text-xs sm:text-sm font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'chat'
                ? 'bg-blue-50 text-blue-700 font-semibold'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100/70'
            }`}
          >
            <MessageSquare className="w-4 h-4" />
            <span>{userRole === 'faculty' ? 'Groups' : 'Class & Group Circles'}</span>
            {unreadChatCount > 0 && (
              <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-blue-600 text-white font-bold font-mono">
                {unreadChatCount}
              </span>
            )}
          </button>

          {/* Batch Directory */}
          <button
            type="button"
            onClick={() => onTabChange('directory')}
            className={`relative flex items-center gap-2 px-3.5 py-2 text-xs sm:text-sm font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'directory'
                ? 'bg-blue-50 text-blue-700 font-semibold'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100/70'
            }`}
          >
            <Users className="w-4 h-4 text-indigo-600" />
            <span>{userRole === 'faculty' ? 'Batch Management' : 'Batch Directory'}</span>
          </button>

          {userRole !== 'faculty' && <button
            type="button"
            onClick={() => onTabChange('activities')}
            className={`flex items-center gap-2 px-3.5 py-2 text-xs sm:text-sm font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'activities'
                ? 'bg-blue-50 text-blue-700 font-semibold'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100/70'
            }`}
          >
            <BookmarkCheck className="w-4 h-4" />
            <span>My Activities</span>
            {savedCount > 0 && (
              <span className="text-[11px] px-1.5 py-0.2 rounded-full bg-slate-200 text-slate-700 font-mono">
                {savedCount}
              </span>
            )}
          </button>}

          {/* Faculty / Coordinator Portal */}
          {(isFacultyOrCoord || isAdmin) && (
            <button
              type="button"
              onClick={() => onTabChange('desk')}
              className={`flex items-center gap-2 px-3.5 py-2 text-xs sm:text-sm font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 ${
                activeTab === 'desk'
                  ? 'bg-blue-50 text-blue-700 font-semibold'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100/70'
              }`}
            >
              <LayoutDashboard className="w-4 h-4" />
              <span>Publishing Desk</span>
            </button>
          )}

          {/* Admin Console */}
          {isAdmin && (
            <button
              type="button"
              onClick={() => onTabChange('admin')}
              className={`flex items-center gap-2 px-3.5 py-2 text-xs sm:text-sm font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 ${
                activeTab === 'admin'
                  ? 'bg-indigo-50 text-indigo-700 font-semibold'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100/70'
              }`}
            >
              <ShieldCheck className="w-4 h-4 text-indigo-600" />
              <span>Admin Console</span>
              {pendingApprovalsCount > 0 && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500 text-white font-bold tabular-nums">
                  {pendingApprovalsCount}
                </span>
              )}
            </button>
          )}
        </nav>
      </div>
    </div>
  );
};

export const MobileNav: React.FC<NavigationTabsProps> = ({
  activeTab,
  onTabChange,
  userRole,
  pendingApprovalsCount = 0,
  unreadChatCount = 3,
}) => {
  const isFacultyOrCoord = userRole === 'faculty' || userRole === 'coordinator';
  const isAdmin = userRole === 'admin';
  const isFaculty = userRole === 'faculty';

  return (
    <div className="fixed bottom-0 left-0 right-0 z-40 bg-white border-t border-slate-200 sm:hidden pb-safe">
      <div className={`grid ${isFaculty ? 'grid-cols-4' : 'grid-cols-5'} h-14`}>
        <button
          type="button"
          onClick={() => onTabChange('home')}
          className={`flex flex-col items-center justify-center text-[10px] ${
            activeTab === 'home' ? 'text-blue-600 font-semibold' : 'text-slate-500'
          }`}
        >
          <Home className="w-5 h-5 mb-0.5" />
          <span>{isFaculty ? 'Dashboard' : 'Feed'}</span>
        </button>

        <button
          type="button"
          onClick={() => onTabChange('chat')}
          className={`relative flex flex-col items-center justify-center text-[10px] ${
            activeTab === 'chat' ? 'text-blue-600 font-semibold' : 'text-slate-500'
          }`}
        >
          <MessageSquare className="w-5 h-5 mb-0.5" />
          <span>{isFaculty ? 'Groups' : 'Circles'}</span>
          {unreadChatCount > 0 && (
            <span className="absolute top-1 right-3 w-2 h-2 rounded-full bg-blue-600" />
          )}
        </button>

        <button
          type="button"
          onClick={() => onTabChange('directory')}
          className={`flex flex-col items-center justify-center text-[10px] ${
            activeTab === 'directory' ? 'text-indigo-600 font-semibold' : 'text-slate-500'
          }`}
        >
          <Users className="w-5 h-5 mb-0.5" />
          <span>{isFaculty ? 'Batches' : 'Batch'}</span>
        </button>

        {isFaculty ? (
          <button
            type="button"
            onClick={() => onTabChange('desk')}
            className={`flex flex-col items-center justify-center text-[10px] ${
              activeTab === 'desk' ? 'text-blue-600 font-semibold' : 'text-slate-500'
            }`}
          >
            <LayoutDashboard className="w-5 h-5 mb-0.5" />
            <span>Desk</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={() => onTabChange('explore')}
            className={`flex flex-col items-center justify-center text-[10px] ${
              activeTab === 'explore' ? 'text-blue-600 font-semibold' : 'text-slate-500'
            }`}
          >
            <Compass className="w-5 h-5 mb-0.5" />
            <span>Explore</span>
          </button>
        )}

        {isFaculty ? null : isFacultyOrCoord ? (
          <button
            type="button"
            onClick={() => onTabChange('desk')}
            className={`flex flex-col items-center justify-center text-[10px] ${
              activeTab === 'desk' ? 'text-blue-600 font-semibold' : 'text-slate-500'
            }`}
          >
            <LayoutDashboard className="w-5 h-5 mb-0.5" />
            <span>Desk</span>
          </button>
        ) : isAdmin ? (
          <button
            type="button"
            onClick={() => onTabChange('admin')}
            className={`relative flex flex-col items-center justify-center text-[10px] ${
              activeTab === 'admin' ? 'text-indigo-600 font-semibold' : 'text-slate-500'
            }`}
          >
            <ShieldCheck className="w-5 h-5 mb-0.5" />
            <span>Admin</span>
            {pendingApprovalsCount > 0 && (
              <span className="absolute top-1 right-3 w-2 h-2 rounded-full bg-amber-500" />
            )}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => onTabChange('activities')}
            className={`flex flex-col items-center justify-center text-[10px] ${
              activeTab === 'activities' ? 'text-blue-600 font-semibold' : 'text-slate-500'
            }`}
          >
            <BookmarkCheck className="w-5 h-5 mb-0.5" />
            <span>Passes</span>
          </button>
        )}
      </div>
    </div>
  );
};
