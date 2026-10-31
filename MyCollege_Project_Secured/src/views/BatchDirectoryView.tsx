import React, { useEffect, useState } from 'react';
import { ArrowLeft, Building2, GraduationCap, Plus, Users } from 'lucide-react';
import type { Department, Institution, User } from '../types';
import { api } from '../services/api';

interface BatchDirectoryViewProps {
  currentUser: User;
  currentInstitution: Institution;
  departments: Department[];
  onBack?: () => void;
}

export const BatchDirectoryView: React.FC<BatchDirectoryViewProps> = ({
  currentUser,
  currentInstitution,
  departments,
  onBack,
}) => {
  const [studentCount, setStudentCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedDept, setSelectedDept] = useState('dept-aids');
  const [selectedDivision, setSelectedDivision] = useState(() => {
    if (currentUser.role !== 'student') return 'Div A';
    const divisionIds = currentUser.divisionIds ?? [];
    if (divisionIds.length > 1) return 'all';
    if (divisionIds.includes('sy-aids-a') || currentUser.division === 'Div A') return 'Div A';
    if (divisionIds.includes('sy-aids-b') || currentUser.division === 'Div B') return 'Div B';
    return 'all';
  });
  const [selectedYear, setSelectedYear] = useState(() => {
    if (currentUser.role !== 'student') return '3rd Year';
    if (currentUser.year === 'Second Year') return '2nd Year';
    return ['2nd Year', '3rd Year', '4th Year'].includes(currentUser.year ?? '')
      ? currentUser.year ?? 'all'
      : 'all';
  });
  const [studentName, setStudentName] = useState('');
  const [studentEmail, setStudentEmail] = useState('');
  const [studentPhone, setStudentPhone] = useState('');
  const [studentRollNo, setStudentRollNo] = useState('');
  const [studentDepartmentId, setStudentDepartmentId] = useState('dept-aids');
  const [studentYear, setStudentYear] = useState('3rd Year');
  const [studentDivision, setStudentDivision] = useState('Div A');
  const [isAddingStudent, setIsAddingStudent] = useState(false);
  const [addStudentError, setAddStudentError] = useState<string | null>(null);
  const [addStudentSuccess, setAddStudentSuccess] = useState<string | null>(null);

  useEffect(() => {
    const loadDirectorySummary = async () => {
      try {
        setIsLoading(true);
        const result = await api.getBatchDirectory({
          institutionId: currentInstitution.id,
          departmentId: selectedDept === 'all' ? undefined : selectedDept,
          division: selectedDivision === 'all' ? undefined : selectedDivision,
          year: selectedYear === 'all' ? undefined : selectedYear,
        });
        setStudentCount(result.total);
        setLoadError(null);
      } catch (err) {
        console.error('Failed to load batch directory summary:', err);
        setLoadError('Unable to load the batch summary. Please try again.');
      } finally {
        setIsLoading(false);
      }
    };

    const handleRealtime = (event: Event) => {
      const { detail } = event as CustomEvent<{ type: string }>;
      if (detail?.type === 'directory:changed') void loadDirectorySummary();
    };

    void loadDirectorySummary();
    window.addEventListener('mycollege:realtime', handleRealtime);
    return () => window.removeEventListener('mycollege:realtime', handleRealtime);
  }, [currentInstitution.id, selectedDept, selectedDivision, selectedYear]);

  const handleAddStudent = async (event: React.FormEvent) => {
    event.preventDefault();
    setAddStudentError(null);
    setAddStudentSuccess(null);

    try {
      setIsAddingStudent(true);
      const result = await api.addBatchStudent({
        name: studentName,
        email: studentEmail,
        phone: studentPhone,
        rollNo: studentRollNo,
        departmentId: studentDepartmentId,
        year: studentYear,
        division: studentDivision,
      });
      setAddStudentSuccess(result.message);
      setStudentName('');
      setStudentEmail('');
      setStudentPhone('');
      setStudentRollNo('');
      if (selectedDept === 'all' || selectedDept === studentDepartmentId) {
        if (selectedDivision === 'all' || selectedDivision === studentDivision) {
          if (selectedYear === 'all' || selectedYear === studentYear) {
            setStudentCount((count) => count + 1);
          }
        }
      }
    } catch (err) {
      setAddStudentError(err instanceof Error ? err.message : 'Failed to add the student.');
    } finally {
      setIsAddingStudent(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 space-y-6">
      <div className="bg-gradient-to-r from-blue-700 via-indigo-700 to-blue-900 rounded-3xl p-6 sm:p-8 text-white shadow-xl">
        <div className="max-w-3xl space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            {onBack && (
              <button
                type="button"
                onClick={onBack}
                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/20 hover:bg-white/30 text-xs font-semibold text-white border border-white/25 transition-all"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Back</span>
              </button>
            )}
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/15 text-xs font-semibold text-blue-100 border border-white/20">
              <Users className="w-3.5 h-3.5" />
              <span>Batch Overview</span>
            </div>
          </div>

          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
            Batch & Division Overview
          </h1>
          <p className="text-sm text-blue-100/90 leading-relaxed">
            View student totals by department, division, and academic year. Individual student
            records and contact details are not shown here.
          </p>

          <div className="flex flex-wrap items-center gap-4 pt-2 text-xs text-blue-200">
            <div className="flex items-center gap-1.5">
              <Building2 className="w-4 h-4 text-blue-300" />
              <span>{currentInstitution.name}</span>
            </div>
          </div>
        </div>
      </div>

      <section className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 shadow-2xs space-y-5">
        <div className="flex flex-wrap items-center gap-3">
          <select
            value={selectedDept}
            onChange={(e) => setSelectedDept(e.target.value)}
            aria-label="Filter by department"
            className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-700 font-medium focus:border-blue-500 outline-none"
          >
            <option value="dept-aids">AI & Data Science (AIDS)</option>
            <option value="dept-comp">Computer Engineering</option>
            <option value="dept-it">Information Technology</option>
            <option value="all">All Departments</option>
          </select>

          <select
            value={selectedDivision}
            onChange={(e) => setSelectedDivision(e.target.value)}
            aria-label="Filter by division"
            className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-700 font-medium focus:border-blue-500 outline-none"
          >
            <option value="Div A">Division A</option>
            <option value="Div B">Division B</option>
            <option value="all">All Divisions</option>
          </select>

          <select
            value={selectedYear}
            onChange={(e) => setSelectedYear(e.target.value)}
            aria-label="Filter by academic year"
            className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-700 font-medium focus:border-blue-500 outline-none"
          >
            <option value="3rd Year">3rd Year</option>
            <option value="4th Year">4th Year</option>
            <option value="2nd Year">2nd Year</option>
            <option value="all">All Academic Years</option>
          </select>
        </div>

        <div className="rounded-xl bg-slate-50 border border-slate-100 p-8 text-center">
          <GraduationCap className="w-8 h-8 text-blue-600 mx-auto mb-2" />
          {isLoading ? (
            <p className="text-sm text-slate-500">Loading batch summary...</p>
          ) : loadError ? (
            <p className="text-sm text-rose-600">{loadError}</p>
          ) : (
            <>
              <p className="text-3xl font-bold text-slate-900">{studentCount}</p>
              <p className="text-sm text-slate-600 mt-1">students in the selected batch</p>
            </>
          )}
        </div>

        {(currentUser.role === 'faculty' || currentUser.role === 'admin') && (
          <form onSubmit={handleAddStudent} className="space-y-4 border-t border-slate-100 pt-5">
            <div>
              <h2 className="font-semibold text-slate-900 flex items-center gap-2">
                <Plus className="w-4 h-4 text-blue-600" />
                Add student to a batch
              </h2>
              <p className="text-xs text-slate-500 mt-1">
                Creates a student account eligible for email verification. Individual records remain hidden in this directory.
              </p>
            </div>

            {addStudentError && (
              <p role="alert" className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
                {addStudentError}
              </p>
            )}
            {addStudentSuccess && (
              <p role="status" className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
                {addStudentSuccess}
              </p>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              <input
                required
                value={studentName}
                onChange={(event) => setStudentName(event.target.value)}
                placeholder="Student full name"
                aria-label="Student full name"
                className="px-3 py-2 border border-slate-200 rounded-lg text-sm outline-none focus:border-blue-500"
              />
              <input
                required
                type="email"
                value={studentEmail}
                onChange={(event) => setStudentEmail(event.target.value)}
                placeholder="College email address"
                aria-label="College email address"
                className="px-3 py-2 border border-slate-200 rounded-lg text-sm outline-none focus:border-blue-500"
              />
              <input
                type="tel"
                value={studentPhone}
                onChange={(event) => setStudentPhone(event.target.value)}
                placeholder="Phone number (optional)"
                aria-label="Student phone number"
                autoComplete="tel"
                inputMode="tel"
                maxLength={20}
                pattern="[+]?[0-9\s().-]{7,20}"
                title="Enter a valid phone number with at least 7 digits."
                className="px-3 py-2 border border-slate-200 rounded-lg text-sm outline-none focus:border-blue-500"
              />
              <input
                required
                value={studentRollNo}
                onChange={(event) => setStudentRollNo(event.target.value)}
                placeholder="Roll number"
                aria-label="Roll number"
                className="px-3 py-2 border border-slate-200 rounded-lg text-sm outline-none focus:border-blue-500"
              />
              <select
                value={studentDepartmentId}
                onChange={(event) => setStudentDepartmentId(event.target.value)}
                aria-label="Student department"
                className="px-3 py-2 border border-slate-200 rounded-lg text-sm outline-none focus:border-blue-500"
              >
                {departments.map((department) => (
                  <option key={department.id} value={department.id}>{department.name}</option>
                ))}
              </select>
              <select
                value={studentYear}
                onChange={(event) => setStudentYear(event.target.value)}
                aria-label="Student academic year"
                className="px-3 py-2 border border-slate-200 rounded-lg text-sm outline-none focus:border-blue-500"
              >
                <option value="2nd Year">2nd Year</option>
                <option value="3rd Year">3rd Year</option>
                <option value="4th Year">4th Year</option>
              </select>
              <select
                value={studentDivision}
                onChange={(event) => setStudentDivision(event.target.value)}
                aria-label="Student division"
                className="px-3 py-2 border border-slate-200 rounded-lg text-sm outline-none focus:border-blue-500"
              >
                <option value="Div A">Division A</option>
                <option value="Div B">Division B</option>
              </select>
            </div>
            <button
              type="submit"
              disabled={isAddingStudent}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-semibold rounded-lg"
            >
              {isAddingStudent ? 'Adding student...' : 'Add Student'}
            </button>
          </form>
        )}
      </section>
    </div>
  );
};
