import React from 'react';
import {
  BookOpen,
  Calendar,
  Briefcase,
  Code2,
  Trophy,
  Users,
  FileText,
  Clock,
  Sparkles,
  AlertCircle,
  Filter,
  CheckCircle,
  ChevronRight,
  ShieldCheck,
  Compass,
  MessageSquare,
  Megaphone,
  GraduationCap,
  LayoutDashboard,
  MapPin,
  ArrowRight,
  TrendingUp,
  Layers,
} from 'lucide-react';
import type { Announcement, AnnouncementCategory, EventRegistration, Institution, User } from '../types';
import { AnnouncementCard } from '../components/AnnouncementCard';

interface HomeViewProps {
  currentUser: User;
  currentInstitution: Institution;
  announcements: Announcement[];
  savedIds: string[];
  registrations: EventRegistration[];
  groups?: Array<{ id: string; name?: string }>;
  selectedCategory: string;
  selectedSort: string;
  onSelectCategory: (cat: string) => void;
  onSelectSort: (sort: string) => void;
  onToggleSave: (id: string) => void;
  onOpenDetails: (announcement: Announcement) => void;
  onOpenExplore: () => void;
  onOpenChat?: () => void;
  onOpenBatchDirectory?: () => void;
  onOpenDesk?: () => void;
  onQuickRegister: (announcementId: string) => void;
  onOpenPreferences?: () => void;
  searchQuery: string;
}

const CATEGORIES: { id: AnnouncementCategory | 'all'; label: string; icon: any }[] = [
  { id: 'all', label: 'All Notices', icon: FileText },
  { id: 'academics', label: 'Academics', icon: BookOpen },
  { id: 'examinations', label: 'Examinations', icon: AlertCircle },
  { id: 'hackathons', label: 'Hackathons', icon: Code2 },
  { id: 'internships', label: 'Internships', icon: Briefcase },
  { id: 'events', label: 'Events & Fests', icon: Calendar },
  { id: 'sports', label: 'Sports', icon: Trophy },
  { id: 'clubs', label: 'Clubs & Councils', icon: Users },
];

export const HomeView: React.FC<HomeViewProps> = ({
  currentUser,
  currentInstitution,
  announcements,
  savedIds,
  registrations,
  groups,
  selectedCategory,
  selectedSort,
  onSelectCategory,
  onSelectSort,
  onToggleSave,
  onOpenDetails,
  onOpenExplore,
  onOpenChat,
  onOpenBatchDirectory,
  onOpenDesk,
  onQuickRegister,
  onOpenPreferences,
  searchQuery,
}) => {
  const registeredAnnouncementIds = registrations.map((r) => r.announcementId);

  // Dynamic greeting based on current hour
  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good Morning';
    if (hour < 17) return 'Good Afternoon';
    return 'Good Evening';
  };

  const firstName = currentUser.name.split(' ')[0] || 'Prathmesh';
  const isFaculty = currentUser.role === 'faculty';

  // Urgent notices
  const urgentAnnouncements = announcements.filter((a) => a.priority === 'urgent');

  // Upcoming deadlines within next 14 days
  const upcomingDeadlines = announcements
    .filter((a) => a.registrationDeadline)
    .sort((a, b) => new Date(a.registrationDeadline!).getTime() - new Date(b.registrationDeadline!).getTime())
    .slice(0, 3);

  // Upcoming campus events
  const upcomingEvents = announcements
    .filter((a) => a.category === 'events' || a.category === 'hackathons' || a.category === 'sports')
    .slice(0, 3);

  // Preference matching: get user's top 3 ordered preferences
  const orderedPrefs = currentUser.orderedPreferences || ['Technical Events', 'Sports', 'Academics'];

  // Student ranking uses personal interests; faculty ranking stays institutional.
  const sortedAnnouncements = React.useMemo(() => {
    let list = [...announcements];

    if (selectedCategory !== 'all') {
      list = list.filter((a) => a.category === selectedCategory);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (a) =>
          a.title.toLowerCase().includes(q) ||
          a.description.toLowerCase().includes(q) ||
          a.publishingDepartment.toLowerCase().includes(q) ||
          a.category.toLowerCase().includes(q)
      );
    }

    if (selectedSort === 'latest') {
      list.sort((a, b) => new Date(b.publicationDate).getTime() - new Date(a.publicationDate).getTime());
    } else if (selectedSort === 'deadlines') {
      list.sort((a, b) => {
        const dA = a.registrationDeadline ? new Date(a.registrationDeadline).getTime() : Infinity;
        const dB = b.registrationDeadline ? new Date(b.registrationDeadline).getTime() : Infinity;
        return dA - dB;
      });
    } else {
      // Smart ranking:
      // 1. Urgent notices always on top (+60)
      // 2. 1st preference match (+40)
      // 3. 2nd preference match (+25)
      // 4. 3rd preference match (+15)
      // 5. Department match (+20)
      // 6. Recency
      list.sort((a, b) => {
        let scoreA = 0;
        let scoreB = 0;

        if (a.priority === 'urgent') scoreA += 60;
        if (b.priority === 'urgent') scoreB += 60;

        const checkPrefScore = (item: Announcement) => {
          let s = 0;
          const cat = item.category.toLowerCase();
          const title = item.title.toLowerCase();

          if (!isFaculty) {
            const pref1 = (orderedPrefs[0] || '').toLowerCase();
            if (cat.includes(pref1) || title.includes(pref1)) s += 40;

            const pref2 = (orderedPrefs[1] || '').toLowerCase();
            if (cat.includes(pref2) || title.includes(pref2)) s += 25;

            const pref3 = (orderedPrefs[2] || '').toLowerCase();
            if (cat.includes(pref3) || title.includes(pref3)) s += 15;
          }

          if (
            item.targetAudience.type === 'all' ||
            (item.targetAudience.departmentIds && item.targetAudience.departmentIds.includes(currentUser.departmentId))
          ) {
            s += 20;
          }

          return s;
        };

        scoreA += checkPrefScore(a);
        scoreB += checkPrefScore(b);

        if (scoreA !== scoreB) return scoreB - scoreA;
        return new Date(b.publicationDate).getTime() - new Date(a.publicationDate).getTime();
      });
    }

    return list;
  }, [announcements, selectedCategory, selectedSort, searchQuery, orderedPrefs, currentUser.departmentId, isFaculty]);

  const formatDate = (iso?: string) => {
    if (!iso) return '';
    try {
      const d = new Date(iso);
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    } catch {
      return iso;
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
      {/* SECTION A: WELCOME SECTION */}
      <div className="bg-gradient-to-r from-blue-700 via-indigo-700 to-blue-900 rounded-3xl p-6 sm:p-8 text-white shadow-xl relative overflow-hidden">
        <div className="absolute right-0 top-0 w-96 h-96 bg-white/5 rounded-full blur-3xl pointer-events-none" />
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs font-semibold text-blue-200">
              <span className="bg-white/10 px-2 py-0.5 rounded-md backdrop-blur-xs">
                {currentInstitution.name}
              </span>
              <span>·</span>
              <span>{currentUser.departmentName || 'Artificial Intelligence'}</span>
            </div>
            
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
              {getGreeting()}, {firstName}!
            </h1>
            
            <p className="text-sm text-blue-100 font-medium">
              {isFaculty ? 'Manage announcements, student batches, and campus groups.' : 'Stay connected. Stay updated.'}
            </p>

            {!isFaculty && <div className="pt-2 flex flex-wrap items-center gap-2 text-xs text-blue-200">
              <span className="bg-white/15 px-2.5 py-1 rounded-lg backdrop-blur-xs">
                Year: <strong>{currentUser.year || 'Second Year'}</strong>
              </span>
              <span className="bg-white/15 px-2.5 py-1 rounded-lg backdrop-blur-xs">
                Class: <strong>{currentUser.division || 'Class 2A'}</strong>
              </span>
              <span className="bg-white/15 px-2.5 py-1 rounded-lg backdrop-blur-xs font-mono">
                Roll No: <strong>{currentUser.rollNo || 'AIDS-25-01'}</strong>
              </span>
            </div>}
          </div>

          {/* Smart Preferences Quick Action */}
          {!isFaculty && <div className="bg-white/10 backdrop-blur-md border border-white/20 p-4 rounded-2xl flex flex-col sm:flex-row md:flex-col gap-3 min-w-[260px]">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-amber-300 flex items-center gap-1.5 uppercase tracking-wider">
                <Sparkles className="w-3.5 h-3.5 text-amber-300" />
                <span>Your Priorities</span>
              </span>
              {onOpenPreferences && (
                <button
                  type="button"
                  onClick={onOpenPreferences}
                  className="text-[11px] text-white/90 hover:text-white underline font-semibold cursor-pointer"
                >
                  Edit
                </button>
              )}
            </div>

            <div className="space-y-1.5 text-xs">
              {orderedPrefs.map((pref, i) => (
                <div key={pref} className="flex items-center gap-2 text-blue-50">
                  <span className="w-4 h-4 rounded-full bg-white/20 text-[10px] font-mono font-bold flex items-center justify-center shrink-0">
                    {i + 1}
                  </span>
                  <span className="font-semibold truncate">{pref}</span>
                </div>
              ))}
            </div>

          </div>}
        </div>
      </div>

      {/* SECTION B: 4 QUICK-ACCESS CARDS (Chats, Groups, Events, Notices) */}
      {isFaculty ? (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
          <button type="button" onClick={onOpenDesk} className="p-5 rounded-2xl border border-slate-200 bg-white hover:border-blue-500 hover:shadow-md transition-all text-left group">
            <LayoutDashboard className="w-5 h-5 text-blue-600 mb-3" />
            <h3 className="font-bold text-sm text-slate-900 group-hover:text-blue-600">Publishing Desk</h3>
            <p className="text-xs text-slate-500 mt-1">Create and manage college announcements.</p>
          </button>
          <button type="button" onClick={onOpenChat} className="p-5 rounded-2xl border border-slate-200 bg-white hover:border-indigo-500 hover:shadow-md transition-all text-left group">
            <Users className="w-5 h-5 text-indigo-600 mb-3" />
            <h3 className="font-bold text-sm text-slate-900 group-hover:text-indigo-600">Groups</h3>
            <p className="text-xs text-slate-500 mt-1">Create and manage campus groups.</p>
          </button>
          <button type="button" onClick={onOpenBatchDirectory} className="p-5 rounded-2xl border border-slate-200 bg-white hover:border-emerald-500 hover:shadow-md transition-all text-left group">
            <GraduationCap className="w-5 h-5 text-emerald-600 mb-3" />
            <h3 className="font-bold text-sm text-slate-900 group-hover:text-emerald-600">Batch Management</h3>
            <p className="text-xs text-slate-500 mt-1">Review batch totals and add students.</p>
          </button>
        </div>
      ) : <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {/* 1. Chats Card */}
        <button
          type="button"
          onClick={onOpenChat}
          className="p-5 rounded-2xl border border-slate-200 bg-white hover:border-blue-500 hover:shadow-md transition-all text-left flex flex-col justify-between group cursor-pointer"
        >
          <div className="flex items-center justify-between mb-3">
            <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center group-hover:bg-blue-600 group-hover:text-white transition-colors">
              <MessageSquare className="w-5 h-5" />
            </div>
            <span className="text-[11px] font-bold font-mono px-2 py-0.5 rounded-full bg-blue-100 text-blue-800">
              Active
            </span>
          </div>
          <div>
            <h3 className="font-bold text-sm sm:text-base text-slate-900 group-hover:text-blue-600 transition-colors">
              Chats
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Class 2A & peer messaging
            </p>
          </div>
        </button>

{/* 2. Groups Card */}
        <button
          type="button"
          onClick={onOpenChat}
          className="p-5 rounded-2xl border border-slate-200 bg-white hover:border-indigo-500 hover:shadow-md transition-all text-left flex flex-col justify-between group cursor-pointer"
        >
          <div className="flex items-center justify-between mb-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center group-hover:bg-indigo-600 group-hover:text-white transition-colors">
              <Users className="w-5 h-5" />
            </div>
            <span className="text-[11px] font-bold font-mono px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-800">
              {groups?.length || 0} Groups
            </span>
          </div>
          <div>
            <h3 className="font-bold text-sm sm:text-base text-slate-900 group-hover:text-indigo-600 transition-colors">
              Groups
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Clubs, committees & fests
            </p>
          </div>
        </button>
        {/* 3. Events Card */}
        <button
          type="button"
          onClick={onOpenExplore}
          className="p-5 rounded-2xl border border-slate-200 bg-white hover:border-emerald-500 hover:shadow-md transition-all text-left flex flex-col justify-between group cursor-pointer"
        >
          <div className="flex items-center justify-between mb-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center group-hover:bg-emerald-600 group-hover:text-white transition-colors">
              <Calendar className="w-5 h-5" />
            </div>
            <span className="text-[11px] font-bold font-mono px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800">
              Live
            </span>
          </div>
          <div>
            <h3 className="font-bold text-sm sm:text-base text-slate-900 group-hover:text-emerald-600 transition-colors">
              Events
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Hackathons, sports & tech fest
            </p>
          </div>
        </button>

        {/* 4. Notices Card */}
        <button
          type="button"
          onClick={() => {
            onSelectCategory('examinations');
          }}
          className="p-5 rounded-2xl border border-slate-200 bg-white hover:border-amber-500 hover:shadow-md transition-all text-left flex flex-col justify-between group cursor-pointer"
        >
          <div className="flex items-center justify-between mb-3">
            <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center group-hover:bg-amber-600 group-hover:text-white transition-colors">
              <Megaphone className="w-5 h-5" />
            </div>
            <span className="text-[11px] font-bold font-mono px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">
              Verified
            </span>
          </div>
          <div>
            <h3 className="font-bold text-sm sm:text-base text-slate-900 group-hover:text-amber-600 transition-colors">
              Notices
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Official exams & timetables
            </p>
          </div>
        </button>
      </div>}

      {/* SECTION E: PRIORITY NOTIFICATIONS (Urgent Notices & Approaching Deadlines Banner) */}
      {urgentAnnouncements.length > 0 && selectedCategory === 'all' && (
        <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 shadow-2xs space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-rose-800 font-bold text-xs uppercase tracking-wider">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
              <span>{isFaculty ? 'Urgent Institutional Announcement' : 'Priority Notice: Mandatory Mid-Semester Verification'}</span>
            </div>
            <span className="text-[11px] font-mono bg-rose-100 text-rose-800 font-bold px-2 py-0.5 rounded">
              Urgent
            </span>
          </div>
          <p className="text-xs text-rose-900 leading-relaxed">
            {urgentAnnouncements[0].title}: {urgentAnnouncements[0].description.slice(0, 140)}...
          </p>
          <div className="pt-1 flex items-center gap-3">
            <button
              type="button"
              onClick={() => onOpenDetails(urgentAnnouncements[0])}
              className="text-xs font-bold text-rose-700 hover:text-rose-900 flex items-center gap-1 cursor-pointer"
            >
              <span>View Full Notice</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Category Filter Chips */}
      <div>
        <div className="flex items-center justify-between mb-2.5">
          <h2 className="text-xs font-bold text-slate-500 uppercase tracking-wider">
            Department Notice Boards
          </h2>
          <span className="text-xs text-slate-400">
            Filtered by campus authority
          </span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
          {CATEGORIES.map((cat) => {
            const Icon = cat.icon;
            const active = selectedCategory === cat.id;
            return (
              <button
                key={cat.id}
                type="button"
                onClick={() => onSelectCategory(cat.id)}
                className={`p-3 rounded-xl border text-left transition-all duration-150 flex flex-col justify-between cursor-pointer ${
                  active
                    ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                    : 'bg-white hover:bg-slate-50 text-slate-700 border-slate-200'
                }`}
              >
                <Icon className={`w-4 h-4 mb-2 ${active ? 'text-white' : 'text-blue-600'}`} />
                <span className="text-xs font-semibold leading-tight">{cat.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* MAIN TWO-COLUMN CONTENT GRID */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* LEFT COLUMN: SECTION C - IMPORTANT ANNOUNCEMENTS FEED */}
        <div className="lg:col-span-8 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
            <div>
              <h3 className="text-base font-bold text-slate-900">
                {searchQuery ? `Search Results for "${searchQuery}"` : 'Verified College Announcements'}
              </h3>
              <p className="text-xs text-slate-500">
                {isFaculty ? 'Prioritized institutional announcements' : `Ranked by your top priorities (${orderedPrefs.join(', ')})`}
              </p>
            </div>

            {/* Announcement ordering */}
            <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl text-xs self-start sm:self-auto border border-slate-200">
              <button
                type="button"
                onClick={() => onSelectSort('relevant')}
                className={`px-3 py-1.5 rounded-lg font-medium transition-colors cursor-pointer ${
                  selectedSort === 'relevant'
                    ? 'bg-white text-slate-900 shadow-2xs font-semibold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {isFaculty ? 'Priority' : 'Smart Ranked'}
              </button>
              <button
                type="button"
                onClick={() => onSelectSort('latest')}
                className={`px-3 py-1.5 rounded-lg font-medium transition-colors cursor-pointer ${
                  selectedSort === 'latest'
                    ? 'bg-white text-slate-900 shadow-2xs font-semibold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Latest
              </button>
              <button
                type="button"
                onClick={() => onSelectSort('deadlines')}
                className={`px-3 py-1.5 rounded-lg font-medium transition-colors cursor-pointer ${
                  selectedSort === 'deadlines'
                    ? 'bg-white text-slate-900 shadow-2xs font-semibold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Deadlines
              </button>
            </div>
          </div>

          {/* Announcement Cards List */}
          {sortedAnnouncements.length === 0 ? (
            <div className="bg-white rounded-3xl border border-slate-200 p-12 text-center space-y-3">
              <BookOpen className="w-10 h-10 text-slate-300 mx-auto" />
              <h4 className="text-base font-semibold text-slate-800">No announcements found</h4>
              <p className="text-xs text-slate-500 max-w-sm mx-auto">
                No active announcements match your current filter. Try selecting "All Notices" or clearing your search query.
              </p>
              <button
                type="button"
                onClick={() => onSelectCategory('all')}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-medium rounded-xl cursor-pointer"
              >
                Reset Filters
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              {sortedAnnouncements.map((ann) => (
                <AnnouncementCard
                  key={ann.id}
                  announcement={ann}
                  isSaved={savedIds.includes(ann.id)}
                  isRegistered={registeredAnnouncementIds.includes(ann.id)}
                  onToggleSave={onToggleSave}
                  onOpenDetails={onOpenDetails}
                  onQuickRegister={onQuickRegister}
                />
              ))}
            </div>
          )}
        </div>

        {/* RIGHT COLUMN: SECTION D (Upcoming Events) + SECTION F (Recent Activity) */}
        <div className="lg:col-span-4 space-y-6">
          {isFaculty && (
            <div className="bg-white rounded-3xl border border-slate-200 p-5 shadow-2xs space-y-4">
              <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider">Faculty workspace</h4>
              <p className="text-sm text-slate-600">Publish updates, organize groups, and manage student batches from your workspace.</p>
              <div className="space-y-2">
                <button type="button" onClick={onOpenDesk} className="w-full text-left px-3 py-2 rounded-xl bg-blue-50 text-blue-800 text-sm font-semibold hover:bg-blue-100">Open Publishing Desk</button>
                <button type="button" onClick={onOpenChat} className="w-full text-left px-3 py-2 rounded-xl bg-indigo-50 text-indigo-800 text-sm font-semibold hover:bg-indigo-100">Open Groups</button>
                <button type="button" onClick={onOpenBatchDirectory} className="w-full text-left px-3 py-2 rounded-xl bg-emerald-50 text-emerald-800 text-sm font-semibold hover:bg-emerald-100">Manage Batches</button>
              </div>
            </div>
          )}
          {/* SECTION D: UPCOMING EVENTS WIDGET */}
          {!isFaculty && <div className="bg-white rounded-3xl border border-slate-200 p-5 shadow-2xs space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Calendar className="w-4 h-4 text-blue-600" />
                <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                  Upcoming College Events
                </h4>
              </div>
              <button
                type="button"
                onClick={onOpenExplore}
                className="text-xs font-semibold text-blue-600 hover:text-blue-800 flex items-center gap-0.5 cursor-pointer"
              >
                <span>View All</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="space-y-3">
              {upcomingEvents.map((evt) => {
                const isReg = registeredAnnouncementIds.includes(evt.id);
                return (
                  <div
                    key={evt.id}
                    className="p-3.5 rounded-2xl border border-slate-100 hover:border-slate-200 bg-slate-50/60 hover:bg-slate-50 transition-colors space-y-2"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-[10px] uppercase font-bold text-blue-700 bg-blue-100/70 px-2 py-0.5 rounded font-mono">
                        {evt.category}
                      </span>
                      {evt.eventDate && (
                        <span className="text-[11px] text-slate-500 font-semibold font-mono">
                          {formatDate(evt.eventDate)}
                        </span>
                      )}
                    </div>

                    <h5
                      onClick={() => onOpenDetails(evt)}
                      className="text-xs font-bold text-slate-900 hover:text-blue-600 transition-colors cursor-pointer line-clamp-2"
                    >
                      {evt.title}
                    </h5>

                    {evt.eventLocation && (
                      <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
                        <MapPin className="w-3 h-3 text-slate-400 shrink-0" />
                        <span className="truncate">{evt.eventLocation}</span>
                      </div>
                    )}

                    <div className="pt-1 flex items-center justify-between">
                      <button
                        type="button"
                        onClick={() => onOpenDetails(evt)}
                        className="text-[11px] text-slate-500 hover:text-slate-800 font-medium cursor-pointer"
                      >
                        Details
                      </button>

                      <button
                        type="button"
                        onClick={() => onQuickRegister(evt.id)}
                        className={`text-xs px-3 py-1 rounded-lg font-semibold transition-colors cursor-pointer ${
                          isReg
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-blue-600 hover:bg-blue-700 text-white shadow-2xs'
                        }`}
                      >
                        {isReg ? 'Registered' : 'Register Now'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>}

          {/* SECTION F: RECENT ACTIVITY */}
          {!isFaculty && <div className="bg-white rounded-3xl border border-slate-200 p-5 shadow-2xs space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-emerald-600" />
                <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                  Recent Campus Activity
                </h4>
              </div>
              <span className="text-[10px] font-mono text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded font-bold">
                Live
              </span>
            </div>

            {/* Empty State (Replaces the 3 fake activity items) */}
            <div className="py-6 text-center">
              <p className="text-sm text-slate-400">No recent activity on campus.</p>
            </div>
          </div>}

          {/* Approaching Deadlines Widget */}
          {!isFaculty && <div className="bg-white rounded-3xl border border-slate-200 p-5 shadow-2xs space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-amber-600" />
                <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                  Approaching Deadlines
                </h4>
              </div>
              <span className="text-[11px] text-slate-400 font-mono">14 Days</span>
            </div>

            <div className="space-y-2.5">
              {upcomingDeadlines.length === 0 ? (
                <p className="text-xs text-slate-500">No approaching deadlines.</p>
              ) : (
                upcomingDeadlines.map((dl) => (
                  <div
                    key={dl.id}
                    onClick={() => onOpenDetails(dl)}
                    className="p-3 rounded-2xl border border-slate-100 hover:border-slate-200 bg-slate-50/50 hover:bg-slate-50 transition-colors cursor-pointer"
                  >
                    <div className="flex items-center justify-between text-[11px] text-amber-700 font-semibold mb-1">
                      <span>Due {formatDate(dl.registrationDeadline)}</span>
                      <span className="capitalize text-slate-500 font-normal">{dl.category}</span>
                    </div>
                    <div className="text-xs font-semibold text-slate-900 line-clamp-2">
                      {dl.title}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>}
        </div>
      </div>
    </div>
  );
};
