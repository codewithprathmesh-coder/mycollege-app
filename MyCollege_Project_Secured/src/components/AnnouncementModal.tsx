import React, { useState } from 'react';
import {
  X,
  Bookmark,
  Calendar,
  Clock,
  MapPin,
  Paperclip,
  Share2,
  Sparkles,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  Download,
  Ticket,
  MessageSquare,
  Eye,
  FileText,
} from 'lucide-react';
import type { Announcement, EventRegistration, User } from '../types';

interface AnnouncementModalProps {
  announcement: Announcement;
  currentUser: User;
  isSaved: boolean;
  registration?: EventRegistration;
  onClose: () => void;
  onToggleSave: (id: string) => void;
  onRegister: (announcementId: string) => Promise<void>;
  onCancelRegistration?: (regId: string) => Promise<void>;
  onOpenChat?: (channelId?: string) => void;
}

export const AnnouncementModal: React.FC<AnnouncementModalProps> = ({
  announcement,
  currentUser,
  isSaved,
  registration,
  onClose,
  onToggleSave,
  onRegister,
  onCancelRegistration,
  onOpenChat,
}) => {
  const [copiedLink, setCopiedLink] = useState(false);
  const [isRegistering, setIsRegistering] = useState(false);
  const [showAiSummary, setShowAiSummary] = useState(true);

  const isUrgent = announcement.priority === 'urgent';

  const formatDate = (iso?: string) => {
    if (!iso) return 'N/A';
    try {
      const d = new Date(iso);
      return d.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return iso;
    }
  };

  const handleShare = () => {
    navigator.clipboard.writeText(window.location.href);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const handleRegisterClick = async () => {
    setIsRegistering(true);
    try {
      await onRegister(announcement.id);
    } finally {
      setIsRegistering(false);
    }
  };

  const handleDownloadAttachment = (att: { name: string; url: string }) => {
    if (!att.url || att.url === '#') {
      alert('This document does not have an attached file.');
      return;
    }
    if (att.url.startsWith('data:')) {
      try {
        const parts = att.url.split(',');
        const mime = parts[0].match(/:(.*?);/)?.[1] || 'application/pdf';
        const bstr = atob(parts[1]);
        let n = bstr.length;
        const u8arr = new Uint8Array(n);
        while (n--) {
          u8arr[n] = bstr.charCodeAt(n);
        }
        const blob = new Blob([u8arr], { type: mime });
        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = att.name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
      } catch (e) {
        console.error('Download error:', e);
        const a = document.createElement('a');
        a.href = att.url;
        a.download = att.name;
        a.click();
      }
    } else {
      const a = document.createElement('a');
      a.href = att.url;
      a.download = att.name;
      a.target = '_blank';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
  };

  const handleViewAttachment = (att: { name: string; url: string }) => {
    if (!att.url || att.url === '#') {
      alert('This document does not have an attached file.');
      return;
    }
    if (att.url.startsWith('data:')) {
      try {
        const parts = att.url.split(',');
        const mime = parts[0].match(/:(.*?);/)?.[1] || 'application/pdf';
        const bstr = atob(parts[1]);
        let n = bstr.length;
        const u8arr = new Uint8Array(n);
        while (n--) {
          u8arr[n] = bstr.charCodeAt(n);
        }
        const blob = new Blob([u8arr], { type: mime });
        const blobUrl = URL.createObjectURL(blob);
        window.open(blobUrl, '_blank');
      } catch (e) {
        window.open(att.url, '_blank');
      }
    } else {
      window.open(att.url, '_blank');
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4">
      <div className="relative bg-white w-full max-w-2xl rounded-2xl shadow-2xl border border-slate-200 overflow-hidden my-6">
        {/* Top Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/50">
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <span className="font-semibold text-slate-900 capitalize">{announcement.category}</span>
            <span aria-hidden="true">·</span>
            <span>{announcement.publishingDepartment}</span>
            {announcement.isOfficial && (
              <>
                <span aria-hidden="true">·</span>
                <span className="flex items-center gap-1 text-blue-700 font-medium">
                  <ShieldCheck className="w-3.5 h-3.5" />
                  Verified Institutional Circular
                </span>
              </>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onToggleSave(announcement.id)}
              className={`p-2 rounded-lg transition-colors ${
                isSaved ? 'text-blue-600 bg-blue-50' : 'text-slate-500 hover:bg-slate-100'
              }`}
              title={isSaved ? 'Saved' : 'Save'}
            >
              <Bookmark className={`w-4 h-4 ${isSaved ? 'fill-current' : ''}`} />
            </button>

            <button
              type="button"
              onClick={handleShare}
              className="p-2 text-slate-500 hover:bg-slate-100 rounded-lg transition-colors relative"
              title="Copy announcement link"
            >
              <Share2 className="w-4 h-4" />
              {copiedLink && (
                <span className="absolute -bottom-7 right-0 text-[10px] bg-slate-900 text-white px-2 py-0.5 rounded shadow whitespace-nowrap">
                  Link copied!
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={onClose}
              className="p-2 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Modal Scrollable Body */}
        <div className="p-6 max-h-[75vh] overflow-y-auto space-y-6">
          {/* Banner image if present */}
          {announcement.imageBanner && (
            <div className="rounded-xl overflow-hidden aspect-16/9 bg-slate-100 border border-slate-200">
              <img
                src={announcement.imageBanner}
                alt={announcement.title}
                className="w-full h-full object-cover"
                referrerPolicy="no-referrer"
              />
            </div>
          )}

          {/* Urgent Alert Banner */}
          {isUrgent && (
            <div className="flex items-start gap-3 p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <div>
                <span className="font-bold">Urgent Priority Notice: </span>
                This announcement requires immediate student or departmental attention regarding academic compliance or deadlines.
              </div>
            </div>
          )}

          {/* Title */}
          <div>
            <h2 className="text-xl sm:text-2xl font-bold text-slate-900 leading-tight">
              {announcement.title}
            </h2>
            
            {/* Uploaded By Faculty Card */}
            <div className="mt-3 flex items-center gap-2.5 p-3 rounded-2xl bg-slate-50 border border-slate-200">
              <div className="w-9 h-9 rounded-xl bg-blue-600 text-white font-bold text-sm flex items-center justify-center shrink-0 shadow-2xs">
                {(announcement.authorName || 'F')[0].toUpperCase()}
              </div>
              <div className="min-w-0 flex-1 text-xs">
                <div className="text-slate-900 font-bold">
                  Uploaded by {announcement.authorName || 'Faculty Member'}
                </div>
                <div className="text-slate-500 text-[11px] flex items-center flex-wrap gap-1.5 capitalize">
                  <span className="font-medium text-blue-700 bg-blue-50 px-1.5 py-0.2 rounded border border-blue-200">
                    {announcement.authorRole || 'Faculty'}
                  </span>
                  <span>·</span>
                  <span>{announcement.publishingDepartment}</span>
                  <span>·</span>
                  <span>{formatDate(announcement.publicationDate)}</span>
                  {announcement.targetAudience.type !== 'all' && (
                    <>
                      <span>·</span>
                      <span className="text-slate-700 font-medium">
                        Audience: {announcement.targetAudience.type} targeted
                      </span>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* AI Summary Box */}
          {announcement.aiSummary && (
            <div className="p-4 rounded-xl bg-blue-50/80 border border-blue-100">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-blue-600" />
                  <span className="text-xs font-bold text-blue-900">
                    AI Key Takeaways Summary
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setShowAiSummary(!showAiSummary)}
                  className="text-xs text-blue-700 hover:text-blue-900 font-medium"
                >
                  {showAiSummary ? 'Collapse' : 'Expand'}
                </button>
              </div>

              {showAiSummary && (
                <div className="text-xs sm:text-sm text-slate-800 leading-relaxed whitespace-pre-line space-y-1">
                  {announcement.aiSummary}
                </div>
              )}
            </div>
          )}

          {/* Full Announcement Description */}
          <div className="prose prose-sm max-w-none text-slate-700 leading-relaxed whitespace-pre-line text-sm sm:text-base">
            {announcement.description}
          </div>

          {/* Event Details Card (if event/registration) */}
          {(announcement.eventDate || announcement.registrationDeadline || announcement.eventLocation) && (
            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
              <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                Event Schedule & Participation
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs sm:text-sm text-slate-700">
                {announcement.eventDate && (
                  <div className="flex items-start gap-2.5">
                    <Calendar className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
                    <div>
                      <div className="text-slate-500 text-xs">Event Date & Time</div>
                      <div className="font-semibold">{formatDate(announcement.eventDate)}</div>
                    </div>
                  </div>
                )}

                {announcement.eventLocation && (
                  <div className="flex items-start gap-2.5">
                    <MapPin className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
                    <div>
                      <div className="text-slate-500 text-xs">Venue Location</div>
                      <div className="font-semibold">{announcement.eventLocation}</div>
                    </div>
                  </div>
                )}

                {announcement.registrationDeadline && (
                  <div className="flex items-start gap-2.5">
                    <Clock className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                    <div>
                      <div className="text-slate-500 text-xs">Registration Closes</div>
                      <div className="font-semibold text-amber-800">
                        {formatDate(announcement.registrationDeadline)}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Registration Confirmation or Call-to-Action */}
              {registration ? (
                <div className="mt-3 p-3.5 rounded-lg bg-emerald-50 border border-emerald-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
                    <div>
                      <div className="text-xs font-bold text-emerald-900">
                        Registration Confirmed
                      </div>
                      <div className="text-xs text-emerald-700 font-mono">
                        Pass ID: {registration.ticketCode}
                      </div>
                    </div>
                  </div>
                  {onCancelRegistration && (
                    <button
                      type="button"
                      onClick={() => onCancelRegistration(registration.id)}
                      className="text-xs text-rose-600 hover:text-rose-800 underline font-medium self-start sm:self-auto"
                    >
                      Cancel Registration
                    </button>
                  )}
                </div>
              ) : (
                <div className="pt-2 flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={handleRegisterClick}
                    disabled={isRegistering}
                    className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-medium text-xs sm:text-sm rounded-lg transition-colors flex items-center gap-2 shadow-sm"
                  >
                    <Ticket className="w-4 h-4" />
                    <span>{isRegistering ? 'Registering...' : 'Register for this Activity'}</span>
                  </button>

                  {announcement.registrationLink && (
                    <a
                      href={announcement.registrationLink}
                      target="_blank"
                      rel="noreferrer"
                      className="px-4 py-2.5 border border-slate-300 hover:bg-slate-100 text-slate-700 font-medium text-xs sm:text-sm rounded-lg transition-colors flex items-center gap-2"
                    >
                      <span>External Portal</span>
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Attachments & PDFs */}
          {announcement.attachments && announcement.attachments.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                Official Documents & Circulars
              </h4>
              <div className="space-y-2">
                {announcement.attachments.map((att) => (
                  <div
                    key={att.id}
                    className="flex items-center justify-between p-3 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100/70 transition-colors shadow-2xs"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-8 h-8 rounded-lg bg-rose-100 text-rose-700 font-bold flex items-center justify-center text-[10px] shrink-0 font-mono">
                        PDF
                      </div>
                      <div className="truncate">
                        <div className="text-xs sm:text-sm font-semibold text-slate-900 truncate">
                          {att.name}
                        </div>
                        <div className="text-[11px] text-slate-500 font-mono">{att.size}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0 ml-3">
                      <button
                        type="button"
                        onClick={() => handleViewAttachment(att)}
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-slate-700 hover:text-blue-700 bg-white hover:bg-blue-50 border border-slate-200 hover:border-blue-200 transition-colors cursor-pointer"
                        title="View PDF Document"
                      >
                        <Eye className="w-3.5 h-3.5 text-blue-600" />
                        <span>View</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDownloadAttachment(att)}
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 transition-colors shadow-2xs cursor-pointer"
                        title="Download PDF File"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>Download</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-3.5 border-t border-slate-100 bg-slate-50/50 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500">
          <div className="flex items-center gap-4 font-mono tabular-nums">
            <span>Views: {announcement.metrics.views}</span>
            <span>Saves: {announcement.metrics.saves}</span>
            {announcement.metrics.registrations > 0 && (
              <span>Registrations: {announcement.metrics.registrations}</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {onOpenChat && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenChat();
                }}
                className="px-3.5 py-2 bg-blue-50 hover:bg-blue-100 text-blue-700 font-semibold rounded-lg transition-colors flex items-center gap-1.5 border border-blue-200"
              >
                <MessageSquare className="w-3.5 h-3.5" />
                <span>Discuss in Circle Chat</span>
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-white border border-slate-200 hover:bg-slate-100 text-slate-700 font-medium rounded-lg transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
