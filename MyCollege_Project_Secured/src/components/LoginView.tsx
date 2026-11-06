import React, { useState, useEffect } from 'react';
import {
  Mail,
  ArrowRight,
  KeyRound,
  RotateCcw,
  CheckCircle2,
  AlertCircle,
  School,
  Lock,
  ArrowLeft,
  Info,
  Eye,
  EyeOff,
  ShieldCheck,
} from 'lucide-react';
import { api } from '../services/api';
import type { Division, User } from '../types';

interface LoginViewProps {
  onLoginSuccess: (user: User, isFirstTime: boolean, divisions: Division[]) => void;
  onToast: (message: string, type?: 'success' | 'error' | 'info') => void;
}

type AuthStep = 'email' | 'password' | 'otp' | 'set_password';

export const LoginView: React.FC<LoginViewProps> = ({ onLoginSuccess, onToast }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [code, setCode] = useState('');
  const [step, setStep] = useState<AuthStep>('email');

  // Active verified session data waiting for password setup
  const [verifiedSession, setVerifiedSession] = useState<{
    user: User;
    token?: string;
    isFirstTime: boolean;
    divisions: Division[];
  } | null>(null);

  // Loading and error states
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [deliveryNote, setDeliveryNote] = useState<string | null>(null);

  // Countdown timer for 5-minute expiry
  const [timeLeft, setTimeLeft] = useState<number>(300);
  const [resendCooldown, setResendCooldown] = useState<number>(0);

  // Timer tick effect
  useEffect(() => {
    let timer: any = null;
    if (step === 'otp' && timeLeft > 0) {
      timer = setInterval(() => {
        setTimeLeft((prev) => Math.max(0, prev - 1));
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [step, timeLeft]);

  // Resend cooldown timer
  useEffect(() => {
    let timer: any = null;
    if (resendCooldown > 0) {
      timer = setInterval(() => {
        setResendCooldown((prev) => Math.max(0, prev - 1));
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [resendCooldown]);

  const formatTimer = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  // Step 1: Check Auth Method and route to Password or OTP
  const handleCheckAuthMethod = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const cleanEmail = email.trim().toLowerCase();
    setErrorMessage(null);

    if (!cleanEmail) {
      setErrorMessage('Please enter your college email address.');
      return;
    }

    try {
      setIsLoading(true);
      const authInfo = await api.checkAuthMethod(cleanEmail);
      setEmail(cleanEmail);

      if (authInfo.hasPassword) {
        // User already has a password -> prompt password login
        setStep('password');
        setPassword('');
      } else {
        // User has not set a password yet -> send OTP for initial verification
        await triggerSendOtp(cleanEmail);
      }
    } catch (err: any) {
      setErrorMessage(
        err.message || 'We could not verify your email address. Please check and try again.'
      );
    } finally {
      setIsLoading(false);
    }
  };

  // Send single-use OTP
  const triggerSendOtp = async (targetEmail: string) => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const res = await api.requestOtp(targetEmail);
      setStep('otp');
      setCode('');
      setTimeLeft(res.expiresInSeconds || 300);
      setResendCooldown(45);
      setDeliveryNote(res.deliveryNote);
      onToast('Verification code sent to your inbox.', 'success');
    } catch (err: any) {
      setErrorMessage(
        err.message || 'We could not send a verification code. Please try again or contact the administrator.'
      );
    } finally {
      setIsLoading(false);
    }
  };

  // Step 2: Sign In with Password
  const handleLoginWithPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (!password) {
      setErrorMessage('Please enter your account password.');
      return;
    }

    try {
      setIsLoading(true);
      const res = await api.loginWithPassword(email, password);
      onToast(`Welcome back, ${res.user.name}!`, 'success');
      onLoginSuccess(res.user, res.isFirstTime, res.divisions);
    } catch (err: any) {
      setErrorMessage(
        err.message || 'Incorrect password. Click "Forgot password" below to sign in with OTP.'
      );
    } finally {
      setIsLoading(false);
    }
  };

  // Step 3: Verify OTP
  const handleVerifyOtp = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setErrorMessage(null);

    const cleanCode = code.trim();
    if (!cleanCode) {
      setErrorMessage('Please enter the 6-digit verification code.');
      return;
    }

    if (cleanCode.length !== 6 || !/^\d{6}$/.test(cleanCode)) {
      setErrorMessage('Verification code must be exactly 6 numeric digits.');
      return;
    }

    if (timeLeft <= 0) {
      setErrorMessage('Verification code has expired. Please request a new code.');
      return;
    }

    try {
      setIsLoading(true);
      const res = await api.verifyOtp(email, cleanCode);
      setVerifiedSession(res);

      if (res.requiresPasswordSetup) {
        // Transition to Set Password page so user can login with password next time
        setStep('set_password');
        setPassword('');
        setConfirmPassword('');
      } else {
        onToast(`Welcome, ${res.user.name}!`, 'success');
        onLoginSuccess(res.user, res.isFirstTime, res.divisions);
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Invalid or expired verification code.');
    } finally {
      setIsLoading(false);
    }
  };

  // Step 4: Save new password
  const handleSavePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (password.length < 6) {
      setErrorMessage('Password must be at least 6 characters long.');
      return;
    }

    if (password !== confirmPassword) {
      setErrorMessage('Passwords do not match. Please re-enter your new password.');
      return;
    }

    try {
      setIsLoading(true);
      await api.setPassword({
        email,
        password,
        token: verifiedSession?.token,
      });
      onToast('Password saved successfully! You can sign in with your password anytime.', 'success');

      if (verifiedSession) {
        onLoginSuccess(verifiedSession.user, verifiedSession.isFirstTime, verifiedSession.divisions);
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Could not save password. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSkipPassword = () => {
    if (verifiedSession) {
      onToast(`Welcome, ${verifiedSession.user.name}! You can set a password later in your Profile.`, 'info');
      onLoginSuccess(verifiedSession.user, verifiedSession.isFirstTime, verifiedSession.divisions);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/40 to-slate-100 flex flex-col justify-center items-center px-4 py-8 sm:px-6 lg:px-8">
      {/* College Identity & Logo */}
      <div className="sm:mx-auto sm:w-full sm:max-w-md text-center mb-6">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-tr from-blue-700 to-indigo-600 text-white shadow-lg shadow-blue-500/25 mb-3">
          <School className="w-7 h-7" />
        </div>
        <div className="flex items-center justify-center gap-2 mb-1">
          <span className="text-xs font-bold uppercase tracking-wider text-blue-700 bg-blue-100/80 px-2.5 py-0.5 rounded-full border border-blue-200">
            K. J. Somaiya Institute of Technology
          </span>
        </div>
        <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
          Welcome to Your College Community
        </h1>
        <p className="text-xs sm:text-sm text-slate-600 mt-1">
          {step === 'password'
            ? 'Sign in securely with your account password'
            : step === 'set_password'
            ? 'Create a password for fast future sign-ins'
            : 'Sign in using your authorized college or faculty email'}
        </p>
      </div>

      {/* Main Card */}
      <div className="w-full max-w-md bg-white rounded-3xl shadow-xl shadow-slate-200/50 border border-slate-200 p-6 sm:p-8 relative overflow-hidden backdrop-blur-sm">
        {/* Subtle decorative gradient pill */}
        <div className="absolute -top-16 -right-16 w-32 h-32 bg-blue-100/60 rounded-full blur-2xl pointer-events-none" />

        {/* Error Notification Alert */}
        {errorMessage && (
          <div className="mb-5 p-3.5 rounded-2xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-start gap-2.5 animate-in fade-in duration-150">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
            <div className="leading-relaxed font-medium">{errorMessage}</div>
          </div>
        )}

        {/* STEP 1: ENTER EMAIL */}
        {step === 'email' && (
          <form onSubmit={handleCheckAuthMethod} className="space-y-4">
            <div>
              <label
                htmlFor="student-email"
                className="block text-xs font-bold text-slate-800 mb-1.5 uppercase tracking-wide"
              >
                College or Faculty Email Address
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                  <Mail className="w-4 h-4" />
                </div>
                <input
                  id="student-email"
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name.surname@somaiya.edu"
                  className="w-full pl-10 pr-4 py-2.5 bg-slate-50 focus:bg-white text-xs sm:text-sm text-slate-900 border border-slate-200 focus:border-blue-600 rounded-xl outline-none transition-all focus:ring-2 focus:ring-blue-100"
                />
              </div>
              <p className="text-[11px] text-slate-500 mt-1.5 flex items-center gap-1">
                <Lock className="w-3 h-3 text-slate-400" />
                <span>Sign in with password or single-use OTP verification.</span>
              </p>
            </div>

            <button
              type="submit"
              disabled={isLoading || !email.trim()}
              className="w-full py-2.5 px-4 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold text-xs sm:text-sm rounded-xl flex items-center justify-center gap-2 shadow-sm transition-all cursor-pointer"
            >
              {isLoading ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  <span>Checking account...</span>
                </>
              ) : (
                <>
                  <span>Continue</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>
        )}

        {/* STEP 2: PASSWORD SIGN-IN */}
        {step === 'password' && (
          <form onSubmit={handleLoginWithPassword} className="space-y-4">
            <div className="flex items-center justify-between pb-1 border-b border-slate-100">
              <button
                type="button"
                onClick={() => {
                  setStep('email');
                  setErrorMessage(null);
                  setPassword('');
                }}
                className="text-xs text-slate-500 hover:text-slate-800 flex items-center gap-1 cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Change Email</span>
              </button>
              <span className="text-[11px] font-mono text-slate-400 truncate max-w-[200px]">
                {email}
              </span>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label
                  htmlFor="login-password"
                  className="block text-xs font-bold text-slate-800 uppercase tracking-wide"
                >
                  Password
                </label>
              </div>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                  <Lock className="w-4 h-4" />
                </div>
                <input
                  id="login-password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  autoFocus
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  className="w-full pl-10 pr-10 py-2.5 bg-slate-50 focus:bg-white text-xs sm:text-sm text-slate-900 border border-slate-200 focus:border-blue-600 rounded-xl outline-none transition-all focus:ring-2 focus:ring-blue-100"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600 cursor-pointer"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={isLoading || !password.trim()}
              className="w-full py-2.5 px-4 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold text-xs sm:text-sm rounded-xl flex items-center justify-center gap-2 shadow-sm transition-all cursor-pointer"
            >
              {isLoading ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  <span>Signing In...</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Sign In</span>
                </>
              )}
            </button>

            {/* Forgot password / OTP fallback button */}
            <div className="pt-2 text-center border-t border-slate-100">
              <button
                type="button"
                disabled={isLoading}
                onClick={() => triggerSendOtp(email)}
                className="text-xs text-blue-600 hover:text-blue-800 font-semibold inline-flex items-center gap-1.5 cursor-pointer py-1"
              >
                <KeyRound className="w-3.5 h-3.5" />
                <span>Forgot password? Sign in with OTP</span>
              </button>
            </div>
          </form>
        )}

        {/* STEP 3: OTP VERIFICATION */}
        {step === 'otp' && (
          <form onSubmit={handleVerifyOtp} className="space-y-4">
            <div className="flex items-center justify-between pb-1 border-b border-slate-100">
              <button
                type="button"
                onClick={() => {
                  setStep('email');
                  setErrorMessage(null);
                  setCode('');
                }}
                className="text-xs text-slate-500 hover:text-slate-800 flex items-center gap-1 cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Change Email</span>
              </button>
              <span className="text-[11px] font-mono text-slate-400 truncate max-w-[200px]">
                {email}
              </span>
            </div>

            {/* Delivery Transparency Banner */}
            {deliveryNote && (
              <div className="p-3 rounded-2xl bg-blue-50/90 border border-blue-200 text-blue-900 text-xs space-y-1.5">
                <div className="flex items-center gap-1.5 font-bold text-blue-800">
                  <Info className="w-4 h-4 text-blue-600 shrink-0" />
                  <span>Check Your Email</span>
                </div>
                <p className="text-[11px] text-blue-900/80 leading-relaxed">{deliveryNote}</p>
              </div>
            )}

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label
                  htmlFor="otp-code"
                  className="block text-xs font-bold text-slate-800 uppercase tracking-wide"
                >
                  Enter 6-Digit Code
                </label>
                <span
                  className={`text-xs font-mono font-bold ${
                    timeLeft < 60 ? 'text-rose-600 animate-pulse' : 'text-slate-600'
                  }`}
                >
                  ⏱️ {formatTimer(timeLeft)}
                </span>
              </div>

              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                  <KeyRound className="w-4 h-4" />
                </div>
                <input
                  id="otp-code"
                  type="text"
                  required
                  maxLength={6}
                  autoFocus
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                  placeholder="123456"
                  className="w-full pl-10 pr-4 py-2.5 text-center tracking-[8px] font-mono text-lg font-bold bg-slate-50 focus:bg-white text-slate-900 border border-slate-200 focus:border-blue-600 rounded-xl outline-none transition-all focus:ring-2 focus:ring-blue-100"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={isLoading || code.trim().length !== 6 || timeLeft <= 0}
              className="w-full py-2.5 px-4 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold text-xs sm:text-sm rounded-xl flex items-center justify-center gap-2 shadow-sm transition-all cursor-pointer"
            >
              {isLoading ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  <span>Verifying Code...</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Verify and Continue</span>
                </>
              )}
            </button>

            {/* Resend Option */}
            <div className="text-center pt-2">
              <button
                type="button"
                disabled={resendCooldown > 0 || isLoading}
                onClick={() => triggerSendOtp(email)}
                className="text-xs text-blue-600 hover:text-blue-800 disabled:text-slate-400 font-semibold inline-flex items-center gap-1 cursor-pointer disabled:cursor-not-allowed"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>
                  {resendCooldown > 0
                    ? `Resend code in ${resendCooldown}s`
                    : 'Resend Verification Code'}
                </span>
              </button>
            </div>
          </form>
        )}

        {/* STEP 4: CREATE PASSWORD */}
        {step === 'set_password' && (
          <form onSubmit={handleSavePassword} className="space-y-4">
            <div className="p-3 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs flex items-start gap-2.5">
              <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
              <div>
                <p className="font-bold">Set Your Account Password</p>
                <p className="text-[11px] text-emerald-800 mt-0.5">
                  Set a password so you can sign in directly with your password next time without needing an OTP.
                </p>
              </div>
            </div>

            <div>
              <label
                htmlFor="new-password"
                className="block text-xs font-bold text-slate-800 mb-1.5 uppercase tracking-wide"
              >
                New Password (minimum 6 characters)
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                  <Lock className="w-4 h-4" />
                </div>
                <input
                  id="new-password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  autoFocus
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter a secure password"
                  className="w-full pl-10 pr-10 py-2.5 bg-slate-50 focus:bg-white text-xs sm:text-sm text-slate-900 border border-slate-200 focus:border-blue-600 rounded-xl outline-none transition-all focus:ring-2 focus:ring-blue-100"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600 cursor-pointer"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div>
              <label
                htmlFor="confirm-password"
                className="block text-xs font-bold text-slate-800 mb-1.5 uppercase tracking-wide"
              >
                Confirm Password
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                  <Lock className="w-4 h-4" />
                </div>
                <input
                  id="confirm-password"
                  type={showConfirmPassword ? 'text' : 'password'}
                  required
                  minLength={6}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Re-enter password to confirm"
                  className="w-full pl-10 pr-10 py-2.5 bg-slate-50 focus:bg-white text-xs sm:text-sm text-slate-900 border border-slate-200 focus:border-blue-600 rounded-xl outline-none transition-all focus:ring-2 focus:ring-blue-100"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600 cursor-pointer"
                  tabIndex={-1}
                >
                  {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={isLoading || password.length < 6 || password !== confirmPassword}
              className="w-full py-2.5 px-4 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold text-xs sm:text-sm rounded-xl flex items-center justify-center gap-2 shadow-sm transition-all cursor-pointer"
            >
              {isLoading ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  <span>Saving Password...</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Save Password & Sign In</span>
                </>
              )}
            </button>

            <div className="text-center pt-1">
              <button
                type="button"
                onClick={handleSkipPassword}
                className="text-xs text-slate-400 hover:text-slate-600 underline cursor-pointer"
              >
                Skip for now (you can set it in Profile later)
              </button>
            </div>
          </form>
        )}
      </div>

      {/* College Footer & Security Note */}
      <div className="mt-8 text-center text-xs text-slate-400 space-y-1">
        <p>Protected by Somaiya Institution Access Control & Multi-Factor Authentication.</p>
        <p>© 2026–27 K. J. Somaiya Institute of Technology</p>
      </div>
    </div>
  );
};
