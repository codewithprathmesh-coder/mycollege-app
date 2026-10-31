import React, { useState } from 'react';
import {
  X,
  CheckCircle2,
  Shield,
  GraduationCap,
  Briefcase,
  Users,
  Bell,
  Heart,
  Save,
  LogOut,
} from 'lucide-react';
import type { Institution, User } from '../types';
import { api } from '../services/api';

interface UserProfileModalProps {
  currentUser: User;
  currentInstitution: Institution;
  onClose: () => void;
  onUpdateUser: (user: User) => void;
  onLogout?: () => void;
}

const AVAILABLE_INTERESTS = [
  'Hackathons',
  'AI & Machine Learning',
  'Internships',
  'Robotics',
  'Competitive Coding',
  'Academics',
  'Fests',
  'Sports',
  'Badminton',
  'Research',
  'Cloud Computing',
  'Cyber Security',
];

export const UserProfileModal: React.FC<UserProfileModalProps> = ({
  currentUser,
  currentInstitution,
  onClose,
  onUpdateUser,
  onLogout,
}) => {
  const [selectedInterests, setSelectedInterests] = useState<string[]>(
    currentUser.interests || ['Academics']
  );
  const [prefs, setPrefs] = useState(currentUser.notificationPreferences);
  const [isSaving, setIsSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState(false);
  const isFaculty = currentUser.role === 'faculty';

  const toggleInterest = (interest: string) => {
    if (selectedInterests.includes(interest)) {
      setSelectedInterests(selectedInterests.filter((i) => i !== interest));
    } else {
      setSelectedInterests([...selectedInterests, interest]);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const res = await api.updatePreferences({
        interests: selectedInterests,
        notificationPreferences: prefs,
      });
      onUpdateUser(res.user);
      setSavedMsg(true);
      setTimeout(() => setSavedMsg(false), 2000);
    } catch (err) {
      console.error(err);
    } finally {
      setIsSaving(false);
    }
  };

  const getRoleIcon = () => {
    switch (currentUser.role) {
      case 'admin':
        return <Shield className="w-5 h-5 text-indigo-600" />;
      case 'faculty':
        return <Briefcase className="w-5 h-5 text-blue-600" />;
      case 'coordinator':
        return <Users className="w-5 h-5 text-teal-600" />;
      default:
        return <GraduationCap className="w-5 h-5 text-emerald-600" />;
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4">
      <div className="relative bg-white w-full max-w-lg rounded-2xl shadow-2xl border border-slate-200 overflow-hidden my-6">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/50">
          <h3 className="font-bold text-base sm:text-lg text-slate-900">
            {currentUser.role === 'faculty' ? 'Faculty Profile' : 'User Profile & Preferences'}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 max-h-[75vh] overflow-y-auto space-y-5 text-xs sm:text-sm">
          {/* User ID card */}
          <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 flex items-start gap-4">
            <div className="w-12 h-12 rounded-xl bg-blue-600 text-white font-bold text-lg flex items-center justify-center shadow-xs shrink-0">
              {currentUser.name.slice(0, 2).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <h4 className="font-bold text-base text-slate-900 truncate">{currentUser.name}</h4>
                <span className="flex items-center gap-1 text-[11px] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-1.5 py-0.2 font-medium">
                  <CheckCircle2 className="w-3 h-3" />
                  Verified
                </span>
              </div>
              <div className="text-xs text-slate-500 font-mono mt-0.5">{currentUser.email}</div>
              {currentUser.designation && (
                <div className="text-xs text-blue-700 font-semibold mt-1">
                  {currentUser.designation}
                </div>
              )}
              {currentUser.username && (
                <div className="text-xs font-mono text-blue-600 font-semibold mt-0.5">
                  @{currentUser.username}
                </div>
              )}
              <div className="text-xs text-slate-600 mt-2 flex items-center gap-1.5 font-medium">
                {getRoleIcon()}
                <span className="capitalize">{currentUser.role}</span>
                <span>·</span>
                <span>{currentUser.departmentName || 'General Campus'}</span>
                {currentUser.year && <span>· {currentUser.year}</span>}
              </div>
            </div>
          </div>

          {/* Division Memberships (Registrar Locked) */}
          {currentUser.role !== 'faculty' && <div className="p-3.5 rounded-xl border border-indigo-100 bg-indigo-50/50 text-xs text-indigo-900 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="font-bold flex items-center gap-1.5">
                <Shield className="w-3.5 h-3.5 text-indigo-600" />
                <span>Division Membership (AY 2026–27)</span>
              </span>
              <span className="text-[10px] font-semibold text-indigo-700 bg-indigo-100 px-2 py-0.5 rounded-full">
                Locked by Registrar
              </span>
            </div>
            <div className="font-medium text-slate-800">
              {currentUser.divisionNames && currentUser.divisionNames.length > 0 ? (
                <div className="space-y-1 mt-1">
                  {currentUser.divisionNames.map((dName) => (
                    <div key={dName} className="flex items-center gap-1.5 font-mono text-xs bg-white/80 border border-indigo-200/80 px-2.5 py-1 rounded-lg">
                      <span className="w-2 h-2 rounded-full bg-indigo-600" />
                      <span>{dName}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <span className="font-mono">{currentUser.division || 'SY-A-DIVISION AI-DS 2026–27'}</span>
              )}
            </div>
            <p className="text-[11px] text-slate-500 leading-normal">
              Students cannot edit or self-assign division memberships. Contact the academic coordinator or administrator if your division requires review.
            </p>
          </div>}

          {/* Institutional tenant info */}
          <div className="p-3.5 rounded-xl border border-blue-100 bg-blue-50/50 text-xs text-blue-900 space-y-1">
            <div className="font-semibold">Associated Institution</div>
            <div className="text-slate-700">{currentInstitution.name} ({currentInstitution.shortName})</div>
            <div className="text-slate-500 font-mono text-[11px]">
              Authorized College Domain: @{currentInstitution.domain}
            </div>
          </div>

          {/* Manage Student / User Interests */}
          {currentUser.role !== 'faculty' && <div>
            <div className="flex items-center gap-2 mb-2 font-semibold text-slate-800 text-xs">
              <Heart className="w-4 h-4 text-rose-500" />
              <span>Personal Interests (Used for Smart Recommendations)</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {AVAILABLE_INTERESTS.map((interest) => {
                const active = selectedInterests.includes(interest);
                return (
                  <button
                    key={interest}
                    type="button"
                    onClick={() => toggleInterest(interest)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                      active
                        ? 'bg-blue-600 text-white border-blue-600 shadow-2xs'
                        : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    {interest}
                  </button>
                );
              })}
            </div>
          </div>}

          {/* Notification Preferences */}
          {!isFaculty && <div className="pt-2 border-t border-slate-100">
            <div className="flex items-center gap-2 mb-3 font-semibold text-slate-800 text-xs">
              <Bell className="w-4 h-4 text-blue-600" />
              <span>In-App Notification Alerts</span>
            </div>
            <div className="space-y-2.5">
              <label className="flex items-center justify-between text-xs text-slate-700 cursor-pointer">
                <span>Academic & Examination Notices</span>
                <input
                  type="checkbox"
                  checked={prefs.academic}
                  onChange={(e) => setPrefs({ ...prefs, academic: e.target.checked })}
                  className="rounded text-blue-600"
                />
              </label>

              <label className="flex items-center justify-between text-xs text-slate-700 cursor-pointer">
                <span>Events, Hackathons & Cultural Fests</span>
                <input
                  type="checkbox"
                  checked={prefs.events}
                  onChange={(e) => setPrefs({ ...prefs, events: e.target.checked })}
                  className="rounded text-blue-600"
                />
              </label>

              <label className="flex items-center justify-between text-xs text-slate-700 cursor-pointer">
                <span>Upcoming Deadline Reminders</span>
                <input
                  type="checkbox"
                  checked={prefs.deadlines}
                  onChange={(e) => setPrefs({ ...prefs, deadlines: e.target.checked })}
                  className="rounded text-blue-600"
                />
              </label>

              <label className="flex items-center justify-between text-xs text-slate-700 cursor-pointer">
                <span>Clubs & Student Councils</span>
                <input
                  type="checkbox"
                  checked={prefs.clubs}
                  onChange={(e) => setPrefs({ ...prefs, clubs: e.target.checked })}
                  className="rounded text-blue-600"
                />
              </label>
            </div>
          </div>}
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 border-t border-slate-100 bg-slate-50/50 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {onLogout && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onLogout();
                }}
                className="text-xs text-rose-600 hover:text-rose-800 font-semibold flex items-center gap-1.5 py-1.5 px-2.5 rounded-lg hover:bg-rose-50 transition-colors border border-rose-200 cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Sign Out</span>
              </button>
            )}
            {!isFaculty && savedMsg && (
              <span className="text-xs text-emerald-600 font-semibold flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5" />
                Preferences updated!
              </span>
            )}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 border border-slate-200 hover:bg-slate-100 text-slate-700 text-xs font-medium rounded-lg"
            >
              Close
            </button>
            {!isFaculty && <button
              type="button"
              onClick={handleSave}
              disabled={isSaving}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded-lg flex items-center gap-1.5 shadow-sm"
            >
              <Save className="w-3.5 h-3.5" />
              <span>{isSaving ? 'Saving...' : 'Save Preferences'}</span>
            </button>}
          </div>
        </div>
      </div>
    </div>
  );
};
