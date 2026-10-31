import React, { useState } from 'react';
import {
  X,
  Sparkles,
  CheckCircle2,
  Info,
} from 'lucide-react';
import type { User } from '../types';

interface PreferenceSetupModalProps {
  currentUser: User;
  onClose: () => void;
  onSavePreferences: (ordered: [string, string, string]) => Promise<void>;
}

export const PREFERENCE_OPTIONS = [
  { id: 'Academics', label: 'Academics', desc: 'Timetables, syllabus, exams, journals' },
  { id: 'Sports', label: 'Sports', desc: 'Cricket, football, badminton tournaments' },
  { id: 'Technical Events', label: 'Technical Events', desc: 'Abhiyantriki, tech fests, robotics expos' },
  { id: 'Cultural Events', label: 'Cultural Events', desc: 'Symphony festival, dance, drama, band' },
  { id: 'Hackathons', label: 'Hackathons', desc: '36-hr national hackathons, squads, ideation' },
  { id: 'Internships', label: 'Internships', desc: 'Summer internships, research fellowships' },
  { id: 'Placements', label: 'Placements', desc: 'Tier-1 campus drives, package criteria' },
  { id: 'Workshops', label: 'Workshops', desc: 'Hands-on AI, Cloud, IoT, Web3 seminars' },
  { id: 'College Notices', label: 'College Notices', desc: 'Official administrative & circulars' },
  { id: 'Clubs and Committees', label: 'Clubs and Committees', desc: 'CSI, ACM, Rotaract, Student Council' },
];

export const PreferenceSetupModal: React.FC<PreferenceSetupModalProps> = ({
  currentUser,
  onClose,
  onSavePreferences,
}) => {
  const defaultPrefs = ['Technical Events', 'Sports', 'Academics'];

  const initialPrefs = (currentUser.orderedPreferences || defaultPrefs)
    .filter((pref, index, preferences) =>
      PREFERENCE_OPTIONS.some((option) => option.id === pref) && preferences.indexOf(pref) === index
    )
    .slice(0, 3);
  for (const option of PREFERENCE_OPTIONS) {
    if (initialPrefs.length === 3) break;
    if (!initialPrefs.includes(option.id)) initialPrefs.push(option.id);
  }

  const [selectedPrefs, setSelectedPrefs] = useState<string[]>(initialPrefs);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const handleSave = async () => {
    if (selectedPrefs.length !== 3 || new Set(selectedPrefs).size !== 3) return;
    try {
      setIsSaving(true);
      setSaveError(null);
      await onSavePreferences([selectedPrefs[0], selectedPrefs[1], selectedPrefs[2]]);
      onClose();
    } catch (err) {
      console.error('Failed to save preferences:', err);
      setSaveError(err instanceof Error ? err.message : 'Unable to save preferences. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  const slotLabels = [
    '1st Preference (Highest priority)',
    '2nd Preference',
    '3rd Preference',
  ];
  const isComplete = selectedPrefs.length === 3 && new Set(selectedPrefs).size === 3;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4">
      <div className="relative bg-white w-full max-w-2xl rounded-3xl shadow-2xl border border-slate-200 overflow-hidden my-6 animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="px-6 py-5 border-b border-slate-100 bg-gradient-to-r from-blue-700 via-indigo-700 to-blue-900 text-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/10 backdrop-blur-xs flex items-center justify-center border border-white/20 shrink-0">
              <Sparkles className="w-5 h-5 text-amber-300" />
            </div>
            <div>
              <h3 className="font-bold text-base sm:text-lg">Smart Preference Setup</h3>
              <p className="text-xs text-blue-100">
                Personalize your campus notice priority & notification ranking
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 text-white/70 hover:text-white hover:bg-white/10 rounded-xl transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-6 max-h-[75vh] overflow-y-auto">
          {/* Explanation Banner */}
          <div className="p-3.5 bg-blue-50/80 rounded-2xl border border-blue-100 flex items-start gap-3 text-xs text-blue-900">
            <Info className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
            <p className="leading-relaxed">
              Choose one interest for each numbered position. You can change any position independently; each interest can only be selected once. Announcements matching your first preference are ranked highest. <em>Important official exam and emergency notices will never be hidden.</em>
            </p>
          </div>

          <div className="space-y-2">
            <div className="text-xs font-bold text-slate-500 uppercase tracking-wider">
              Your Three Preferences (In Order)
            </div>
            <div className="space-y-3">
              {[0, 1, 2].map((index) => (
                <label key={index} className="block space-y-1.5">
                  <span className="text-xs font-semibold text-slate-700">{slotLabels[index]}</span>
                  <select
                    aria-label={slotLabels[index]}
                    value={selectedPrefs[index]}
                    onChange={(event) => {
                      const updated = [...selectedPrefs];
                      updated[index] = event.target.value;
                      setSelectedPrefs(updated);
                    }}
                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-sm text-slate-800 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none"
                  >
                    {PREFERENCE_OPTIONS.map((option) => (
                      <option
                        key={option.id}
                        value={option.id}
                        disabled={selectedPrefs.some((pref, selectedIndex) =>
                          selectedIndex !== index && pref === option.id
                        )}
                      >
                        {option.label} — {option.desc}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            {saveError && (
              <p role="alert" className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2">
                {saveError}
              </p>
            )}
          </div>
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-4 border-t border-slate-100 bg-slate-50 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs sm:text-sm font-semibold text-slate-600 hover:text-slate-800 rounded-xl transition-colors"
          >
            Cancel
          </button>

          <button
            type="button"
            onClick={handleSave}
            disabled={!isComplete || isSaving}
            className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold text-xs sm:text-sm rounded-xl transition-colors shadow-2xs flex items-center gap-2 cursor-pointer"
          >
            {isSaving ? (
              <span>Saving...</span>
            ) : (
              <>
                <CheckCircle2 className="w-4 h-4" />
                <span>Save Smart Preferences</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
