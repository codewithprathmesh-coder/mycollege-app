import React, { useState } from 'react';
import {
  Plus,
  Eye,
  Bookmark,
  Ticket,
  Calendar,
  Clock,
  CheckCircle2,
  AlertCircle,
  Trash2,
  Edit3,
  ExternalLink,
  ShieldAlert,
  Users,
  Briefcase,
} from 'lucide-react';
import type { Announcement, Institution, User } from '../types';

interface FacultyDeskViewProps {
  currentUser: User;
  currentInstitution: Institution;
  announcements: Announcement[];
  onOpenCreate: () => void;
  onOpenDetails: (announcement: Announcement) => void;
  onEditAnnouncement: (announcement: Announcement) => void;
  onDeleteAnnouncement: (id: string) => Promise<void>;
}

export const FacultyDeskView: React.FC<FacultyDeskViewProps> = ({
  currentUser,
  currentInstitution,
  announcements,
  onOpenCreate,
  onOpenDetails,
  onEditAnnouncement,
  onDeleteAnnouncement,
}) => {
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Author filter: announcements authored by currentUser (or all department announcements if admin)
  const authoredAnnouncements = announcements.filter(
    (a) => a.authorId === currentUser.id || currentUser.role === 'admin' || currentUser.role === 'faculty'
  );

  const totalViews = authoredAnnouncements.reduce((acc, curr) => acc + curr.metrics.views, 0);
  const totalSaves = authoredAnnouncements.reduce((acc, curr) => acc + curr.metrics.saves, 0);
  const totalRegistrations = authoredAnnouncements.reduce(
    (acc, curr) => acc + curr.metrics.registrations,
    0
  );

  const handleDelete = async (id: string, title: string) => {
    if (!confirm(`Are you sure you want to delete announcement "${title}"?`)) return;
    setDeletingId(id);
    try {
      await onDeleteAnnouncement(id);
    } finally {
      setDeletingId(null);
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
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold text-blue-600 mb-1">
            {currentUser.role === 'coordinator' ? (
              <Users className="w-3.5 h-3.5 text-teal-600" />
            ) : (
              <Briefcase className="w-3.5 h-3.5 text-blue-600" />
            )}
            <span className="capitalize">{currentUser.role} Desk</span>
            <span>·</span>
            <span>{currentInstitution.name}</span>
          </div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
            Publishing & Communications Desk
          </h1>
          {currentUser.designation && (
            <p className="text-sm font-semibold text-blue-700 mt-1">
              {currentUser.name} · {currentUser.designation}
            </p>
          )}
          <p className="text-xs sm:text-sm text-slate-500">
            Publish and edit institutional announcements, schedule event registrations, and track student reach and engagement metrics.
          </p>
        </div>

        <button
          type="button"
          onClick={onOpenCreate}
          className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-medium text-xs sm:text-sm rounded-lg transition-colors flex items-center gap-2 shadow-sm self-start sm:self-auto"
        >
          <Plus className="w-4 h-4" />
          <span>Create Announcement</span>
        </button>
      </div>

      {/* Engagement KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-2xs">
          <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block mb-1">
            {currentUser.role === 'faculty' ? 'Institutional Announcements' : 'Notices Published'}
          </span>
          <div className="text-2xl font-bold text-slate-900 font-mono tabular-nums">
            {authoredAnnouncements.length}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-2xs">
          <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block mb-1">
            Total Student Views
          </span>
          <div className="text-2xl font-bold text-blue-600 font-mono tabular-nums">
            {totalViews}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-2xs">
          <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block mb-1">
            Student Bookmarks
          </span>
          <div className="text-2xl font-bold text-slate-900 font-mono tabular-nums">
            {totalSaves}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-2xs">
          <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block mb-1">
            Event Registrations
          </span>
          <div className="text-2xl font-bold text-emerald-600 font-mono tabular-nums">
            {totalRegistrations}
          </div>
        </div>
      </div>

      {/* Announcements Table */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-2xs">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <h3 className="font-bold text-sm sm:text-base text-slate-900">
            {currentUser.role === 'faculty' ? 'Institutional Announcements' : 'Authored College Communications'}
          </h3>
          <span className="text-xs text-slate-400 font-mono">
            {authoredAnnouncements.length} records
          </span>
        </div>

        {authoredAnnouncements.length === 0 ? (
          <div className="p-12 text-center text-slate-400">
            <Plus className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm font-semibold text-slate-700">
              {currentUser.role === 'faculty' ? 'No announcements available yet.' : 'No authored announcements yet.'}
            </p>
            <p className="text-xs text-slate-400 mt-1">
              Click "Create Announcement" to broadcast official timetables, exam alerts, or club circulars.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {authoredAnnouncements.map((ann) => (
              <div
                key={ann.id}
                className="p-5 hover:bg-slate-50/70 transition-colors flex flex-col md:flex-row md:items-center justify-between gap-4"
              >
                <div className="space-y-1.5 flex-1 min-w-0">
                  <div className="flex items-center flex-wrap gap-2 text-xs">
                    {ann.status === 'published' ? (
                      <span className="flex items-center gap-1 font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-2 py-0.5">
                        <CheckCircle2 className="w-3 h-3" />
                        Published
                      </span>
                    ) : ann.status === 'pending_approval' ? (
                      <span className="flex items-center gap-1 font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-0.5">
                        <Clock className="w-3 h-3" />
                        Awaiting Admin Approval
                      </span>
                    ) : (
                      <span className="font-semibold text-slate-600 bg-slate-100 rounded px-2 py-0.5">
                        Archived
                      </span>
                    )}

                    <span className="capitalize font-medium text-slate-600">{ann.category}</span>
                    <span>·</span>
                    <span className="text-slate-500">{formatDate(ann.publicationDate)}</span>
                    <span>·</span>
                    <span className="text-slate-500">Audience: {ann.targetAudience.type}</span>
                  </div>

                  <h4
                    onClick={() => onOpenDetails(ann)}
                    className="font-bold text-sm sm:text-base text-slate-900 hover:text-blue-600 cursor-pointer transition-colors leading-snug line-clamp-1"
                  >
                    {ann.title}
                  </h4>

                  <p className="text-xs text-slate-500 line-clamp-1">{ann.description}</p>
                </div>

                {/* Metrics & Actions */}
                <div className="flex items-center gap-4 shrink-0 pt-2 md:pt-0 border-t md:border-t-0 border-slate-100">
                  <div className="flex items-center gap-3 text-xs text-slate-500 font-mono tabular-nums">
                    <span title="Student Views" className="flex items-center gap-1">
                      <Eye className="w-3.5 h-3.5 text-slate-400" />
                      {ann.metrics.views}
                    </span>
                    <span title="Bookmarks" className="flex items-center gap-1">
                      <Bookmark className="w-3.5 h-3.5 text-slate-400" />
                      {ann.metrics.saves}
                    </span>
                    {ann.metrics.registrations > 0 && (
                      <span title="Registrations" className="flex items-center gap-1 text-emerald-600 font-bold">
                        <Ticket className="w-3.5 h-3.5" />
                        {ann.metrics.registrations}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    {(ann.authorId === currentUser.id || currentUser.role === 'admin' || currentUser.role === 'faculty') && (
                      <button
                        type="button"
                        onClick={() => onEditAnnouncement(ann)}
                        className="p-1.5 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                        title="Edit announcement"
                      >
                        <Edit3 className="w-4 h-4" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => onOpenDetails(ann)}
                      className="p-1.5 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                      title="Inspect full announcement"
                    >
                      <ExternalLink className="w-4 h-4" />
                    </button>
                    {(ann.authorId === currentUser.id || currentUser.role === 'admin') && (
                      <button
                        type="button"
                        onClick={() => handleDelete(ann.id, ann.title)}
                        disabled={deletingId === ann.id}
                        className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                        title="Delete announcement"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
