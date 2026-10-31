import React, { useState } from 'react';
import { AlertCircle, BookOpen, CheckCircle2, ShieldCheck } from 'lucide-react';

interface TermsAndConditionsProps {
  onAccept: () => Promise<void>;
  onDecline: () => Promise<void>;
}

export const TermsAndConditions: React.FC<TermsAndConditionsProps> = ({ onAccept, onDecline }) => {
  const [isAccepted, setIsAccepted] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleAccept = async () => {
    setErrorMessage(null);
    setIsLoading(true);
    try {
      await onAccept();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Unable to save your acceptance. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/40 to-slate-100 flex items-center justify-center px-4 py-8">
      <section className="w-full max-w-3xl overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-xl shadow-slate-200/50">
        <header className="flex items-start gap-4 border-b border-slate-200 px-6 py-5 sm:px-8">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-blue-100 text-blue-700">
            <ShieldCheck className="h-6 w-6" />
          </div>
          <div>
            <p className="mb-1 text-xs font-bold uppercase tracking-wider text-blue-700">Welcome to MyCollege</p>
            <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">Terms and Conditions</h1>
            <p className="mt-1 text-sm text-slate-600">Please review and accept before setting up your account.</p>
          </div>
        </header>

        <div className="max-h-[55vh] space-y-5 overflow-y-auto px-6 py-6 text-sm leading-6 text-slate-700 sm:px-8">
          <p>
            These terms explain the expectations for using MyCollege, a platform for college
            announcements, academic communication, events, and community features. By selecting
            “I agree,” you confirm that you have read and accepted them.
          </p>

          <section>
            <h2 className="mb-1 flex items-center gap-2 font-bold text-slate-900">
              <BookOpen className="h-4 w-4 text-blue-600" /> 1. Account and eligibility
            </h2>
            <p>
              Access is for authorized students, faculty, and college representatives. Keep your
              sign-in details private, provide accurate profile information, and notify the
              college if you believe your account has been used without permission.
            </p>
          </section>

          <section>
            <h2 className="mb-1 font-bold text-slate-900">2. Respectful and lawful use</h2>
            <p>
              Use the platform for its intended college and community purposes. Do not harass,
              threaten, impersonate, spam, disrupt services, or post unlawful, misleading, or
              harmful material. Follow college policies and applicable law in all interactions.
            </p>
          </section>

          <section>
            <h2 className="mb-1 font-bold text-slate-900">3. Content and academic integrity</h2>
            <p>
              You are responsible for content you submit and must have permission to share it.
              Respect privacy, intellectual-property rights, examination rules, and academic
              integrity requirements. Do not upload confidential records or another person’s
              personal information without authorization.
            </p>
          </section>

          <section>
            <h2 className="mb-1 font-bold text-slate-900">4. Privacy and platform information</h2>
            <p>
              MyCollege uses account and activity information to provide and protect its features.
              Information may be visible to relevant college administrators when needed to operate
              the service, address misuse, or meet legal obligations. Do not treat private messages
              or platform content as a substitute for an official or confidential channel.
            </p>
          </section>

          <section>
            <h2 className="mb-1 font-bold text-slate-900">5. Availability and changes</h2>
            <p>
              Features may change or be temporarily unavailable for maintenance, safety, or
              operational reasons. The college may restrict access when these terms or college
              policies are violated. Updated terms will be presented in the platform when
              applicable.
            </p>
          </section>

          <section>
            <h2 className="mb-1 font-bold text-slate-900">6. Questions</h2>
            <p>
              For questions about access or these terms, contact your college administrator through
              the official college support channels.
            </p>
          </section>

          <p className="border-t border-slate-200 pt-4 text-xs text-slate-500">Last updated: October 2026</p>
        </div>

        <footer className="border-t border-slate-200 bg-slate-50 px-6 py-5 sm:px-8">
          {errorMessage && (
            <div role="alert" className="mb-4 flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}
          <label className="mb-5 flex cursor-pointer items-start gap-3 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={isAccepted}
              onChange={(event) => setIsAccepted(event.target.checked)}
              className="mt-1 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
            />
            <span>I have read and agree to the MyCollege Terms and Conditions.</span>
          </label>
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={onDecline}
              disabled={isLoading}
              className="rounded-xl border border-slate-300 px-5 py-2.5 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Decline and sign out
            </button>
            <button
              type="button"
              onClick={handleAccept}
              disabled={!isAccepted || isLoading}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-700 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <CheckCircle2 className="h-4 w-4" />
              {isLoading ? 'Saving...' : 'I agree and continue'}
            </button>
          </div>
          <p className="mt-4 text-center text-xs text-slate-500">Your acceptance is saved to your account.</p>
        </footer>
      </section>
    </main>
  );
};