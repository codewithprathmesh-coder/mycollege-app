import React, { useState } from 'react';
import {
  Bookmark,
  Calendar,
  Clock,
  Sparkles,
  Paperclip,
  CheckCircle,
  Pin,
  ExternalLink,
  ChevronRight,
  Eye,
  AlertCircle,
  ShieldCheck,
  User as UserIcon,
} from 'lucide-react';
import type { Announcement } from '../types';

interface AnnouncementCardProps {
  announcement: Announcement;
  isSaved: boolean;
  isRegistered?: boolean;
  onToggleSave: (id: string) => void;
  onOpenDetails: (announcement: Announcement) => void;
  onQuickRegister?: (announcementId: string) => void;
}

export const AnnouncementCard: React.FC<AnnouncementCardProps> = ({
  announcement,
  isSaved,
  isRegistered = false,
  onToggleSave,
  onOpenDetails,
  onQuickRegister,
}) => {
  const [showAiSummary, setShowAiSummary] = useState(false);
  const [isGeneratingAi, setIsGeneratingAi] = useState(false);
  const [customSummary, setCustomSummary] = useState(announcement.aiSummary || '');

  const isUrgent = announcement.priority === 'urgent';
  const isHigh = announcement.priority === 'high';

  const formatDate = (iso: string) => {
    try {
      const d = new Date(iso);
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    } catch {
      return iso;
    }
  };

  const handleToggleSummary = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (showAiSummary) {
      setShowAiSummary(false);
      return;
    }

    if (!customSummary && !announcement.aiSummary) {
      setIsGeneratingAi(true);
      try {
        const res = await fetch('/api/summarize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: announcement.title,
            description: announcement.description,
          }),
        });
        const data = await res.json();
        if (data.summary) {
          setCustomSummary(data.summary);
        }
      } catch (err) {
        console.error('Failed to summarize:', err);
      } finally {
        setIsGeneratingAi(false);
      }
    }
    setShowAiSummary(true);
  };

  const activeSummary = customSummary || announcement.aiSummary;

  return (
    <div
      onClick={() => onOpenDetails(announcement)}
      className={`group cursor-pointer bg-white rounded-xl border transition-all duration-200 hover:shadow-md ${
        isUrgent
          ? 'border-rose-300 hover:border-rose-400 bg-linear-to-b from-rose-50/20 to-white'
          : announcement.isPinned
          ? 'border-blue-300 hover:border-blue-400'
          : 'border-slate-200 hover:border-slate-300'
      } p-5 flex flex-col justify-between`}
    >
      <div>
        {/* Banner image if present */}
        {announcement.imageBanner && (
          <div className="mb-4 overflow-hidden rounded-lg aspect-16/9 bg-slate-100 border border-slate-100">
            <img
              src={announcement.imageBanner}
              alt={announcement.title}
              className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-102"
              referrerPolicy="no-referrer"
            />
          </div>
        )}

        {/* Header Metadata (Clean unboxed metadata with separators) */}
        <div className="flex items-center justify-between gap-2 mb-2">
          <div className="flex items-center flex-wrap gap-x-2 gap-y-1 text-xs text-slate-500">
            {announcement.isPinned && (
              <span className="flex items-center gap-1 font-semibold text-blue-700">
                <Pin className="w-3.5 h-3.5" />
                <span>Pinned</span>
                <span aria-hidden="true">·</span>
              </span>
            )}
            {isUrgent && (
              <span className="flex items-center gap-1 font-semibold text-rose-600">
                <AlertCircle className="w-3.5 h-3.5" />
                <span>Urgent</span>
                <span aria-hidden="true">·</span>
              </span>
            )}
            {announcement.isOfficial && (
              <span className="flex items-center gap-1 text-slate-700 font-medium">
                <ShieldCheck className="w-3.5 h-3.5 text-blue-600" />
                <span>Official</span>
                <span aria-hidden="true">·</span>
              </span>
            )}
            <span className="capitalize font-medium text-slate-700">{announcement.category}</span>
            <span aria-hidden="true">·</span>
            <span className="truncate max-w-[170px]">{announcement.publishingDepartment}</span>
            <span aria-hidden="true">·</span>
            <span>{formatDate(announcement.publicationDate)}</span>
          </div>

          {/* Bookmark Button */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleSave(announcement.id);
            }}
            className={`p-1.5 rounded-lg transition-colors ${
              isSaved
                ? 'text-blue-600 bg-blue-50 hover:bg-blue-100'
                : 'text-slate-400 hover:text-slate-600 hover:bg-slate-100'
            }`}
            title={isSaved ? 'Remove from saved' : 'Save announcement'}
          >
            <Bookmark className={`w-4 h-4 ${isSaved ? 'fill-current' : ''}`} />
          </button>
        </div>

        {/* Title */}
        <h3 className="text-base font-semibold text-slate-900 group-hover:text-blue-700 transition-colors leading-snug mb-1.5">
          {announcement.title}
        </h3>

        {/* Uploaded By Faculty Attribution */}
        <div className="flex items-center gap-1.5 text-xs text-slate-500 mb-2.5">
          <div className="w-5 h-5 rounded-full bg-blue-100 text-blue-700 text-[10px] font-bold flex items-center justify-center shrink-0">
            {(announcement.authorName || 'F')[0].toUpperCase()}
          </div>
          <span className="text-slate-600 font-medium">
            Uploaded by <strong className="text-slate-800 font-semibold">{announcement.authorName || 'Faculty Member'}</strong>
          </span>
          {announcement.authorRole && (
            <span className="text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.2 rounded font-medium capitalize">
              {announcement.authorRole}
            </span>
          )}
        </div>

        {/* Description Snippet */}
        <p className="text-xs sm:text-sm text-slate-600 line-clamp-2 leading-relaxed mb-3">
          {announcement.description}
        </p>

        {/* AI Summary Toggle Box */}
        {showAiSummary && activeSummary && (
          <div
            onClick={(e) => e.stopPropagation()}
            className="mb-3.5 p-3.5 rounded-lg bg-blue-50/70 border border-blue-100 text-xs text-slate-700 animate-fadeIn"
          >
            <div className="flex items-center justify-between mb-2">
              <span className="flex items-center gap-1.5 font-semibold text-blue-800 text-[11px]">
                <Sparkles className="w-3.5 h-3.5 text-blue-600" />
                AI Generated Summary
              </span>
              <button
                type="button"
                onClick={() => setShowAiSummary(false)}
                className="text-[11px] text-blue-600 hover:text-blue-800 font-medium"
              >
                Close
              </button>
            </div>
            <div className="space-y-1 font-normal leading-relaxed whitespace-pre-line text-slate-800">
              {activeSummary}
            </div>
          </div>
        )}

        {/* Key Attributes Strip: Deadline, Event Date, Attachments */}
        <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500 mb-3">
          {announcement.registrationDeadline && (
            <span className="flex items-center gap-1 text-amber-700 font-medium">
              <Clock className="w-3.5 h-3.5" />
              <span>Deadline: {formatDate(announcement.registrationDeadline)}</span>
            </span>
          )}
          {announcement.eventDate && (
            <span className="flex items-center gap-1 text-slate-600">
              <Calendar className="w-3.5 h-3.5" />
              <span>Event: {formatDate(announcement.eventDate)}</span>
            </span>
          )}
          {announcement.attachments && announcement.attachments.length > 0 && (
            <span className="flex items-center gap-1 text-slate-500">
              <Paperclip className="w-3.5 h-3.5" />
              <span>{announcement.attachments.length} attachment</span>
            </span>
          )}
        </div>
      </div>

      {/* Footer Strip */}
      <div className="pt-3 border-t border-slate-100 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          {/* AI Summary Trigger */}
          <button
            type="button"
            onClick={handleToggleSummary}
            disabled={isGeneratingAi}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium text-blue-700 hover:bg-blue-50 border border-blue-200 transition-colors"
          >
            <Sparkles className="w-3 h-3 text-blue-600" />
            <span>{isGeneratingAi ? 'Summarizing...' : showAiSummary ? 'Hide Summary' : 'AI Summary'}</span>
          </button>

          {/* Registered state tag if student */}
          {isRegistered && (
            <span className="flex items-center gap-1 text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-2 py-0.5">
              <CheckCircle className="w-3 h-3" />
              Registered
            </span>
          )}
        </div>

        <div className="flex items-center gap-3 text-xs text-slate-400">
          <span className="flex items-center gap-1 font-mono tabular-nums">
            <Eye className="w-3.5 h-3.5" />
            {announcement.metrics.views}
          </span>
          <span className="flex items-center gap-1 text-blue-600 group-hover:translate-x-0.5 transition-transform font-medium">
            <span>Read Notice</span>
            <ChevronRight className="w-3.5 h-3.5" />
          </span>
        </div>
      </div>
    </div>
  );
};
