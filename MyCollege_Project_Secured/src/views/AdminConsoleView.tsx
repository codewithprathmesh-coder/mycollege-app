import React, { useState, useEffect } from 'react';
import {
  ShieldCheck,
  Users,
  CheckCircle2,
  XCircle,
  Clock,
  Settings,
  History,
  AlertCircle,
  Plus,
  Search,
  ExternalLink,
  GraduationCap,
  Briefcase,
  Building2,
  Check,
  Mail,
  FileSpreadsheet,
  Layers,
  ShieldAlert,
  KeyRound,
  RotateCcw,
  Lock,
  Unlock,
  Sparkles,
} from 'lucide-react';
import type {
  Announcement,
  ApprovedDatasetReport,
  ApprovedStudent,
  AuditLog,
  Institution,
  PlatformStats,
  User,
  UserRole,
} from '../types';
import { api } from '../services/api';

interface AdminConsoleViewProps {
  currentUser: User;
  currentInstitution: Institution;
  announcements: Announcement[];
  users: User[];
  onApproveAnnouncement: (id: string) => Promise<void>;
  onRejectAnnouncement: (id: string, reason?: string) => Promise<void>;
  onOpenDetails: (announcement: Announcement) => void;
  onRefreshData: () => Promise<void>;
}

type AdminTab = 'approvals' | 'users' | 'roster' | 'settings' | 'audit';

export const AdminConsoleView: React.FC<AdminConsoleViewProps> = ({
  currentUser,
  currentInstitution,
  announcements,
  users,
  onApproveAnnouncement,
  onRejectAnnouncement,
  onOpenDetails,
  onRefreshData,
}) => {
  const [activeTab, setActiveTab] = useState<AdminTab>('approvals');
  const [stats, setStats] = useState<PlatformStats | null>(null);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Approvals actions
  const [processingId, setProcessingId] = useState<string | null>(null);

  // User management
  const [userSearch, setUserSearch] = useState('');
  const [showAddUser, setShowAddUser] = useState(false);

  // Settings
  const [requireApproval, setRequireApproval] = useState(currentInstitution.requireApproval);
  const [allowedDomainsStr, setAllowedDomainsStr] = useState(
    currentInstitution.allowedDomains.join(', ')
  );
  const [settingsSaved, setSettingsSaved] = useState(false);

  // Approved Student Roster state (SY AI-DS 2026–27)
  const [approvedStudents, setApprovedStudents] = useState<ApprovedStudent[]>([]);
  const [rosterReport, setRosterReport] = useState<ApprovedDatasetReport | null>(null);
  const [rosterSearch, setRosterSearch] = useState('');
  const [rosterDivisionFilter, setRosterDivisionFilter] = useState<'all' | 'sy-aids-a' | 'sy-aids-b' | 'shared'>('all');
  const [showAddApprovedModal, setShowAddApprovedModal] = useState(false);
  const [newApprovedEmail, setNewApprovedEmail] = useState('');
  const [newApprovedDivA, setNewApprovedDivA] = useState(true);
  const [newApprovedDivB, setNewApprovedDivB] = useState(false);
  const [rosterLoading, setRosterLoading] = useState(false);
  const [rosterActionMsg, setRosterActionMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  const showRosterFeedback = (text: string, type: 'success' | 'error' = 'success') => {
    setRosterActionMsg({ text, type });
    setTimeout(() => setRosterActionMsg(null), 3500);
  };

  const loadApprovedRoster = async () => {
    try {
      setRosterLoading(true);
      const res = await api.getApprovedStudents();
      setApprovedStudents(res.students);
      setRosterReport(res.report);
    } catch (err: any) {
      console.error('Failed to load approved roster:', err);
    } finally {
      setRosterLoading(false);
    }
  };

  useEffect(() => {
    loadStatsAndLogs();
    loadApprovedRoster();
  }, [currentInstitution.id]);

  const handleToggleStudentStatus = async (student: ApprovedStudent) => {
    const nextStatus = student.status === 'authorized' ? 'revoked' : 'authorized';
    try {
      await api.updateApprovedStudent(student.email, { status: nextStatus });
      setApprovedStudents((prev) =>
        prev.map((s) => (s.email === student.email ? { ...s, status: nextStatus } : s))
      );
      showRosterFeedback(`Student ${student.email} status changed to ${nextStatus}.`);
      await loadStatsAndLogs();
    } catch (err: any) {
      showRosterFeedback(err.message || 'Failed to update student status', 'error');
    }
  };

  const handleToggleStudentDivision = async (student: ApprovedStudent, divId: string) => {
    let nextDivs = [...student.divisionIds];
    if (nextDivs.includes(divId)) {
      if (nextDivs.length === 1) {
        showRosterFeedback('A student must belong to at least one division.', 'error');
        return;
      }
      nextDivs = nextDivs.filter((d) => d !== divId);
    } else {
      nextDivs.push(divId);
    }

    try {
      await api.updateApprovedStudent(student.email, { divisionIds: nextDivs });
      setApprovedStudents((prev) =>
        prev.map((s) => (s.email === student.email ? { ...s, divisionIds: nextDivs } : s))
      );
      showRosterFeedback(`Updated division assignments for ${student.email}.`);
      await loadStatsAndLogs();
    } catch (err: any) {
      showRosterFeedback(err.message || 'Failed to update student divisions', 'error');
    }
  };

  const handleAddApprovedStudentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanEmail = newApprovedEmail.trim().toLowerCase();
    const divs: string[] = [];
    if (newApprovedDivA) divs.push('sy-aids-a');
    if (newApprovedDivB) divs.push('sy-aids-b');

    if (!divs.length) {
      showRosterFeedback('Please select at least one division.', 'error');
      return;
    }

    try {
      await api.addApprovedStudent({ email: cleanEmail, divisionIds: divs });
      setShowAddApprovedModal(false);
      setNewApprovedEmail('');
      showRosterFeedback(`Successfully authorized ${cleanEmail} for SY AI-DS 2026–27.`);
      await loadApprovedRoster();
      await loadStatsAndLogs();
    } catch (err: any) {
      showRosterFeedback(err.message || 'Failed to authorize student email', 'error');
    }
  };

  const loadStatsAndLogs = async () => {
    setIsLoading(true);
    try {
      const [sRes, lRes] = await Promise.all([
        api.getStats(currentInstitution.id),
        api.getAuditLogs(currentInstitution.id),
      ]);
      setStats(sRes.stats);
      setAuditLogs(lRes.auditLogs);
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  const pendingAnnouncements = announcements.filter((a) => a.status === 'pending_approval');

  const handleApprove = async (id: string) => {
    setProcessingId(id);
    try {
      await onApproveAnnouncement(id);
      await loadStatsAndLogs();
    } finally {
      setProcessingId(null);
    }
  };

  const handleReject = async (id: string) => {
    const reason = prompt('Reason for declining this announcement (optional):');
    if (reason === null) return;
    setProcessingId(id);
    try {
      await onRejectAnnouncement(id, reason);
      await loadStatsAndLogs();
    } finally {
      setProcessingId(null);
    }
  };

  const handleRoleChange = async (userId: string, newRole: UserRole) => {
    try {
      await api.updateUserRole(userId, newRole);
      await onRefreshData();
      await loadStatsAndLogs();
    } catch (err: any) {
      alert(err.message || 'Failed to update user role');
    }
  };

  const handleSaveSettings = async () => {
    try {
      const domains = allowedDomainsStr
        .split(',')
        .map((d) => d.trim())
        .filter(Boolean);
      await api.updateInstitutionSettings(currentInstitution.id, {
        requireApproval,
        allowedDomains: domains,
      });
      setSettingsSaved(true);
      setTimeout(() => setSettingsSaved(false), 2000);
      await onRefreshData();
    } catch (err: any) {
      alert(err.message || 'Failed to update institutional settings');
    }
  };

  const filteredUsers = users.filter((u) => {
    const q = userSearch.toLowerCase();
    return (
      u.name.toLowerCase().includes(q) ||
      u.email.toLowerCase().includes(q) ||
      u.role.toLowerCase().includes(q)
    );
  });

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold text-indigo-700 mb-1">
            <ShieldCheck className="w-4 h-4 text-indigo-600" />
            <span>Administrator Console</span>
            <span>·</span>
            <span>{currentInstitution.name}</span>
          </div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
            Institutional Administration & Governance
          </h1>
          <p className="text-xs sm:text-sm text-slate-500">
            Audit institutional circulars, approve pending faculty announcements, verify student accounts, and enforce domain isolation.
          </p>
        </div>
      </div>

      {/* KPI Stats Bar */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-2xs">
          <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block mb-1">
            Total Users
          </span>
          <div className="text-2xl font-bold text-slate-900 font-mono tabular-nums">
            {stats?.totalUsers ?? users.length}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-2xs">
          <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block mb-1">
            Enrolled Students
          </span>
          <div className="text-2xl font-bold text-emerald-600 font-mono tabular-nums">
            {stats?.studentsCount ?? users.filter((u) => u.role === 'student').length}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-2xs">
          <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block mb-1">
            Faculty & Staff
          </span>
          <div className="text-2xl font-bold text-blue-600 font-mono tabular-nums">
            {stats?.facultyCount ?? users.filter((u) => u.role === 'faculty').length}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-2xs">
          <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block mb-1">
            Published Notices
          </span>
          <div className="text-2xl font-bold text-slate-900 font-mono tabular-nums">
            {stats?.activeAnnouncements ?? announcements.filter((a) => a.status === 'published').length}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-2xs">
          <span className="text-[11px] font-semibold text-amber-700 uppercase tracking-wider block mb-1">
            Pending Approvals
          </span>
          <div className="text-2xl font-bold text-amber-600 font-mono tabular-nums">
            {pendingAnnouncements.length}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-2xs">
          <span className="text-[11px] font-semibold text-indigo-700 uppercase tracking-wider block mb-1">
            Registrations
          </span>
          <div className="text-2xl font-bold text-indigo-600 font-mono tabular-nums">
            {stats?.totalRegistrations ?? 0}
          </div>
        </div>
      </div>

      {/* Admin Sub-Tabs */}
      <div className="flex items-center gap-1 sm:gap-2 border-b border-slate-200 pb-2 overflow-x-auto no-scrollbar">
        <button
          type="button"
          onClick={() => setActiveTab('approvals')}
          className={`flex items-center gap-2 px-3.5 py-2 text-xs sm:text-sm font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 ${
            activeTab === 'approvals'
              ? 'bg-amber-500 text-white shadow-2xs'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
          }`}
        >
          <Clock className="w-4 h-4" />
          <span>Pending Approvals</span>
          {pendingAnnouncements.length > 0 && (
            <span className="text-xs px-1.5 py-0.2 rounded-full bg-white text-amber-900 font-bold font-mono">
              {pendingAnnouncements.length}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('users')}
          className={`flex items-center gap-2 px-3.5 py-2 text-xs sm:text-sm font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 ${
            activeTab === 'users'
              ? 'bg-indigo-600 text-white shadow-2xs'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
          }`}
        >
          <Users className="w-4 h-4" />
          <span>User & Role Governance</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('roster')}
          className={`flex items-center gap-2 px-3.5 py-2 text-xs sm:text-sm font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 ${
            activeTab === 'roster'
              ? 'bg-blue-600 text-white shadow-2xs'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
          }`}
        >
          <GraduationCap className="w-4 h-4" />
          <span>Approved Roster (SY AI-DS)</span>
          <span className="text-xs px-1.5 py-0.2 rounded-full bg-blue-100 text-blue-900 font-bold font-mono">
            {rosterReport?.uniqueAddressesOverall || approvedStudents.length || 143}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('settings')}
          className={`flex items-center gap-2 px-3.5 py-2 text-xs sm:text-sm font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 ${
            activeTab === 'settings'
              ? 'bg-indigo-600 text-white shadow-2xs'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
          }`}
        >
          <Settings className="w-4 h-4" />
          <span>Institutional Policies</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('audit')}
          className={`flex items-center gap-2 px-3.5 py-2 text-xs sm:text-sm font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 ${
            activeTab === 'audit'
              ? 'bg-indigo-600 text-white shadow-2xs'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
          }`}
        >
          <History className="w-4 h-4" />
          <span>System Audit Trail</span>
        </button>
      </div>

      {/* Tab 1: Pending Approvals Queue */}
      {activeTab === 'approvals' && (
        <div className="space-y-4">
          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-2xs">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-sm sm:text-base text-slate-900">
                  Announcement Approval Queue
                </h3>
                <p className="text-xs text-slate-500">
                  Faculty and coordinator proposals waiting for dean approval before broadcast to students.
                </p>
              </div>
              <span className="text-xs font-mono text-slate-400">
                {pendingAnnouncements.length} awaiting review
              </span>
            </div>

            {pendingAnnouncements.length === 0 ? (
              <div className="p-12 text-center text-slate-500">
                <CheckCircle2 className="w-10 h-10 text-emerald-400 mx-auto mb-2" />
                <h4 className="font-bold text-slate-800 text-sm">All submissions approved</h4>
                <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
                  No announcements currently require administrative review. Any newly submitted faculty circulars will appear here.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {pendingAnnouncements.map((ann) => (
                  <div key={ann.id} className="p-5 hover:bg-slate-50/50 space-y-3">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <div className="flex items-center gap-2 text-xs text-slate-500">
                        <span className="font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-0.5">
                          Submitted for Approval
                        </span>
                        <span>·</span>
                        <span className="capitalize font-medium text-slate-700">{ann.category}</span>
                        <span>·</span>
                        <span>Author: {ann.authorName} ({ann.authorRole})</span>
                      </div>

                      <div className="flex items-center gap-2 self-start sm:self-auto">
                        <button
                          type="button"
                          onClick={() => handleApprove(ann.id)}
                          disabled={processingId === ann.id}
                          className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-lg flex items-center gap-1.5 transition-colors shadow-2xs"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>{processingId === ann.id ? 'Approving...' : 'Approve & Publish'}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleReject(ann.id)}
                          disabled={processingId === ann.id}
                          className="px-3 py-1.5 border border-rose-300 text-rose-600 hover:bg-rose-50 text-xs font-semibold rounded-lg flex items-center gap-1.5 transition-colors"
                        >
                          <XCircle className="w-3.5 h-3.5" />
                          <span>Decline</span>
                        </button>
                      </div>
                    </div>

                    <h4
                      onClick={() => onOpenDetails(ann)}
                      className="font-bold text-base text-slate-900 hover:text-blue-600 cursor-pointer transition-colors"
                    >
                      {ann.title}
                    </h4>

                    <p className="text-xs sm:text-sm text-slate-600 leading-relaxed line-clamp-2">
                      {ann.description}
                    </p>

                    <div className="text-xs text-slate-500 flex items-center gap-3 pt-1">
                      <span>Department: {ann.publishingDepartment}</span>
                      <span>·</span>
                      <span>Target: {ann.targetAudience.type}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab 2: User Governance */}
      {activeTab === 'users' && (
        <div className="space-y-4">
          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-2xs space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="relative flex-1 max-w-md">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                <input
                  type="text"
                  value={userSearch}
                  onChange={(e) => setUserSearch(e.target.value)}
                  placeholder="Search user by name, email, or role..."
                  className="w-full pl-9 pr-4 py-2 border border-slate-200 rounded-lg text-xs sm:text-sm"
                />
              </div>

              <button
                type="button"
                onClick={() => setShowAddUser(!showAddUser)}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-medium text-xs sm:text-sm rounded-lg flex items-center gap-2 self-start sm:self-auto"
              >
                <Plus className="w-4 h-4" />
                <span>Account setup</span>
              </button>
            </div>

            {showAddUser && (
              <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-2 text-xs">
                <div className="font-bold text-sm text-slate-900">
                  Accounts come from trusted college records
                </div>
                <p className="text-slate-600">
                  Add students in the Approved Roster and assign their divisions. Add faculty to the authorized faculty directory.
                  Once their record is active, they can sign in using email OTP and their profile will appear here.
                </p>
                <p className="text-slate-600">
                  Do not register an account or grant a role by creating a profile directly. Role changes below are saved to the database and require the user to sign in again.
                </p>
              </div>
            )}

            {/* Users Table */}
            <div className="divide-y divide-slate-100 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="text-slate-400 font-semibold border-b border-slate-200">
                    <th className="py-2.5 px-3">Name</th>
                    <th className="py-2.5 px-3">Verified Email</th>
                    <th className="py-2.5 px-3">Department</th>
                    <th className="py-2.5 px-3">Designation</th>
                    <th className="py-2.5 px-3">Role & Permissions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredUsers.map((u) => (
                    <tr key={u.id} className="hover:bg-slate-50">
                      <td className="py-3 px-3 font-semibold text-slate-900">
                        {u.name}
                        {u.id === currentUser.id && (
                          <span className="ml-1.5 text-[10px] text-blue-600 font-normal">(You)</span>
                        )}
                      </td>
                      <td className="py-3 px-3 text-slate-600 font-mono">{u.email}</td>
                      <td className="py-3 px-3 text-slate-600">{u.departmentName || 'General'}</td>
                      <td className="py-3 px-3 text-slate-600">{u.designation || '—'}</td>
                      <td className="py-3 px-3">
                        <select
                          value={u.role}
                          onChange={(e) => handleRoleChange(u.id, e.target.value as UserRole)}
                          className="px-2 py-1 border border-slate-200 rounded text-xs bg-white text-slate-800 font-medium"
                        >
                          <option value="student">Student</option>
                          <option value="faculty">Faculty</option>
                          <option value="coordinator">Coordinator</option>
                          <option value="admin">Administrator</option>
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Tab: Approved Student Roster (SY AI-DS 2026–27) */}
      {activeTab === 'roster' && (
        <div className="space-y-4">
          {/* Action Feedback Banner */}
          {rosterActionMsg && (
            <div
              className={`p-3.5 rounded-xl border text-xs font-semibold flex items-center justify-between animate-in fade-in ${
                rosterActionMsg.type === 'error'
                  ? 'bg-rose-50 border-rose-200 text-rose-800'
                  : 'bg-emerald-50 border-emerald-200 text-emerald-800'
              }`}
            >
              <div className="flex items-center gap-2">
                {rosterActionMsg.type === 'error' ? (
                  <AlertCircle className="w-4 h-4 text-rose-600" />
                ) : (
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                )}
                <span>{rosterActionMsg.text}</span>
              </div>
              <button
                type="button"
                onClick={() => setRosterActionMsg(null)}
                className="text-slate-400 hover:text-slate-600 font-bold ml-2"
              >
                ✕
              </button>
            </div>
          )}

          {/* Roster Overview Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-2xs">
              <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block mb-1">
                Unique Students
              </span>
              <div className="text-2xl font-bold text-blue-700 font-mono tabular-nums">
                {rosterReport?.uniqueAddressesOverall || approvedStudents.length}
              </div>
              <span className="text-[10px] text-slate-400">Total single identities</span>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-2xs">
              <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block mb-1">
                Division A
              </span>
              <div className="text-2xl font-bold text-indigo-700 font-mono tabular-nums">
                {rosterReport?.totalSuppliedDivisionA || 83}
              </div>
              <span className="text-[10px] text-slate-400">SY-A AI-DS entries</span>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-2xs">
              <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block mb-1">
                Division B
              </span>
              <div className="text-2xl font-bold text-teal-700 font-mono tabular-nums">
                {rosterReport?.totalSuppliedDivisionB || 76}
              </div>
              <span className="text-[10px] text-slate-400">SY-B AI-DS entries</span>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-2xs">
              <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block mb-1">
                Shared Div A & B
              </span>
              <div className="text-2xl font-bold text-purple-700 font-mono tabular-nums">
                {rosterReport?.sharedAddressesCount || 16}
              </div>
              <span className="text-[10px] text-slate-400">Dual division members</span>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-2xs">
              <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block mb-1">
                Activated Profiles
              </span>
              <div className="text-2xl font-bold text-emerald-600 font-mono tabular-nums">
                {approvedStudents.filter((s) => s.isRegistered).length}
              </div>
              <span className="text-[10px] text-slate-400">Completed OTP & setup</span>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-2xs">
              <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block mb-1">
                Pending OTP
              </span>
              <div className="text-2xl font-bold text-amber-600 font-mono tabular-nums">
                {approvedStudents.filter((s) => !s.isRegistered).length}
              </div>
              <span className="text-[10px] text-slate-400">Awaiting first login</span>
            </div>
          </div>

          {/* Roster Table Card */}
          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-2xs space-y-4">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
              <div>
                <h3 className="font-bold text-base text-slate-900">
                  Approved Student Access Directory
                </h3>
                <p className="text-xs text-slate-500">
                  Only emails listed below can receive single-use verification codes. Division assignments are locked and authoritative.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={loadApprovedRoster}
                  disabled={rosterLoading}
                  className="px-3 py-1.5 border border-slate-200 hover:bg-slate-50 text-slate-700 font-medium text-xs rounded-lg flex items-center gap-1.5 cursor-pointer"
                  title="Reload roster"
                >
                  <RotateCcw className={`w-3.5 h-3.5 ${rosterLoading ? 'animate-spin' : ''}`} />
                  <span>Refresh</span>
                </button>

                <button
                  type="button"
                  onClick={() => setShowAddApprovedModal(!showAddApprovedModal)}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium text-xs sm:text-sm rounded-lg flex items-center gap-2 cursor-pointer shadow-xs"
                >
                  <Plus className="w-4 h-4" />
                  <span>Authorize New Student</span>
                </button>
              </div>
            </div>

            {/* Add Approved Student Drawer */}
            {showAddApprovedModal && (
              <form
                onSubmit={handleAddApprovedStudentSubmit}
                className="p-4 bg-blue-50/50 rounded-xl border border-blue-200 space-y-3 text-xs"
              >
                <div className="font-bold text-sm text-blue-950 flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-blue-600" />
                  <span>Authorize New Student Email for SY AI-DS 2026–27</span>
                </div>
                <p className="text-xs text-slate-600">
                  Add an authorized Somaiya college email to permit registration and genuine OTP verification.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
                  <div className="sm:col-span-2">
                    <label className="block text-slate-700 font-semibold mb-1">
                      Student College Email (@somaiya.edu)
                    </label>
                    <input
                      type="email"
                      required
                      value={newApprovedEmail}
                      onChange={(e) => setNewApprovedEmail(e.target.value)}
                      placeholder="student.name@somaiya.edu"
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs bg-white text-slate-900 focus:ring-2 focus:ring-blue-500 outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-700 font-semibold mb-1">Division Assignment</label>
                    <div className="flex items-center gap-4 py-1.5">
                      <label className="flex items-center gap-1.5 cursor-pointer font-medium text-slate-800">
                        <input
                          type="checkbox"
                          checked={newApprovedDivA}
                          onChange={(e) => setNewApprovedDivA(e.target.checked)}
                          className="rounded text-blue-600"
                        />
                        <span>SY-A</span>
                      </label>
                      <label className="flex items-center gap-1.5 cursor-pointer font-medium text-slate-800">
                        <input
                          type="checkbox"
                          checked={newApprovedDivB}
                          onChange={(e) => setNewApprovedDivB(e.target.checked)}
                          className="rounded text-blue-600"
                        />
                        <span>SY-B</span>
                      </label>
                    </div>
                  </div>
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowAddApprovedModal(false)}
                    className="px-3 py-1.5 border border-slate-200 text-slate-600 hover:bg-slate-100 rounded-lg"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg shadow-2xs"
                  >
                    Authorize Email
                  </button>
                </div>
              </form>
            )}

            {/* Filter Bar & Search */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2">
              {/* Division Filters */}
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setRosterDivisionFilter('all')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                    rosterDivisionFilter === 'all'
                      ? 'bg-slate-900 text-white'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  All ({approvedStudents.length})
                </button>
                <button
                  type="button"
                  onClick={() => setRosterDivisionFilter('sy-aids-a')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                    rosterDivisionFilter === 'sy-aids-a'
                      ? 'bg-blue-600 text-white'
                      : 'bg-blue-50 text-blue-700 hover:bg-blue-100'
                  }`}
                >
                  Div A ({approvedStudents.filter((s) => s.divisionIds.includes('sy-aids-a')).length})
                </button>
                <button
                  type="button"
                  onClick={() => setRosterDivisionFilter('sy-aids-b')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                    rosterDivisionFilter === 'sy-aids-b'
                      ? 'bg-teal-600 text-white'
                      : 'bg-teal-50 text-teal-700 hover:bg-teal-100'
                  }`}
                >
                  Div B ({approvedStudents.filter((s) => s.divisionIds.includes('sy-aids-b')).length})
                </button>
                <button
                  type="button"
                  onClick={() => setRosterDivisionFilter('shared')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                    rosterDivisionFilter === 'shared'
                      ? 'bg-purple-600 text-white'
                      : 'bg-purple-50 text-purple-700 hover:bg-purple-100'
                  }`}
                >
                  Shared ({approvedStudents.filter((s) => s.divisionIds.length > 1).length})
                </button>
              </div>

              {/* Search Bar */}
              <div className="relative flex-1 max-w-xs">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                <input
                  type="text"
                  value={rosterSearch}
                  onChange={(e) => setRosterSearch(e.target.value)}
                  placeholder="Search by email, name, username..."
                  className="w-full pl-9 pr-4 py-2 border border-slate-200 rounded-lg text-xs"
                />
              </div>
            </div>

            {/* Roster Table */}
            <div className="overflow-x-auto border border-slate-200 rounded-xl">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-500 font-semibold border-b border-slate-200">
                  <tr>
                    <th className="py-2.5 px-3">Authorized Student Email</th>
                    <th className="py-2.5 px-3">Division Assignment(s)</th>
                    <th className="py-2.5 px-3">Auth Status</th>
                    <th className="py-2.5 px-3">Student Identity & Profile</th>
                    <th className="py-2.5 px-3 text-right">Access Control</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {approvedStudents
                    .filter((s) => {
                      if (rosterDivisionFilter === 'sy-aids-a') {
                        if (!s.divisionIds.includes('sy-aids-a')) return false;
                      } else if (rosterDivisionFilter === 'sy-aids-b') {
                        if (!s.divisionIds.includes('sy-aids-b')) return false;
                      } else if (rosterDivisionFilter === 'shared') {
                        if (s.divisionIds.length < 2) return false;
                      }
                      if (rosterSearch.trim()) {
                        const q = rosterSearch.toLowerCase();
                        return (
                          s.email.toLowerCase().includes(q) ||
                          (s.registeredName && s.registeredName.toLowerCase().includes(q)) ||
                          (s.registeredUsername && s.registeredUsername.toLowerCase().includes(q))
                        );
                      }
                      return true;
                    })
                    .map((student) => {
                      const isShared = student.divisionIds.length > 1;
                      return (
                        <tr key={student.email} className="hover:bg-slate-50/80 transition-colors">
                          <td className="py-3 px-3">
                            <div className="font-mono font-semibold text-slate-900">{student.email}</div>
                            {isShared && (
                              <span className="text-[10px] font-semibold text-purple-700 bg-purple-50 px-1.5 py-0.2 rounded border border-purple-200 inline-block mt-0.5">
                                Dual Division Student
                              </span>
                            )}
                          </td>

                          <td className="py-3 px-3">
                            <div className="flex flex-wrap gap-1.5">
                              <button
                                type="button"
                                onClick={() => handleToggleStudentDivision(student, 'sy-aids-a')}
                                className={`text-[10px] font-bold px-2 py-0.5 rounded border transition-colors cursor-pointer ${
                                  student.divisionIds.includes('sy-aids-a')
                                    ? 'bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100'
                                    : 'bg-slate-100 text-slate-400 border-slate-200 hover:text-slate-600'
                                }`}
                                title="Click to toggle Division A"
                              >
                                SY-A
                              </button>
                              <button
                                type="button"
                                onClick={() => handleToggleStudentDivision(student, 'sy-aids-b')}
                                className={`text-[10px] font-bold px-2 py-0.5 rounded border transition-colors cursor-pointer ${
                                  student.divisionIds.includes('sy-aids-b')
                                    ? 'bg-teal-50 text-teal-700 border-teal-200 hover:bg-teal-100'
                                    : 'bg-slate-100 text-slate-400 border-slate-200 hover:text-slate-600'
                                }`}
                                title="Click to toggle Division B"
                              >
                                SY-B
                              </button>
                            </div>
                          </td>

                          <td className="py-3 px-3">
                            {student.status === 'authorized' ? (
                              <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-2 py-0.5">
                                <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                                Authorized
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-[11px] font-bold text-rose-700 bg-rose-50 border border-rose-200 rounded px-2 py-0.5">
                                <XCircle className="w-3 h-3 text-rose-600" />
                                Access Revoked
                              </span>
                            )}
                          </td>

                          <td className="py-3 px-3">
                            {student.isRegistered ? (
                              <div className="space-y-0.5">
                                <div className="font-semibold text-slate-900">{student.registeredName}</div>
                                {student.registeredUsername && (
                                  <div className="text-[11px] font-mono text-blue-600">
                                    @{student.registeredUsername}
                                  </div>
                                )}
                              </div>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-0.5 font-medium">
                                <Clock className="w-3 h-3" />
                                Pending OTP Registration
                              </span>
                            )}
                          </td>

                          <td className="py-3 px-3 text-right">
                            <button
                              type="button"
                              onClick={() => handleToggleStudentStatus(student)}
                              className={`px-2.5 py-1 text-[11px] font-semibold rounded-lg transition-colors cursor-pointer border ${
                                student.status === 'authorized'
                                  ? 'text-rose-700 bg-rose-50 border-rose-200 hover:bg-rose-100'
                                  : 'text-emerald-700 bg-emerald-50 border-emerald-200 hover:bg-emerald-100'
                              }`}
                            >
                              {student.status === 'authorized' ? 'Revoke Access' : 'Re-Authorize'}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Tab 4: Institutional Governance Policies */}
      {activeTab === 'settings' && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-2xs space-y-6 max-w-3xl">
          <div>
            <h3 className="font-bold text-base text-slate-900">
              Institutional Governance & Security Policies
            </h3>
            <p className="text-xs text-slate-500">
              Manage tenant boundaries, approval workflows, and domain restrictions for {currentInstitution.name}.
            </p>
          </div>

          <div className="space-y-4 text-xs sm:text-sm">
            {/* Require Approval Toggle */}
            <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/50 flex items-start justify-between gap-4">
              <div className="space-y-1">
                <div className="font-bold text-slate-900">
                  Enforce Administrative Approval for Announcements
                </div>
                <p className="text-xs text-slate-500">
                  When enabled, all announcements authored by Faculty or Student Coordinators require Dean approval before becoming visible on the student home feed.
                </p>
              </div>

              <input
                type="checkbox"
                checked={requireApproval}
                onChange={(e) => setRequireApproval(e.target.checked)}
                className="w-5 h-5 rounded text-indigo-600 mt-1 cursor-pointer"
              />
            </div>

            {/* Allowed Email Domains */}
            <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/50 space-y-2">
              <div className="font-bold text-slate-900">
                Authorized College Email Domains
              </div>
              <p className="text-xs text-slate-500">
                Comma-separated email domains allowed for institutional account registration. Prevents unauthorized signups.
              </p>
              <input
                type="text"
                value={allowedDomainsStr}
                onChange={(e) => setAllowedDomainsStr(e.target.value)}
                placeholder="somaiya.edu, kjsce.edu.in"
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs font-mono bg-white"
              />
            </div>

            {/* Tenant details */}
            <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/50 space-y-2 text-xs">
              <div className="font-bold text-slate-900">Tenant Identity</div>
              <div className="text-slate-600">
                College: <strong>{currentInstitution.name}</strong> ({currentInstitution.shortName})
              </div>
              <div className="text-slate-600">Established: {currentInstitution.established} · Location: {currentInstitution.city}</div>
            </div>
          </div>

          <div className="flex items-center justify-between pt-4 border-t border-slate-100">
            {settingsSaved ? (
              <span className="text-xs text-emerald-600 font-semibold flex items-center gap-1">
                <CheckCircle2 className="w-4 h-4" />
                Institutional settings updated!
              </span>
            ) : (
              <span />
            )}

            <button
              type="button"
              onClick={handleSaveSettings}
              className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs sm:text-sm rounded-lg shadow-sm"
            >
              Save Governance Settings
            </button>
          </div>
        </div>
      )}

      {/* Tab 4: Audit Logs */}
      {activeTab === 'audit' && (
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-2xs">
          <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
            <h3 className="font-bold text-sm sm:text-base text-slate-900">
              Institutional Security & Activity Audit Trail
            </h3>
            <span className="text-xs text-slate-400 font-mono">
              {auditLogs.length} events logged
            </span>
          </div>

          <div className="divide-y divide-slate-100">
            {auditLogs.map((log) => (
              <div key={log.id} className="p-4 hover:bg-slate-50/50 flex items-start gap-3 text-xs">
                <div className="p-2 rounded-lg bg-slate-100 text-slate-600 shrink-0 mt-0.5">
                  <History className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono font-bold text-slate-900">{log.action}</span>
                    <span className="text-slate-400 font-mono text-[11px]">
                      {new Date(log.timestamp).toLocaleString()}
                    </span>
                  </div>
                  <p className="text-slate-700 mt-0.5 leading-relaxed">{log.details}</p>
                  <div className="text-[11px] text-slate-500 mt-1">
                    Actor: {log.userName} ({log.userRole})
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
