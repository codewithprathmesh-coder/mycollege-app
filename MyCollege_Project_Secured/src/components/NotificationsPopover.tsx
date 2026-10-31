import React, { useState } from 'react';
import {
  X,
  Check,
  CheckCheck,
  Bell,
  AlertCircle,
  Clock,
  Ticket,
  ShieldCheck,
  Sparkles,
  Trophy,
  Code2,
  Filter,
  ArrowRight,
  SlidersHorizontal,
} from 'lucide-react';
import type { AppNotification, User } from '../types';

interface NotificationsPopoverProps {
  notifications: AppNotification[];
  currentUser: User;
  onClose: () => void;
  onSelectNotification: (announcementId?: string) => void;
  onMarkRead: (id: string) => void;
  onMarkAllRead: () => void;
  onOpenPreferences?: () => void;
}

export const NotificationsPopover: React.FC<NotificationsPopoverProps> = ({
  notifications,
  currentUser,
  onClose,
  onSelectNotification,
  onMarkRead,
  onMarkAllRead,
  onOpenPreferences,
}) => {
  const [activeTab, setActiveTab] = useState<'all' | 'unread'>('all');
  const [selectedPriorityFilter, setSelectedPriorityFilter] = useState<'all' | 'p1' | 'p2' | 'p3'>('all');

  const orderedPrefs = currentUser.orderedPreferences || ['Technical Events', 'Sports', 'Academics'];
  const isFaculty = currentUser.role === 'faculty';

  // Categorize notifications into the 3 priorities
  const categorizeNotification = (n: AppNotification): 'p1' | 'p2' | 'p3' => {
    // Priority 1: Urgent & Important (urgent notices, exam notices, deadlines, administrative approval)
    if (
      n.type === 'urgent' ||
      n.type === 'deadline' ||
      n.type === 'approval' ||
      n.title.toLowerCase().includes('exam') ||
      n.title.toLowerCase().includes('mandatory')
    ) {
      return 'p1';
    }

    // Priority 2: Matches user's top preferences
    const content = (n.title + ' ' + n.message).toLowerCase();
    const matchesPref = !isFaculty && orderedPrefs.some((pref) => content.includes(pref.toLowerCase().slice(0, 5)));
    if (matchesPref || n.type === 'registration') {
      return 'p2';
    }

    // Priority 3: Other updates & routine messages
    return 'p3';
  };

  const getPriorityBadge = (p: 'p1' | 'p2' | 'p3') => {
    switch (p) {
      case 'p1':
        return (
          <span className="text-[10px] font-bold font-mono px-2 py-0.5 rounded bg-rose-100 text-rose-800 border border-rose-200">
            P1: Urgent
          </span>
        );
      case 'p2':
        return (
          <span className="text-[10px] font-bold font-mono px-2 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-200">
            P2: {isFaculty ? 'Updates' : 'Preferred'}
          </span>
        );
      case 'p3':
        return (
          <span className="text-[10px] font-bold font-mono px-2 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200">
            P3: General
          </span>
        );
    }
  };

  const getPriorityStyle = (p: 'p1' | 'p2' | 'p3', isRead: boolean) => {
    if (p === 'p1') {
      return isRead
        ? 'bg-rose-50/30 border-l-4 border-l-rose-400'
        : 'bg-rose-50/80 border-l-4 border-l-rose-600';
    }
    if (p === 'p2') {
      return isRead
        ? 'bg-amber-50/30 border-l-4 border-l-amber-400'
        : 'bg-amber-50/80 border-l-4 border-l-amber-500';
    }
    return isRead
      ? 'bg-white border-l-4 border-l-transparent'
      : 'bg-blue-50/40 border-l-4 border-l-blue-500';
  };

  const getIcon = (n: AppNotification) => {
    const p = categorizeNotification(n);
    if (p === 'p1') return <AlertCircle className="w-4 h-4 text-rose-600" />;
    if (p === 'p2') return <Sparkles className="w-4 h-4 text-amber-600" />;
    if (n.type === 'registration') return <Ticket className="w-4 h-4 text-emerald-600" />;
    return <Bell className="w-4 h-4 text-blue-600" />;
  };

  const formatTime = (iso: string) => {
    try {
      const d = new Date(iso);
      return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', month: 'short', day: 'numeric' });
    } catch {
      return iso;
    }
  };

  const unreadCount = notifications.filter((n) => !n.isRead).length;

  // Filter and sort notifications (P1 first, then P2, then P3, then recency)
  const filteredNotifications = notifications
    .filter((n) => {
      if (activeTab === 'unread' && n.isRead) return false;
      if (selectedPriorityFilter !== 'all') {
        return categorizeNotification(n) === selectedPriorityFilter;
      }
      return true;
    })
    .sort((a, b) => {
      const pOrder = { p1: 1, p2: 2, p3: 3 };
      const scoreA = pOrder[categorizeNotification(a)];
      const scoreB = pOrder[categorizeNotification(b)];
      if (scoreA !== scoreB) return scoreA - scoreB;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-2xs flex justify-end">
      <div className="w-full max-w-md bg-white h-full shadow-2xl border-l border-slate-200 flex flex-col animate-in slide-in-from-right duration-200">
        {/* Header */}
        <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/70">
          <div className="flex items-center gap-2">
            <Bell className="w-5 h-5 text-blue-600" />
            <h3 className="font-bold text-base text-slate-900">Notification Center</h3>
            {unreadCount > 0 && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 font-semibold tabular-nums">
                {unreadCount} unread
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={onMarkAllRead}
                className="text-xs text-blue-600 hover:text-blue-800 font-semibold flex items-center gap-1 cursor-pointer"
                title="Mark all as read"
              >
                <CheckCheck className="w-3.5 h-3.5" />
                <span>Mark All Read</span>
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Tab & Priority Filter Bar */}
        <div className="p-3 border-b border-slate-200 bg-white space-y-2">
          {/* Tabs: All vs Unread */}
          <div className="flex rounded-xl bg-slate-100 p-1 text-xs">
            <button
              type="button"
              onClick={() => setActiveTab('all')}
              className={`flex-1 py-1.5 rounded-lg font-semibold transition-colors cursor-pointer ${
                activeTab === 'all'
                  ? 'bg-white text-slate-900 shadow-2xs'
                  : 'text-slate-500 hover:text-slate-900'
              }`}
            >
              All Notifications ({notifications.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('unread')}
              className={`flex-1 py-1.5 rounded-lg font-semibold transition-colors cursor-pointer ${
                activeTab === 'unread'
                  ? 'bg-white text-slate-900 shadow-2xs'
                  : 'text-slate-500 hover:text-slate-900'
              }`}
            >
              Unread Only ({unreadCount})
            </button>
          </div>

          {/* Priority Quick Filter Chips */}
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar text-[11px] pt-1">
            <span className="text-slate-400 font-semibold text-[10px] uppercase shrink-0">
              Priority:
            </span>
            {[
              { id: 'all', label: 'All' },
              { id: 'p1', label: '🚨 P1: Urgent' },
              { id: 'p2', label: isFaculty ? '📌 P2: Updates' : '⭐ P2: Preferences' },
              { id: 'p3', label: '💬 P3: Other' },
            ].map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setSelectedPriorityFilter(f.id as any)}
                className={`px-2.5 py-1 rounded-lg font-medium whitespace-nowrap transition-colors cursor-pointer ${
                  selectedPriorityFilter === f.id
                    ? 'bg-blue-600 text-white font-bold'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {/* Notifications List */}
        <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
          {filteredNotifications.length === 0 ? (
            <div className="p-8 text-center text-slate-400 text-xs sm:text-sm space-y-2">
              <Bell className="w-8 h-8 mx-auto opacity-30 text-slate-400" />
              <p className="font-semibold text-slate-700">No notifications in this view</p>
              <p className="text-xs text-slate-400">
                {isFaculty
                  ? 'You will receive alerts here for urgent notices, exam timetables, and registrations.'
                  : 'You will receive alerts here for urgent notices, exam timetables, and items matching your preferences.'}
              </p>
            </div>
          ) : (
            filteredNotifications.map((n) => {
              const priority = categorizeNotification(n);
              return (
                <div
                  key={n.id}
                  onClick={() => {
                    if (!n.isRead) onMarkRead(n.id);
                    if (n.announcementId) onSelectNotification(n.announcementId);
                  }}
                  className={`p-4 transition-colors cursor-pointer hover:bg-slate-50 flex items-start gap-3 ${getPriorityStyle(
                    priority,
                    n.isRead
                  )}`}
                >
                  <div className="p-2 rounded-xl bg-white shadow-2xs border border-slate-200 shrink-0 mt-0.5">
                    {getIcon(n)}
                  </div>

                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      {getPriorityBadge(priority)}
                      <span className="text-[11px] text-slate-400 font-mono whitespace-nowrap shrink-0">
                        {formatTime(n.createdAt)}
                      </span>
                    </div>

                    <h4
                      className={`text-xs sm:text-sm line-clamp-1 ${
                        !n.isRead ? 'font-bold text-slate-900' : 'font-medium text-slate-700'
                      }`}
                    >
                      {n.title}
                    </h4>

                    <p className="text-xs text-slate-600 line-clamp-2 leading-relaxed">
                      {n.message}
                    </p>

                    <div className="pt-1 flex items-center justify-between">
                      <span className="text-[10px] text-slate-400 font-semibold uppercase">
                        Source: {n.announcementId ? 'Notice Board' : 'Class Circle'}
                      </span>
                      {n.announcementId && (
                        <span className="text-[11px] text-blue-600 font-semibold flex items-center gap-0.5">
                          <span>Open Notice</span>
                          <ArrowRight className="w-3 h-3" />
                        </span>
                      )}
                    </div>
                  </div>

                  {!n.isRead && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onMarkRead(n.id);
                      }}
                      className="p-1 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded transition-colors shrink-0 mt-1 cursor-pointer"
                      title="Mark as read"
                    >
                      <Check className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Footer with Preferences Shortcut */}
        {!isFaculty && onOpenPreferences && (
          <div className="p-3 border-t border-slate-100 bg-slate-50 flex items-center justify-between text-xs text-slate-600">
            <span className="truncate">Prioritizing: <strong>{orderedPrefs.join(', ')}</strong></span>
            <button
              type="button"
              onClick={onOpenPreferences}
              className="text-blue-600 hover:text-blue-800 font-bold shrink-0 cursor-pointer ml-2"
            >
              Edit Priorities
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
