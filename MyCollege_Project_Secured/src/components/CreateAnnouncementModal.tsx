import React, { useState } from 'react';
import {
  X,
  Sparkles,
  Paperclip,
  Calendar,
  Clock,
  MapPin,
  AlertCircle,
  Eye,
  CheckCircle2,
  Send,
  Plus,
  Trash2,
} from 'lucide-react';
import type {
  Announcement,
  AnnouncementCategory,
  Department,
  Institution,
  PriorityLevel,
  User,
} from '../types';
import { api } from '../services/api';

interface CreateAnnouncementModalProps {
  currentUser: User;
  currentInstitution: Institution;
  departments: Department[];
  initialAnnouncement?: Announcement;
  onClose: () => void;
  onCreated: (announcement: Announcement) => void;
}

export const CreateAnnouncementModal: React.FC<CreateAnnouncementModalProps> = ({
  currentUser,
  currentInstitution,
  departments,
  initialAnnouncement,
  onClose,
  onCreated,
}) => {
  const [tab, setTab] = useState<'edit' | 'preview'>('edit');
  const [title, setTitle] = useState(initialAnnouncement?.title || '');
  const [description, setDescription] = useState(initialAnnouncement?.description || '');
  const [category, setCategory] = useState<AnnouncementCategory>(initialAnnouncement?.category || 'academics');
  const [priority, setPriority] = useState<PriorityLevel>(initialAnnouncement?.priority || 'normal');
  const [publishingDepartment, setPublishingDepartment] = useState(
    initialAnnouncement?.publishingDepartment || currentUser.departmentName || 'Computer Engineering Department'
  );

  // Audience
  const [audienceType, setAudienceType] = useState<'all' | 'department' | 'year'>(
    initialAnnouncement?.targetAudience.type === 'department' || initialAnnouncement?.targetAudience.type === 'year'
      ? initialAnnouncement.targetAudience.type
      : 'all'
  );
  const [selectedDepts, setSelectedDepts] = useState<string[]>(
    initialAnnouncement?.targetAudience.departmentIds || [currentUser.departmentId]
  );
  const [selectedYears, setSelectedYears] = useState<string[]>(
    initialAnnouncement?.targetAudience.years || ['3rd Year']
  );

  // Event & deadlines
  const toLocalDateTime = (value?: string) => value ? new Date(value).toISOString().slice(0, 16) : '';
  const [isEvent, setIsEvent] = useState(Boolean(initialAnnouncement?.eventDate || initialAnnouncement?.eventLocation));
  const [eventDate, setEventDate] = useState(toLocalDateTime(initialAnnouncement?.eventDate));
  const [eventLocation, setEventLocation] = useState(initialAnnouncement?.eventLocation || '');
  const [registrationDeadline, setRegistrationDeadline] = useState(toLocalDateTime(initialAnnouncement?.registrationDeadline));
  const [registrationLink, setRegistrationLink] = useState(initialAnnouncement?.registrationLink || '');

  // AI Summary
  const [aiSummary, setAiSummary] = useState(initialAnnouncement?.aiSummary || '');
  const [isSummarizing, setIsSummarizing] = useState(false);

  // Attachments
  const [attachments, setAttachments] = useState(initialAnnouncement?.attachments || []);
  const [newAttachmentName, setNewAttachmentName] = useState('');

  // Form states
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const willRequireApproval = currentInstitution.requireApproval && currentUser.role !== 'admin';

  const handleGenerateSummary = async () => {
    if (!title.trim() || !description.trim()) {
      setError('Please provide title and description before generating an AI summary.');
      return;
    }
    setError(null);
    setIsSummarizing(true);
    try {
      const res = await api.summarizeAnnouncement(title, description);
      setAiSummary(res.summary);
    } catch (err: any) {
      setError('Failed to generate summary: ' + (err.message || 'Server error'));
    } finally {
      setIsSummarizing(false);
    }
  };

  const handleAddAttachment = () => {
    if (!newAttachmentName.trim()) return;
    setAttachments([
      ...attachments,
      {
        id: `att-${Date.now()}`,
        name: newAttachmentName.endsWith('.pdf') ? newAttachmentName : `${newAttachmentName}.pdf`,
        size: '1.2 MB',
        type: 'application/pdf',
        url: '#',
      },
    ]);
    setNewAttachmentName('');
  };

  const handleRemoveAttachment = (id: string) => {
    setAttachments(attachments.filter((a) => a.id !== id));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setError('Announcement title is required.');
      return;
    }
    if (!description.trim()) {
      setError('Announcement description content is required.');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const targetAudience = {
        type: audienceType,
        departmentIds: audienceType === 'department' ? selectedDepts : undefined,
        years: audienceType === 'year' ? selectedYears : undefined,
      };

      const payload = {
        title,
        description,
        category,
        publishingDepartment,
        priority,
        targetAudience,
        eventDate: isEvent && eventDate ? new Date(eventDate).toISOString() : undefined,
        eventLocation: isEvent ? eventLocation : undefined,
        registrationDeadline: registrationDeadline ? new Date(registrationDeadline).toISOString() : undefined,
        registrationLink: registrationLink || undefined,
        aiSummary: aiSummary || undefined,
        attachments,
      };
      const res = initialAnnouncement
        ? await api.updateAnnouncement(initialAnnouncement.id, payload)
        : await api.createAnnouncement(payload);

      onCreated(res.announcement);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to submit announcement.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4">
      <div className="relative bg-white w-full max-w-2xl rounded-2xl shadow-2xl border border-slate-200 overflow-hidden my-6">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/50">
          <div>
            <h3 className="font-bold text-base sm:text-lg text-slate-900">
              {initialAnnouncement ? 'Edit College Announcement' : 'Create College Announcement'}
            </h3>
            <p className="text-xs text-slate-500">
              {initialAnnouncement ? 'Editing' : 'Author:'} {currentUser.name} ({currentUser.role.toUpperCase()}) · {currentInstitution.shortName}
            </p>
          </div>

          <div className="flex items-center gap-2">
            {/* Edit / Preview toggle */}
            <div className="flex bg-slate-200/80 p-0.5 rounded-lg text-xs font-medium">
              <button
                type="button"
                onClick={() => setTab('edit')}
                className={`px-3 py-1 rounded-md transition-colors ${
                  tab === 'edit' ? 'bg-white text-slate-900 shadow-2xs font-semibold' : 'text-slate-600'
                }`}
              >
                Editor
              </button>
              <button
                type="button"
                onClick={() => setTab('preview')}
                className={`px-3 py-1 rounded-md transition-colors flex items-center gap-1 ${
                  tab === 'preview' ? 'bg-white text-slate-900 shadow-2xs font-semibold' : 'text-slate-600'
                }`}
              >
                <Eye className="w-3.5 h-3.5" />
                <span>Preview</span>
              </button>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Approval Notice */}
        {willRequireApproval && (
          <div className="px-6 py-2.5 bg-amber-50 border-b border-amber-200 flex items-center gap-2 text-xs text-amber-800">
            <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
            <span>
              <strong>Institutional Policy:</strong> This announcement will be submitted to Dean/Admin for approval before public publication.
            </span>
          </div>
        )}

        {/* Body */}
        {tab === 'edit' ? (
          <form onSubmit={handleSubmit} className="p-6 max-h-[75vh] overflow-y-auto space-y-4 text-xs sm:text-sm">
            {error && (
              <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {/* Title */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Announcement Title <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. End-Semester Examination Schedule & Hall Ticket Distribution"
                className="w-full px-3.5 py-2.5 rounded-lg border border-slate-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none text-slate-900 font-medium text-xs sm:text-sm"
              />
            </div>

            {/* Category & Priority Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Category <span className="text-rose-500">*</span>
                </label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value as AnnouncementCategory)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white text-slate-900 text-xs sm:text-sm outline-none"
                >
                  <option value="academics">Academics</option>
                  <option value="examinations">Examinations</option>
                  <option value="timetables">Timetables</option>
                  <option value="hackathons">Hackathons</option>
                  <option value="internships">Internships</option>
                  <option value="fests">Fests & Cultural</option>
                  <option value="sports">Sports</option>
                  <option value="clubs">Clubs & Councils</option>
                  <option value="assignments">Assignments</option>
                  <option value="general">General Notice</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Priority Level
                </label>
                <select
                  value={priority}
                  onChange={(e) => setPriority(e.target.value as PriorityLevel)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white text-slate-900 text-xs sm:text-sm outline-none"
                >
                  <option value="normal">Normal Priority</option>
                  <option value="high">High Priority</option>
                  <option value="urgent">Urgent Notice (Emergency / Timetable)</option>
                  <option value="low">Low Priority</option>
                </select>
              </div>
            </div>

            {/* Publishing Department */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Publishing Entity / Department
              </label>
              <input
                type="text"
                value={publishingDepartment}
                onChange={(e) => setPublishingDepartment(e.target.value)}
                placeholder="e.g. Department of Computer Engineering"
                className="w-full px-3 py-2 rounded-lg border border-slate-200 text-xs sm:text-sm text-slate-900"
              />
            </div>

            {/* Target Audience */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Target Audience
              </label>
              <div className="flex gap-2 mb-2">
                {(['all', 'department', 'year'] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setAudienceType(t)}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium capitalize border transition-colors ${
                      audienceType === t
                        ? 'bg-blue-50 text-blue-700 border-blue-300 font-semibold'
                        : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    {t === 'all' ? 'All College' : t === 'department' ? 'Specific Dept' : 'Specific Year'}
                  </button>
                ))}
              </div>

              {audienceType === 'department' && (
                <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 flex flex-wrap gap-2 text-xs">
                  {departments.map((d) => (
                    <label key={d.id} className="flex items-center gap-1.5 text-slate-700">
                      <input
                        type="checkbox"
                        checked={selectedDepts.includes(d.id)}
                        onChange={(e) => {
                          if (e.target.checked) setSelectedDepts([...selectedDepts, d.id]);
                          else setSelectedDepts(selectedDepts.filter((id) => id !== d.id));
                        }}
                        className="rounded text-blue-600"
                      />
                      <span>{d.name}</span>
                    </label>
                  ))}
                </div>
              )}

              {audienceType === 'year' && (
                <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 flex flex-wrap gap-3 text-xs">
                  {['1st Year', '2nd Year', '3rd Year', 'Final Year'].map((yr) => (
                    <label key={yr} className="flex items-center gap-1.5 text-slate-700">
                      <input
                        type="checkbox"
                        checked={selectedYears.includes(yr)}
                        onChange={(e) => {
                          if (e.target.checked) setSelectedYears([...selectedYears, yr]);
                          else setSelectedYears(selectedYears.filter((y) => y !== yr));
                        }}
                        className="rounded text-blue-600"
                      />
                      <span>{yr}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>

            {/* Description Textarea */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-semibold text-slate-700">
                  Full Announcement Description <span className="text-rose-500">*</span>
                </label>
                <button
                  type="button"
                  onClick={handleGenerateSummary}
                  disabled={isSummarizing}
                  className="flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-800 font-medium"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>{isSummarizing ? 'Summarizing...' : 'Generate AI Summary with Gemini'}</span>
                </button>
              </div>
              <textarea
                required
                rows={5}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Enter detailed notice content, instructions, syllabus scope, venue details, or guidelines..."
                className="w-full p-3 rounded-lg border border-slate-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none text-slate-900 text-xs sm:text-sm leading-relaxed"
              />
            </div>

            {/* AI Summary Editor */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Executive AI Summary (Optional - can be auto-generated or edited)
              </label>
              <textarea
                rows={3}
                value={aiSummary}
                onChange={(e) => setAiSummary(e.target.value)}
                placeholder="• What: ...&#10;• Who: ...&#10;• Deadlines: ..."
                className="w-full p-2.5 rounded-lg border border-slate-200 text-xs text-slate-800 font-mono leading-relaxed bg-slate-50/50"
              />
            </div>

            {/* Event & Registration checkbox */}
            <div className="pt-2 border-t border-slate-100">
              <label className="flex items-center gap-2 cursor-pointer font-medium text-slate-900 text-xs sm:text-sm">
                <input
                  type="checkbox"
                  checked={isEvent}
                  onChange={(e) => setIsEvent(e.target.checked)}
                  className="rounded text-blue-600"
                />
                <span>This announcement includes an Event or Scheduled Activity</span>
              </label>

              {isEvent && (
                <div className="mt-3 p-3.5 bg-slate-50 rounded-xl border border-slate-200 space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-slate-600 mb-1">Event Date & Time</label>
                      <input
                        type="datetime-local"
                        value={eventDate}
                        onChange={(e) => setEventDate(e.target.value)}
                        className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-xs"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-slate-600 mb-1">Venue / Location</label>
                      <input
                        type="text"
                        value={eventLocation}
                        onChange={(e) => setEventLocation(e.target.value)}
                        placeholder="e.g. Auditorium / Lab 304"
                        className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-xs"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-slate-600 mb-1">Registration Deadline</label>
                      <input
                        type="datetime-local"
                        value={registrationDeadline}
                        onChange={(e) => setRegistrationDeadline(e.target.value)}
                        className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-xs"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-slate-600 mb-1">External Registration URL (Optional)</label>
                      <input
                        type="url"
                        value={registrationLink}
                        onChange={(e) => setRegistrationLink(e.target.value)}
                        placeholder="https://..."
                        className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-xs"
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Attachments Section */}
            <div className="pt-2 border-t border-slate-100">
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Official Attachments & Circulars
              </label>
              <div className="flex gap-2 mb-2">
                <input
                  type="text"
                  value={newAttachmentName}
                  onChange={(e) => setNewAttachmentName(e.target.value)}
                  placeholder="e.g. Revised_Timetable_V5.pdf"
                  className="flex-1 px-3 py-1.5 rounded-lg border border-slate-200 text-xs"
                />
                <button
                  type="button"
                  onClick={handleAddAttachment}
                  className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-medium flex items-center gap-1"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add PDF</span>
                </button>
              </div>

              {attachments.map((a) => (
                <div
                  key={a.id}
                  className="flex items-center justify-between p-2 rounded-lg bg-slate-50 border border-slate-200 text-xs mb-1.5"
                >
                  <span className="flex items-center gap-2 text-slate-800">
                    <Paperclip className="w-3.5 h-3.5 text-blue-600" />
                    {a.name}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleRemoveAttachment(a.id)}
                    className="text-rose-500 hover:text-rose-700 p-1"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>

            {/* Form actions */}
            <div className="pt-4 border-t border-slate-100 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-lg"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-medium text-xs sm:text-sm rounded-lg transition-colors flex items-center gap-2 shadow-sm"
              >
                <Send className="w-4 h-4" />
                <span>
                  {isSubmitting
                    ? initialAnnouncement ? 'Saving...' : 'Publishing...'
                    : willRequireApproval
                    ? initialAnnouncement ? 'Save Changes' : 'Submit for Approval'
                    : initialAnnouncement ? 'Save Changes' : 'Publish Announcement'}
                </span>
              </button>
            </div>
          </form>
        ) : (
          /* Live Preview Tab */
          <div className="p-6 max-h-[75vh] overflow-y-auto space-y-4">
            <div className="p-4 rounded-xl border border-slate-200 bg-white space-y-3">
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <span className="font-semibold text-slate-800 capitalize">{category}</span>
                <span aria-hidden="true">·</span>
                <span>{publishingDepartment}</span>
                <span aria-hidden="true">·</span>
                <span>Just Now</span>
                {priority === 'urgent' && (
                  <span className="text-rose-600 font-bold ml-auto">Urgent</span>
                )}
              </div>

              <h2 className="text-lg font-bold text-slate-900">{title || 'Untitled Announcement'}</h2>

              {aiSummary && (
                <div className="p-3 rounded-lg bg-blue-50 border border-blue-100 text-xs text-slate-800 font-mono whitespace-pre-line">
                  {aiSummary}
                </div>
              )}

              <p className="text-xs sm:text-sm text-slate-700 whitespace-pre-line leading-relaxed">
                {description || 'No description provided.'}
              </p>

              {isEvent && (
                <div className="p-3 bg-slate-50 rounded-lg text-xs space-y-1 text-slate-600">
                  <div>Event Date: {eventDate || 'TBD'}</div>
                  <div>Venue: {eventLocation || 'TBD'}</div>
                  {registrationDeadline && <div>Deadline: {registrationDeadline}</div>}
                </div>
              )}
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setTab('edit')}
                className="px-4 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg"
              >
                Back to Edit
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={isSubmitting}
                className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-medium text-xs rounded-lg"
              >
                {willRequireApproval ? 'Confirm & Submit' : 'Confirm & Publish'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
