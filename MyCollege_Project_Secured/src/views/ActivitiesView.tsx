import React, { useState } from 'react';
import {
  Bookmark,
  Ticket,
  Clock,
  Calendar,
  CheckCircle2,
  Trash2,
  ChevronRight,
  MapPin,
  AlertCircle,
  FileText,
} from 'lucide-react';
import type { Announcement, EventRegistration, User } from '../types';
import { AnnouncementCard } from '../components/AnnouncementCard';

interface ActivitiesViewProps {
  currentUser: User;
  announcements: Announcement[];
  savedIds: string[];
  registrations: EventRegistration[];
  onToggleSave: (id: string) => void;
  onOpenDetails: (announcement: Announcement) => void;
  onCancelRegistration: (regId: string) => Promise<void>;
}

type ActivityTab = 'saved' | 'registered' | 'deadlines';

export const ActivitiesView: React.FC<ActivitiesViewProps> = ({
  currentUser,
  announcements,
  savedIds,
  registrations,
  onToggleSave,
  onOpenDetails,
  onCancelRegistration,
}) => {
  const [activeTab, setActiveTab] = useState<ActivityTab>('registered');
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  // Saved notices
  const savedAnnouncements = announcements.filter((a) => savedIds.includes(a.id));

  // Registered activities joined with announcement data
  const registeredEvents = registrations.map((r) => {
    const ann = announcements.find((a) => a.id === r.announcementId);
    return { registration: r, announcement: ann };
  });

  // Approaching deadlines
  const deadlines = announcements
    .filter((a) => a.registrationDeadline)
    .sort((a, b) => new Date(a.registrationDeadline!).getTime() - new Date(b.registrationDeadline!).getTime());

  const handleCancel = async (regId: string) => {
    if (!confirm('Are you sure you want to cancel this event registration?')) return;
    setCancellingId(regId);
    try {
      await onCancelRegistration(regId);
    } finally {
      setCancellingId(null);
    }
  };

  const formatDate = (iso?: string) => {
    if (!iso) return 'N/A';
    try {
      const d = new Date(iso);
      return d.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
    } catch {
      return iso;
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
      {/* View Header */}
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
          My Activities & Records
        </h1>
        <p className="text-xs sm:text-sm text-slate-500">
          Track your bookmarked circulars, confirmed event passes, and approaching academic deadlines.
        </p>
      </div>

    {/* Sub-tabs */}
      <div className="flex items-center gap-2 border-b border-slate-200 pb-2">
        
        {/* 1. Registered Activities Button */}
        <button
          type="button"
          onClick={() => setActiveTab('registered')}
          className={`flex items-center gap-2 px-4 py-2 text-xs sm:text-sm font-semibold rounded-lg transition-colors ${
            activeTab === 'registered'
              ? 'bg-blue-600 text-white shadow-2xs'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
          }`}
        >
          <Ticket className="w-4 h-4" />
          <span>Registered Activities</span>
          {registrations?.length > 0 && (
            <span className="text-xs px-1.5 py-0.2 rounded-full bg-white/20 font-mono">
              {registrations.length}
            </span>
          )}
        </button>

        {/* 2. Saved Notices Button */}
        <button
          type="button"
          onClick={() => setActiveTab('saved')}
          className={`flex items-center gap-2 px-4 py-2 text-xs sm:text-sm font-semibold rounded-lg transition-colors ${
            activeTab === 'saved'
              ? 'bg-blue-600 text-white shadow-2xs'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
          }`}
        >
          <Bookmark className="w-4 h-4" />
          <span>Saved Notices</span>
       {false && (
            <span className="text-xs px-1.5 py-0.2 rounded-full bg-white/20 font-mono">
              {savedIds.length}
            </span>
          )}
        </button>

        {/* 3. Academic Deadlines Button */}
        <button
          type="button"
          onClick={() => setActiveTab('deadlines')}
          className={`flex items-center gap-2 px-4 py-2 text-xs sm:text-sm font-semibold rounded-lg transition-colors ${
            activeTab === 'deadlines'
              ? 'bg-blue-600 text-white shadow-2xs'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
          }`}
        >
          <Clock className="w-4 h-4" />
          <span>Academic Deadlines</span>
          {deadlines?.length > 0 && (
            <span className="text-xs px-1.5 py-0.2 rounded-full bg-white/20 font-mono">
              {deadlines.length}
            </span>
          )}
        </button>
        
      </div>
      {/* Content based on sub-tab */}
      {activeTab === 'registered' && (
        <div className="space-y-4">
          {registeredEvents.length === 0 ? (
            <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center text-slate-500">
              <Ticket className="w-8 h-8 text-slate-300 mx-auto mb-2" />
              <h4 className="font-semibold text-sm text-slate-800">No active registrations</h4>
              <p className="text-xs text-slate-400 max-w-sm mx-auto mt-1">
                Explore campus hackathons, fests, or sports trials and register with 1-click to generate admission passes.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {registeredEvents.map(({ registration, announcement }) => (
                <div
                  key={registration.id}
                  className="bg-white rounded-xl border border-emerald-200 p-5 shadow-2xs space-y-3 relative overflow-hidden"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-700 mb-1">
                        <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                        <span>CONFIRMED ENTRY PASS</span>
                      </div>
                      <h3 className="font-bold text-base text-slate-900 leading-tight">
                        {registration.announcementTitle}
                      </h3>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleCancel(registration.id)}
                      disabled={cancellingId === registration.id}
                      className="p-1.5 text-slate-400 hover:text-rose-600 rounded-lg hover:bg-rose-50 transition-colors"
                      title="Cancel registration"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Ticket Details Strip */}
                  <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 text-xs font-mono flex items-center justify-between">
                    <div>
                      <span className="text-slate-400 block text-[10px]">TICKET PASS CODE</span>
                      <span className="font-bold text-slate-900 text-sm tracking-wider">
                        {registration.ticketCode}
                      </span>
                    </div>
                    <div className="text-right">
                      <span className="text-slate-400 block text-[10px]">REGISTERED FOR</span>
                      <span className="text-slate-700">{currentUser.name}</span>
                    </div>
                  </div>

                  {announcement && (
                    <div className="space-y-1 text-xs text-slate-600 pt-1">
                      {announcement.eventDate && (
                        <div className="flex items-center gap-2">
                          <Calendar className="w-3.5 h-3.5 text-slate-400" />
                          <span>Event Date: {formatDate(announcement.eventDate)}</span>
                        </div>
                      )}
                      {announcement.eventLocation && (
                        <div className="flex items-center gap-2">
                          <MapPin className="w-3.5 h-3.5 text-slate-400" />
                          <span>Venue: {announcement.eventLocation}</span>
                        </div>
                      )}
                    </div>
                  )}

                  {announcement && (
                    <div className="pt-2 border-t border-slate-100 flex justify-end">
                      <button
                        type="button"
                        onClick={() => onOpenDetails(announcement)}
                        className="text-xs font-semibold text-blue-600 hover:text-blue-800 flex items-center gap-1"
                      >
                        <span>View Notice Instructions</span>
                        <ChevronRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'saved' && (
        <div className="space-y-4">
          {savedAnnouncements.length === 0 ? (
            <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center text-slate-500">
              <Bookmark className="w-8 h-8 text-slate-300 mx-auto mb-2" />
              <h4 className="font-semibold text-sm text-slate-800">No saved announcements</h4>
              <p className="text-xs text-slate-400 max-w-sm mx-auto mt-1">
                Bookmark important academic circulars, timetables, or exam schedules from your home feed to view them here anytime.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {savedAnnouncements.map((ann) => (
                <AnnouncementCard
                  key={ann.id}
                  announcement={ann}
                  isSaved={true}
                  onToggleSave={onToggleSave}
                  onOpenDetails={onOpenDetails}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'deadlines' && (
        <div className="space-y-4">
          <div className="bg-white rounded-2xl border border-slate-200 divide-y divide-slate-100 overflow-hidden">
            {deadlines.map((dl) => (
              <div
                key={dl.id}
                onClick={() => onOpenDetails(dl)}
                className="p-4 sm:p-5 hover:bg-slate-50 transition-colors cursor-pointer flex flex-col sm:flex-row sm:items-center justify-between gap-3"
              >
                <div className="flex items-start gap-3">
                  <div className="p-2.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-700 shrink-0">
                    <Clock className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2 text-xs text-slate-500 mb-1">
                      <span className="font-semibold text-amber-800 capitalize">{dl.category}</span>
                      <span>·</span>
                      <span>{dl.publishingDepartment}</span>
                    </div>
                    <h3 className="font-bold text-sm sm:text-base text-slate-900 leading-snug">
                      {dl.title}
                    </h3>
                  </div>
                </div>

                <div className="flex items-center gap-4 sm:self-center shrink-0 pl-11 sm:pl-0">
                  <div className="text-right">
                    <span className="text-[10px] text-slate-400 uppercase tracking-wider block">
                      Target Deadline
                    </span>
                    <span className="text-xs sm:text-sm font-bold text-amber-900 font-mono">
                      {formatDate(dl.registrationDeadline)}
                    </span>
                  </div>
                  <ChevronRight className="w-4 h-4 text-slate-400" />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
