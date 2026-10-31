import React, { useState, useEffect } from 'react';
import {
  UserCheck,
  CheckCircle2,
  AlertCircle,
  Sparkles,
  Shield,
  Layers,
  ArrowRight,
  School,
  Lock,
} from 'lucide-react';
import { api } from '../services/api';
import type { Division, User } from '../types';

interface ProfileSetupViewProps {
  currentUser: User;
  divisions: Division[];
  onProfileCompleted: (updatedUser: User) => void;
  onToast: (message: string, type?: 'success' | 'error' | 'info') => void;
}

const INTEREST_TAGS = [
  'Artificial Intelligence',
  'Deep Learning',
  'Machine Learning',
  'Computer Vision',
  'Natural Language Processing',
  'Robotics',
  'Competitive Coding',
  'Hackathons',
  'Internships',
  'Cloud Architecture',
  'Sports',
  'Technical Events',
  'Research',
];

export const ProfileSetupView: React.FC<ProfileSetupViewProps> = ({
  currentUser,
  divisions,
  onProfileCompleted,
  onToast,
}) => {
  const [name, setName] = useState(currentUser.name || '');
  const [username, setUsername] = useState(
    currentUser.username ||
      currentUser.email
        .split('@')[0]
        .replace(/\./g, '_')
        .toLowerCase()
  );

  const [selectedInterests, setSelectedInterests] = useState<string[]>(
    currentUser.role === 'faculty'
      ? []
      : currentUser.interests || ['Artificial Intelligence', 'Academics']
  );

  // Live username validation state
  const [usernameStatus, setUsernameStatus] = useState<{
    checking: boolean;
    available?: boolean;
    message?: string;
  }>({ checking: false });

  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Debounced username check
  useEffect(() => {
    const clean = username.trim().toLowerCase();
    if (!clean || clean.length < 3) {
      setUsernameStatus({ checking: false, available: false, message: 'Minimum 3 characters' });
      return;
    }

    if (!/^[a-zA-Z0-9_]+$/.test(clean)) {
      setUsernameStatus({
        checking: false,
        available: false,
        message: 'Only letters, numbers, and underscores allowed',
      });
      return;
    }

    setUsernameStatus({ checking: true });
    const timer = setTimeout(async () => {
      try {
        const res = await api.checkUsername(clean);
        setUsernameStatus({ checking: false, available: res.available, message: res.message });
      } catch (err: any) {
        setUsernameStatus({ checking: false, available: false, message: err.message || 'Error checking username' });
      }
    }, 400);

    return () => clearTimeout(timer);
  }, [username]);

  const toggleInterest = (tag: string) => {
    setSelectedInterests((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    const cleanName = name.trim();
    const cleanUsername = username.trim().toLowerCase();

    if (!cleanName || cleanName.length < 2) {
      setErrorMessage('Please enter your full name.');
      return;
    }

    if (!cleanUsername || cleanUsername.length < 3) {
      setErrorMessage('Please choose a username of at least 3 characters.');
      return;
    }

    if (!usernameStatus.available) {
      setErrorMessage(usernameStatus.message || 'Please choose an available username.');
      return;
    }

    try {
      setIsLoading(true);
      const res = await api.completeProfile({
        name: cleanName,
        username: cleanUsername,
        interests: selectedInterests,
      });

      onToast('Profile setup complete! Welcome to MyCollege.', 'success');
      onProfileCompleted(res.user);
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to complete profile setup.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/40 to-slate-100 flex flex-col justify-center items-center px-4 py-8 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md text-center mb-6">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-tr from-blue-700 to-indigo-600 text-white shadow-lg shadow-blue-500/25 mb-3">
          <UserCheck className="w-7 h-7" />
        </div>
        <div className="flex items-center justify-center gap-2 mb-1">
          <span className="text-xs font-bold uppercase tracking-wider text-blue-700 bg-blue-100/80 px-2.5 py-0.5 rounded-full border border-blue-200">
            First-Time Setup
          </span>
        </div>
        <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
          Complete Your {currentUser.role === 'faculty' ? 'Faculty' : 'Student'} Profile
        </h1>
        <p className="text-xs sm:text-sm text-slate-600 mt-1">
          Set up your identity for the college community
        </p>
      </div>

      <div className="w-full max-w-lg bg-white rounded-3xl shadow-xl shadow-slate-200/50 border border-slate-200 p-6 sm:p-8 backdrop-blur-sm">
        {errorMessage && (
          <div className="mb-5 p-3.5 rounded-2xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-start gap-2.5 animate-in fade-in duration-150">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
            <div className="leading-relaxed font-medium">{errorMessage}</div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Read-Only Verified Division & Identity Card */}
          {currentUser.role !== 'faculty' && (
            <div className="p-4 rounded-2xl bg-blue-50/80 border border-blue-200 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-blue-900 uppercase tracking-wider flex items-center gap-1.5">
                <Shield className="w-3.5 h-3.5 text-blue-600" />
                <span>Verified Division Allocation</span>
              </span>
              <span className="text-[10px] text-blue-700 font-semibold bg-white px-2 py-0.5 rounded-full border border-blue-200">
                Institutional Data
              </span>
            </div>

            <div className="space-y-1">
              {divisions.length > 0 ? (
                divisions.map((div) => (
                  <div
                    key={div.id}
                    className="flex items-center gap-2 bg-white px-3 py-2 rounded-xl border border-blue-200 text-xs font-bold text-slate-900 shadow-2xs"
                  >
                    <Layers className="w-4 h-4 text-blue-600 shrink-0" />
                    <span>{div.name}</span>
                  </div>
                ))
              ) : (
                <div className="flex items-center gap-2 bg-white px-3 py-2 rounded-xl border border-blue-200 text-xs font-bold text-slate-900">
                  <Layers className="w-4 h-4 text-blue-600 shrink-0" />
                  <span>{currentUser.division || 'SY AI-DS Division'}</span>
                </div>
              )}
            </div>

            <p className="text-[11px] text-blue-900/80 leading-relaxed flex items-center gap-1">
              <Lock className="w-3 h-3 shrink-0 text-blue-600" />
              <span>
                Division assignment is verified from the approved student roster and cannot be manually modified.
              </span>
            </p>
          </div>
          )}

          {/* Full Name */}
          <div>
            <label
              htmlFor="student-fullname"
              className="block text-xs font-bold text-slate-800 mb-1.5 uppercase tracking-wide"
            >
              Full Name
            </label>
            <input
              id="student-fullname"
              type="text"
              required
              readOnly={currentUser.role === 'faculty'}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={currentUser.role === 'faculty' ? 'Verified faculty name' : 'Enter your full name'}
              className={`w-full px-4 py-2.5 text-xs sm:text-sm text-slate-900 border border-slate-200 rounded-xl outline-none transition-all ${
                currentUser.role === 'faculty'
                  ? 'bg-slate-100 cursor-not-allowed'
                  : 'bg-slate-50 focus:bg-white focus:border-blue-600 focus:ring-2 focus:ring-blue-100'
              }`}
            />
            {currentUser.role === 'faculty' && (
              <p className="text-[11px] text-slate-500 mt-1">
                Your name is verified from the faculty details and cannot be edited here.
              </p>
            )}
          </div>

          {/* Unique Username */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label
                htmlFor="student-username"
                className="block text-xs font-bold text-slate-800 uppercase tracking-wide"
              >
                Unique Username
              </label>
              <div className="text-[11px]">
                {usernameStatus.checking ? (
                  <span className="text-slate-400">Checking availability...</span>
                ) : usernameStatus.available ? (
                  <span className="text-emerald-600 font-semibold flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3" />
                    Available
                  </span>
                ) : (
                  <span className="text-rose-600 font-semibold">{usernameStatus.message}</span>
                )}
              </div>
            </div>

            <div className="relative">
              <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400 font-mono text-sm">
                @
              </span>
              <input
                id="student-username"
                type="text"
                required
                value={username}
                onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                placeholder="prathmesh_dhore"
                className={`w-full pl-8 pr-4 py-2.5 font-mono text-xs sm:text-sm text-slate-900 border rounded-xl outline-none transition-all focus:ring-2 ${
                  usernameStatus.available
                    ? 'border-emerald-500 bg-emerald-50/20 focus:ring-emerald-100'
                    : usernameStatus.message
                    ? 'border-rose-400 bg-rose-50/20 focus:ring-rose-100'
                    : 'border-slate-200 bg-slate-50 focus:border-blue-600 focus:ring-blue-100'
                }`}
              />
            </div>
            <p className="text-[11px] text-slate-500 mt-1">
              Letters, numbers, and underscores only. Used for group mentions & notices.
            </p>
          </div>

          {/* Primary Academic Interests */}
          {currentUser.role !== 'faculty' && <div>
            <label className="block text-xs font-bold text-slate-800 mb-1.5 uppercase tracking-wide">
              Select Your Interests (Optional)
            </label>
            <div className="flex flex-wrap gap-1.5 max-h-36 overflow-y-auto p-1">
              {INTEREST_TAGS.map((tag) => {
                const isSelected = selectedInterests.includes(tag);
                return (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => toggleInterest(tag)}
                    className={`px-2.5 py-1 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-blue-600 text-white shadow-2xs'
                        : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                    }`}
                  >
                    {tag}
                  </button>
                );
                })}
            </div>
          </div>}

          {/* Submit Button */}
          <button
            type="submit"
            disabled={isLoading || !name.trim() || !usernameStatus.available}
            className="w-full py-3 px-4 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold text-xs sm:text-sm rounded-xl flex items-center justify-center gap-2 shadow-sm transition-all cursor-pointer mt-6"
          >
            {isLoading ? (
              <>
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                <span>
                  {currentUser.role === 'faculty' ? 'Saving Faculty Profile...' : 'Creating Student Profile...'}
                </span>
              </>
            ) : (
              <>
                <span>Enter Campus Platform</span>
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </form>
      </div>

      <div className="mt-8 text-center text-xs text-slate-400">
        <p>© 2026–27 K. J. Somaiya College of Engineering · AI-DS Department</p>
      </div>
    </div>
  );
};
