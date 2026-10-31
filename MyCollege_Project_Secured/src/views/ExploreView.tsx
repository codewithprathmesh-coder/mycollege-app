import React, { useState } from 'react';
import {
  Compass,
  Code2,
  Calendar,
  Briefcase,
  Trophy,
  Users,
  MapPin,
  Clock,
  Ticket,
  CheckCircle2,
  Bookmark,
  ChevronRight,
  ExternalLink,
} from 'lucide-react';
import type { Announcement, EventRegistration, User } from '../types';

interface ExploreViewProps {
  currentUser: User;
  announcements: Announcement[];
  savedIds: string[];
  registrations: EventRegistration[];
  onToggleSave: (id: string) => void;
  onOpenDetails: (announcement: Announcement) => void;
  onRegister: (announcementId: string) => Promise<void>;
  onCancelRegistration?: (regId: string) => Promise<void>;
}

type OpportunityFilter = 'all' | 'hackathons' | 'fests' | 'internships' | 'sports' | 'clubs';

export const ExploreView: React.FC<ExploreViewProps> = ({
  currentUser,
  announcements,
  savedIds,
  registrations,
  onToggleSave,
  onOpenDetails,
  onRegister,
  onCancelRegistration,
}) => {
  const [filter, setFilter] = useState<OpportunityFilter>('all');
  const [registeringId, setRegisteringId] = useState<string | null>(null);

  // Filter opportunities (hackathons, fests, internships, sports, clubs, events)
  const opportunities = announcements.filter((a) => {
    const isOpportunityCategory = [
      'hackathons',
      'fests',
      'internships',
      'sports',
      'clubs',
      'events',
    ].includes(a.category);

    if (!isOpportunityCategory) return false;
    if (filter === 'all') return true;
    return a.category === filter;
  });

  const registeredMap = new Map(registrations.map((r) => [r.announcementId, r]));

  const handleRegisterClick = async (annId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setRegisteringId(annId);
    try {
      await onRegister(annId);
    } finally {
      setRegisteringId(null);
    }
  };

  const formatDate = (iso?: string) => {
    if (!iso) return '';
    try {
      const d = new Date(iso);
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    } catch {
      return iso;
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
      {/* Header Banner */}
      <div className="relative rounded-2xl overflow-hidden bg-slate-900 text-white p-6 sm:p-8">
        <div className="absolute inset-0 opacity-20">
          <img
            src="/src/assets/images/campus_hero_view_1791889460035.jpg"
            alt="Campus"
            className="w-full h-full object-cover"
            referrerPolicy="no-referrer"
          />
        </div>
        <div className="relative z-10 max-w-2xl space-y-2">
          <div className="flex items-center gap-2 text-blue-400 text-xs font-bold uppercase tracking-wider">
            <Compass className="w-4 h-4" />
            <span>Campus Opportunities & Competitions</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
            Discover Hackathons, Fests & Internships
          </h1>
          <p className="text-slate-300 text-xs sm:text-sm leading-relaxed">
            Register directly for sanctioned collegiate festivals, technical hackathons, athletic trials, and placement drives. All registrations generate verified student admission passes.
          </p>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-1">
        {[
          { id: 'all', label: 'All Opportunities', icon: Compass },
          { id: 'hackathons', label: 'Hackathons', icon: Code2 },
          { id: 'internships', label: 'Internships & Drives', icon: Briefcase },
          { id: 'fests', label: 'Cultural & Fests', icon: Calendar },
          { id: 'sports', label: 'Sports Trials', icon: Trophy },
          { id: 'clubs', label: 'Clubs & Workshops', icon: Users },
        ].map((tab) => {
          const Icon = tab.icon;
          const active = filter === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setFilter(tab.id as OpportunityFilter)}
              className={`flex items-center gap-2 px-3.5 py-2 text-xs font-semibold rounded-lg border transition-colors whitespace-nowrap shrink-0 ${
                active
                  ? 'bg-blue-600 text-white border-blue-600 shadow-2xs'
                  : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Grid of Opportunities */}
      {opportunities.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center text-slate-500">
          <Compass className="w-8 h-8 text-slate-300 mx-auto mb-2" />
          <p className="text-sm font-semibold">No opportunities currently listed under this category.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {opportunities.map((opp) => {
            const isSaved = savedIds.includes(opp.id);
            const registration = registeredMap.get(opp.id);
            const isRegistered = !!registration;

            return (
              <div
                key={opp.id}
                onClick={() => onOpenDetails(opp)}
                className="group cursor-pointer bg-white rounded-xl border border-slate-200 hover:border-slate-300 p-5 shadow-2xs hover:shadow-md transition-all flex flex-col justify-between"
              >
                <div>
                  {/* Card Image Banner */}
                  {opp.imageBanner && (
                    <div className="mb-4 overflow-hidden rounded-lg aspect-16/9 bg-slate-100">
                      <img
                        src={opp.imageBanner}
                        alt={opp.title}
                        className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-102"
                        referrerPolicy="no-referrer"
                      />
                    </div>
                  )}

                  {/* Header strip */}
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <span className="text-xs font-semibold capitalize text-blue-700 bg-blue-50 border border-blue-100 rounded px-2 py-0.5">
                      {opp.category}
                    </span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleSave(opp.id);
                      }}
                      className={`p-1.5 rounded-lg transition-colors ${
                        isSaved ? 'text-blue-600 bg-blue-50' : 'text-slate-400 hover:text-slate-600 hover:bg-slate-100'
                      }`}
                    >
                      <Bookmark className={`w-4 h-4 ${isSaved ? 'fill-current' : ''}`} />
                    </button>
                  </div>

                  {/* Title */}
                  <h3 className="text-base font-bold text-slate-900 group-hover:text-blue-700 transition-colors line-clamp-2 mb-2">
                    {opp.title}
                  </h3>

                  {/* Snippet */}
                  <p className="text-xs text-slate-600 line-clamp-2 leading-relaxed mb-4">
                    {opp.description}
                  </p>

                  {/* Event & Deadline details */}
                  <div className="space-y-1.5 text-xs text-slate-500 mb-4">
                    {opp.eventDate && (
                      <div className="flex items-center gap-2">
                        <Calendar className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        <span>Event Date: {formatDate(opp.eventDate)}</span>
                      </div>
                    )}
                    {opp.eventLocation && (
                      <div className="flex items-center gap-2">
                        <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        <span className="truncate">{opp.eventLocation}</span>
                      </div>
                    )}
                    {opp.registrationDeadline && (
                      <div className="flex items-center gap-2 text-amber-700 font-medium">
                        <Clock className="w-3.5 h-3.5 shrink-0" />
                        <span>Deadline: {formatDate(opp.registrationDeadline)}</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Footer action */}
                <div className="pt-3 border-t border-slate-100 flex items-center justify-between gap-2">
                  {isRegistered ? (
                    <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-2.5 py-1.5">
                      <CheckCircle2 className="w-4 h-4" />
                      <span>Pass: {registration.ticketCode}</span>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={(e) => handleRegisterClick(opp.id, e)}
                      disabled={registeringId === opp.id}
                      className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs rounded-lg transition-colors flex items-center gap-1.5 shadow-2xs"
                    >
                      <Ticket className="w-3.5 h-3.5" />
                      <span>{registeringId === opp.id ? 'Registering...' : 'Register Now'}</span>
                    </button>
                  )}

                  <span className="text-xs text-slate-400 flex items-center gap-1 group-hover:text-blue-600 transition-colors">
                    <span>Details</span>
                    <ChevronRight className="w-3.5 h-3.5" />
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
