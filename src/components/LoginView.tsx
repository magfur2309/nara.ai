import React, { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Bell,
  Calendar,
  CheckCircle2,
  Eye,
  EyeOff,
  FileText,
  Headphones,
  Loader2,
  Lock,
  TrendingUp,
  User,
  X,
} from 'lucide-react';
import loginToscaSphereUrl from '../assets/images/login_tosca_sphere_1795489053795.jpg';
import {
  DEFAULT_ROLE_ACCOUNTS,
  formatAuthError,
  requestPasswordReset,
} from '../lib/firebase';
import { LanguageSwitcher, useI18n } from '../lib/i18n';
import { ThemeToggleButton } from '../lib/theme';
import { BrandLogo } from './BrandLogo';

const DEFAULT_SUPER_ADMIN = DEFAULT_ROLE_ACCOUNTS.find((acc) => acc.id === 'superuser');
const REMEMBER_STORAGE_KEY = 'nara-ai-remember-identifier';

interface LoginViewProps {
  onSignIn: (identifier: string, password: string, rememberMe?: boolean) => Promise<void>;
  loading: boolean;
  error: string | null;
  isProviderDisabled?: boolean;
}

export const LoginView: React.FC<LoginViewProps> = ({
  onSignIn,
  loading,
  error,
  isProviderDisabled = false,
}) => {
  const { t } = useI18n();

  const [identifier, setIdentifier] = useState<string>(() => {
    try {
      const saved = localStorage.getItem(REMEMBER_STORAGE_KEY);
      if (saved) return saved;
    } catch {
      // Abaikan bila penyimpanan browser tidak tersedia
    }
    return DEFAULT_SUPER_ADMIN?.username ?? '';
  });

  const [password, setPassword] = useState<string>(() => {
    try {
      const saved = localStorage.getItem(REMEMBER_STORAGE_KEY);
      if (saved && saved !== DEFAULT_SUPER_ADMIN?.username) return '';
    } catch {
      // Abaikan bila penyimpanan browser tidak tersedia
    }
    return DEFAULT_SUPER_ADMIN?.password ?? '';
  });

  const [rememberMe, setRememberMe] = useState<boolean>(true);
  const [showPassword, setShowPassword] = useState<boolean>(false);
  const [fieldErrors, setFieldErrors] = useState<{ identifier?: string; password?: string }>({});
  const [backdropFailed, setBackdropFailed] = useState<boolean>(false);

  // Modal state: Lupa Kata Sandi & Pusat Bantuan
  const [forgotOpen, setForgotOpen] = useState<boolean>(false);
  const [forgotIdentifier, setForgotIdentifier] = useState<string>('');
  const [forgotLoading, setForgotLoading] = useState<boolean>(false);
  const [forgotError, setForgotError] = useState<string | null>(null);
  const [forgotResult, setForgotResult] = useState<{
    mode: 'sent' | 'internal_account';
    email: string;
  } | null>(null);
  const [helpOpen, setHelpOpen] = useState<boolean>(false);

  const identifierInputRef = useRef<HTMLInputElement | null>(null);
  const passwordInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      identifierInputRef.current?.focus();
    }, 60);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!forgotOpen && !helpOpen) return;
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        setForgotOpen(false);
        setHelpOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [forgotOpen, helpOpen]);

  const validateFields = (nextId: string, nextPw: string) => {
    const errs: { identifier?: string; password?: string } = {};
    const trimmedId = nextId.trim();

    if (!trimmedId) {
      errs.identifier = t('validation.usernameRequired');
    } else if (/\s/.test(trimmedId)) {
      errs.identifier = t('validation.identifierNoSpaces');
    } else if (trimmedId.includes('@') && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedId)) {
      errs.identifier = t('validation.invalidEmailFormat');
    }

    if (!nextPw) {
      errs.password = t('validation.passwordRequired');
    }

    return errs;
  };

  const handleFillSuperAdmin = () => {
    if (!DEFAULT_SUPER_ADMIN || loading) return;
    setIdentifier(DEFAULT_SUPER_ADMIN.username);
    setPassword(DEFAULT_SUPER_ADMIN.password);
    setFieldErrors({});
  };

  // Titik integrasi submit autentikasi ke handler App.tsx / Firebase Auth
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;

    const nextErrors = validateFields(identifier, password);
    if (nextErrors.identifier || nextErrors.password) {
      setFieldErrors(nextErrors);
      if (nextErrors.identifier) {
        identifierInputRef.current?.focus();
      } else if (nextErrors.password) {
        passwordInputRef.current?.focus();
      }
      return;
    }

    setFieldErrors({});
    const trimmed = identifier.trim();

    try {
      if (rememberMe) {
        localStorage.setItem(REMEMBER_STORAGE_KEY, trimmed);
      } else {
        localStorage.removeItem(REMEMBER_STORAGE_KEY);
      }
    } catch {
      // Abaikan bila penyimpanan browser tidak tersedia
    }

    await onSignIn(trimmed, password, rememberMe);
  };

  const handleOpenForgot = () => {
    setForgotIdentifier(identifier.trim());
    setForgotError(null);
    setForgotResult(null);
    setForgotOpen(true);
  };

  const handleForgotSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (forgotLoading) return;
    const trimmed = forgotIdentifier.trim();
    if (!trimmed) {
      setForgotError(t('validation.usernameRequired'));
      return;
    }
    setForgotLoading(true);
    setForgotError(null);
    setForgotResult(null);
    try {
      const res = await requestPasswordReset(trimmed);
      setForgotResult(res);
    } catch (err) {
      const formatted = formatAuthError(err);
      setForgotError(formatted.message);
    } finally {
      setForgotLoading(false);
    }
  };

  const currentYear = new Date().getFullYear();

  const modules = [
    {
      icon: TrendingUp,
      label: t('auth.moduleErp'),
      desc: t('auth.moduleErpDesc'),
    },
    {
      icon: FileText,
      label: t('auth.moduleSop'),
      desc: t('auth.moduleSopDesc'),
    },
    {
      icon: Calendar,
      label: t('auth.moduleMeeting'),
      desc: t('auth.moduleMeetingDesc'),
    },
    {
      icon: Bell,
      label: t('auth.moduleReminder'),
      desc: t('auth.moduleReminderDesc'),
    },
    {
      icon: Headphones,
      label: t('auth.moduleHelp'),
      desc: t('auth.moduleHelpDesc'),
    },
  ];

  const isDefaultFilled =
    DEFAULT_SUPER_ADMIN &&
    identifier === DEFAULT_SUPER_ADMIN.username &&
    password === DEFAULT_SUPER_ADMIN.password;

  return (
    <div className="relative min-h-screen w-full overflow-x-hidden bg-[#0A353E] dark:bg-[#020B0F] text-white flex flex-col transition-colors duration-200">
      {/* Full-Bleed Crystal Tosca Glass Sphere Backdrop (Clearly Visible in Both Light & Dark Modes) */}
      <div className="pointer-events-none fixed inset-0 z-0 bg-[linear-gradient(125deg,#0B3F49_0%,#0E535D_48%,#082D36_100%)] dark:bg-[linear-gradient(125deg,#020C10_0%,#041A22_50%,#01080B_100%)]">
        {!backdropFailed && (
          <img
            src={loginToscaSphereUrl}
            alt=""
            aria-hidden="true"
            referrerPolicy="no-referrer"
            onError={() => setBackdropFailed(true)}
            className="w-full h-full object-cover object-[42%_center] transition-all duration-300 opacity-100 brightness-[1.14] contrast-[1.02] saturate-[1.10] dark:brightness-[0.78] dark:contrast-[1.12] dark:saturate-[0.95]"
          />
        )}

        {/* Atmospheric contrast wash — Light: luminous translucent teal preserving full crystal detail / Dark: deep obsidian-midnight */}
        <div
          className="absolute inset-0 bg-[linear-gradient(100deg,rgba(7,46,54,0.52)_0%,rgba(9,58,66,0.16)_42%,rgba(8,48,56,0.22)_74%,rgba(6,38,46,0.44)_100%)] dark:bg-[linear-gradient(100deg,rgba(2,11,15,0.82)_0%,rgba(3,17,23,0.44)_44%,rgba(2,12,17,0.62)_74%,rgba(1,8,12,0.88)_100%)]"
          aria-hidden="true"
        />

        {/* Crisp Translucent Diagonal Sweep on Desktop (keeps crystal sphere gleaming cleanly behind left column) */}
        <div
          className="hidden lg:block absolute inset-0 bg-[linear-gradient(160deg,rgba(7,48,56,0.68)_0%,rgba(10,60,68,0.44)_54%,rgba(8,44,52,0.18)_100%)] dark:bg-[linear-gradient(160deg,rgba(2,12,17,0.86)_0%,rgba(4,20,27,0.64)_54%,rgba(2,11,16,0.38)_100%)] [clip-path:polygon(0_0,56%_0,38%_100%,0_100%)]"
          aria-hidden="true"
        />

        {/* Mobile/Tablet readability veil */}
        <div
          className="lg:hidden absolute inset-0 bg-[linear-gradient(180deg,rgba(7,44,52,0.68)_0%,rgba(8,52,60,0.46)_52%,rgba(6,38,46,0.72)_100%)] dark:bg-[linear-gradient(180deg,rgba(2,12,17,0.86)_0%,rgba(3,18,24,0.72)_52%,rgba(1,9,13,0.90)_100%)]"
          aria-hidden="true"
        />

        {/* Bottom-Left Angled Hijau Tosca Corner Accent */}
        <div
          className="absolute bottom-0 left-0 w-28 h-14 bg-[linear-gradient(135deg,#0D7678_0%,#14B8A6_62%,#2DD4BF_100%)] [clip-path:polygon(0_22%,100%_100%,0_100%)] opacity-95"
          aria-hidden="true"
        />
      </div>

      {/* Top Right Utility Controls (Theme & Language Switcher) */}
      <header className="relative z-20 w-full max-w-[1600px] mx-auto px-6 sm:px-10 lg:px-14 xl:px-20 pt-5 pb-1 flex items-center justify-between lg:justify-end gap-4 shrink-0">
        <div className="lg:hidden">
          <BrandLogo size="sm" variant="onDark" accentScheme="tosca" showDivider />
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <ThemeToggleButton iconOnly />
          <LanguageSwitcher />
        </div>
      </header>

      {/* Main Split Content Area */}
      <main className="relative z-10 flex-1 w-full max-w-[1600px] mx-auto px-6 sm:px-10 lg:px-14 xl:px-20 py-4 lg:py-6 flex items-center">
        <div className="w-full grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-12 items-center">
          {/* Left Column: Brand Lockup, Display Headline, 5 Framed Icon Modules */}
          <section className="lg:col-span-6 xl:col-span-6 space-y-7 max-w-xl">
            {/* Desktop Brand Lockup + Sub-Tagline */}
            <div className="hidden lg:block space-y-2">
              <BrandLogo size="lg" variant="onDark" accentScheme="tosca" showDivider />
              <p className="text-xs sm:text-[13px] font-normal text-[#DAF2F2] dark:text-[#B9D9DC] tracking-normal">
                Solusi Integrasi Bisnis Anda{' '}
                <span className="text-[#5EEAD4] dark:text-[#2DD4BF] font-semibold">
                  dalam Satu Sistem
                </span>
              </p>
            </div>

            {/* Primary Display Headline & Subtitle */}
            <div className="space-y-3">
              <h1
                className="font-display text-4xl sm:text-5xl xl:text-[52px] font-normal tracking-tight leading-[1.1] text-white"
                style={{ textWrap: 'balance' }}
              >
                Semua Informasi,
                <br />
                <span className="font-bold text-[#4AD9CC] dark:text-[#2DD4BF]">Satu Akses.</span>
              </h1>
              <p className="text-sm sm:text-[15px] font-normal text-[#E1F4F4] dark:text-[#C4DFDF] leading-relaxed max-w-md">
                {t('auth.heroTagline')}
              </p>
            </div>

            {/* 5 Portal Modules with Outlined Rounded-Square Hijau Tosca Icon Boxes */}
            <ul aria-label={t('auth.modulesLabel')} className="space-y-3.5 max-w-md">
              {modules.map((mod) => {
                const Icon = mod.icon;
                return (
                  <li key={mod.label} className="flex items-center gap-3.5">
                    <span
                      className="w-10 h-10 rounded-[10px] border border-[#5EEAD4]/80 dark:border-[#2DD4BF]/65 bg-[#0D7678]/35 dark:bg-[#041820]/70 text-[#5EEAD4] dark:text-[#2DD4BF] flex items-center justify-center shrink-0 transition-colors"
                      aria-hidden="true"
                    >
                      <Icon className="w-[18px] h-[18px]" strokeWidth={1.8} />
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-white leading-snug">
                        {mod.label}
                      </p>
                      <p className="text-xs font-normal text-[#D4ECEC] dark:text-[#B5D2D5] mt-0.5 leading-snug">
                        {mod.desc}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>

          {/* Right Column: Floating Elevated Corporate Login Card (Light: Crisp White / Dark: Deep Obsidian-Teal) */}
          <section className="lg:col-span-6 xl:col-span-5 xl:col-start-8 w-full flex justify-center lg:justify-end">
            <div className="w-full max-w-[440px] rounded-[14px] overflow-hidden bg-white dark:bg-[#131921]/96 dark:backdrop-blur-md border border-[#D4E6E6] dark:border-[#232D3B] shadow-[0_24px_60px_rgba(3,24,32,0.34)] dark:shadow-[0_28px_70px_rgba(0,0,0,0.72)] text-[#08242C] dark:text-[#EEF2F6] transition-colors duration-200">
              {/* Top Edge Hijau Tosca Accent Line */}
              <div
                className="h-[3px] w-full bg-[linear-gradient(90deg,#14B8A6_0%,#2DD4BF_42%,rgba(45,212,191,0.12)_72%,transparent_100%)] dark:bg-[linear-gradient(90deg,#108486_0%,#45C8C4_42%,rgba(69,200,196,0.12)_72%,transparent_100%)]"
                aria-hidden="true"
              />

              <div className="p-7 sm:p-8 space-y-5">
                {/* Card Heading */}
                <div className="space-y-1">
                  <h2 className="font-display text-2xl font-bold tracking-tight text-[#08242C] dark:text-[#EEF2F6]">
                    {t('auth.welcomeTitle')}
                  </h2>
                  <p className="text-sm font-normal text-[#546E75] dark:text-[#94A3B8]">
                    {t('auth.welcomeSubtitle')}
                  </p>
                </div>

                {/* General Error Banner */}
                {error && (
                  <div
                    role="alert"
                    aria-live="assertive"
                    className="p-3.5 rounded-[8px] bg-[#FEF2F2] dark:bg-[var(--danger-soft)] border border-[#DC2626]/35 text-xs text-[#991B1B] dark:text-[#FCA5A5] space-y-2"
                  >
                    <div className="flex items-start gap-2.5">
                      <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-[#DC2626] dark:text-[#F87171]" />
                      <p className="leading-relaxed font-normal">{error}</p>
                    </div>
                    {isProviderDisabled && (
                      <div className="pt-2 border-t border-[#DC2626]/20 space-y-1 text-xs text-[#08242C] dark:text-[#DCECEC]">
                        <p className="font-semibold">{t('auth.firebaseEnableTitle')}</p>
                        <ol className="list-decimal list-inside space-y-0.5 text-[#4A656C] dark:text-[#96B5BC]">
                          <li>{t('auth.firebaseStep1')}</li>
                          <li>{t('auth.firebaseStep2')}</li>
                        </ol>
                        <a
                          href="https://console.firebase.google.com/project/gen-lang-client-0918567567/authentication/providers"
                          target="_blank"
                          rel="noreferrer"
                          className="inline-block mt-1 font-semibold text-[#0D7678] dark:text-[#5EEAD4] underline underline-offset-2"
                        >
                          {t('auth.firebaseLink')}
                        </a>
                      </div>
                    )}
                  </div>
                )}

                <form onSubmit={handleSubmit} noValidate className="space-y-4">
                  {/* Email / Username Field with Leading User Icon */}
                  <div className="space-y-1.5">
                    <label
                      htmlFor="nara-login-identifier"
                      className="block text-xs font-semibold text-[#08242C] dark:text-[#DCECEC]"
                    >
                      {t('auth.usernameLabel')}
                    </label>
                    <div className="relative">
                      <span
                        className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[#546E75] dark:text-[#7FA0A8]"
                        aria-hidden="true"
                      >
                        <User className="w-4 h-4" />
                      </span>
                      <input
                        ref={identifierInputRef}
                        id="nara-login-identifier"
                        name="username"
                        type="text"
                        autoComplete="username"
                        required
                        disabled={loading}
                        value={identifier}
                        onChange={(e) => {
                          setIdentifier(e.target.value);
                          if (fieldErrors.identifier) {
                            setFieldErrors((prev) => ({ ...prev, identifier: undefined }));
                          }
                        }}
                        aria-invalid={Boolean(fieldErrors.identifier)}
                        aria-describedby={
                          fieldErrors.identifier ? 'nara-login-identifier-error' : undefined
                        }
                        placeholder={t('auth.usernamePlaceholder')}
                        className={`w-full h-11 pl-10 pr-3.5 text-sm font-normal rounded-[8px] bg-[#F7FAFA] dark:bg-[#0E131A] border text-[#08242C] dark:text-[#EEF2F6] placeholder:text-[#6B858C] dark:placeholder:text-[#64748B] transition-colors duration-150 focus:outline-none focus:ring-2 disabled:opacity-60 disabled:cursor-not-allowed ${
                          fieldErrors.identifier
                            ? 'border-[#DC2626] dark:border-[#EF4444] focus:border-[#DC2626] focus:ring-[#DC2626]/20'
                            : 'border-[#CFDEDE] dark:border-[#232D3B] hover:border-[#94B9BC] dark:hover:border-[#334154] focus:border-[#0D7678] dark:focus:border-[#45C8C4] focus:ring-[#0D7678]/20 dark:focus:ring-[#45C8C4]/25'
                        }`}
                      />
                    </div>
                    {fieldErrors.identifier && (
                      <p
                        id="nara-login-identifier-error"
                        role="alert"
                        className="flex items-center gap-1.5 text-xs font-normal text-[#B3261E] dark:text-[#F87171]"
                      >
                        <AlertCircle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                        <span>{fieldErrors.identifier}</span>
                      </p>
                    )}
                  </div>

                  {/* Password Field with Leading Lock Icon + Trailing Visibility Toggle */}
                  <div className="space-y-1.5">
                    <label
                      htmlFor="nara-login-password"
                      className="block text-xs font-semibold text-[#08242C] dark:text-[#DCECEC]"
                    >
                      {t('auth.passwordLabel')}
                    </label>
                    <div className="relative">
                      <span
                        className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[#546E75] dark:text-[#7FA0A8]"
                        aria-hidden="true"
                      >
                        <Lock className="w-4 h-4" />
                      </span>
                      <input
                        ref={passwordInputRef}
                        id="nara-login-password"
                        name="password"
                        type={showPassword ? 'text' : 'password'}
                        autoComplete="current-password"
                        required
                        disabled={loading}
                        value={password}
                        onChange={(e) => {
                          setPassword(e.target.value);
                          if (fieldErrors.password) {
                            setFieldErrors((prev) => ({ ...prev, password: undefined }));
                          }
                        }}
                        aria-invalid={Boolean(fieldErrors.password)}
                        aria-describedby={
                          fieldErrors.password ? 'nara-login-password-error' : undefined
                        }
                        placeholder={t('auth.passwordPlaceholder')}
                        className={`w-full h-11 pl-10 pr-11 text-sm font-normal rounded-[8px] bg-[#F7FAFA] dark:bg-[#0E131A] border text-[#08242C] dark:text-[#EEF2F6] placeholder:text-[#6B858C] dark:placeholder:text-[#64748B] transition-colors duration-150 focus:outline-none focus:ring-2 disabled:opacity-60 disabled:cursor-not-allowed ${
                          fieldErrors.password
                            ? 'border-[#DC2626] dark:border-[#EF4444] focus:border-[#DC2626] focus:ring-[#DC2626]/20'
                            : 'border-[#CFDEDE] dark:border-[#232D3B] hover:border-[#94B9BC] dark:hover:border-[#334154] focus:border-[#0D7678] dark:focus:border-[#45C8C4] focus:ring-[#0D7678]/20 dark:focus:ring-[#45C8C4]/25'
                        }`}
                      />
                      <button
                        type="button"
                        disabled={loading}
                        onClick={() => setShowPassword((v) => !v)}
                        aria-label={showPassword ? t('auth.hidePassword') : t('auth.showPassword')}
                        aria-pressed={showPassword}
                        className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 inline-flex items-center justify-center rounded-[6px] text-[#546E75] hover:text-[#08242C] hover:bg-[#E7F1F1] dark:text-[#94A3B8] dark:hover:text-white dark:hover:bg-[#1A222D] transition-colors duration-150 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {showPassword ? (
                          <EyeOff className="w-4 h-4" aria-hidden="true" />
                        ) : (
                          <Eye className="w-4 h-4" aria-hidden="true" />
                        )}
                      </button>
                    </div>
                    {fieldErrors.password && (
                      <p
                        id="nara-login-password-error"
                        role="alert"
                        className="flex items-center gap-1.5 text-xs font-normal text-[#B3261E] dark:text-[#F87171]"
                      >
                        <AlertCircle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                        <span>{fieldErrors.password}</span>
                      </p>
                    )}
                  </div>

                  {/* Remember Me & Forgot Password Row */}
                  <div className="flex items-center justify-between gap-3 pt-0.5">
                    <label
                      htmlFor="nara-login-remember"
                      className="inline-flex items-center gap-2 text-xs font-normal text-[#3B575F] dark:text-[#96B5BC] select-none cursor-pointer"
                    >
                      <input
                        id="nara-login-remember"
                        type="checkbox"
                        disabled={loading}
                        checked={rememberMe}
                        onChange={(e) => setRememberMe(e.target.checked)}
                        className="w-4 h-4 rounded-[4px] border border-[#B0C9CB] dark:border-[#2B4E58] accent-[#0D7678] dark:accent-[#2DD4BF] cursor-pointer disabled:opacity-50"
                      />
                      <span>{t('auth.rememberMe')}</span>
                    </label>

                    <button
                      type="button"
                      disabled={loading}
                      onClick={handleOpenForgot}
                      className="text-xs font-medium text-[#3B575F] dark:text-[#96B5BC] hover:text-[#0D7678] dark:hover:text-[#5EEAD4] underline-offset-4 hover:underline transition-colors duration-150 cursor-pointer disabled:opacity-50"
                    >
                      {t('auth.forgotPassword')}
                    </button>
                  </div>

                  {/* Full-Width Hijau Tosca Submit Button with Arrow */}
                  <div className="pt-1">
                    <button
                      type="submit"
                      disabled={loading}
                      className="w-full h-12 inline-flex items-center justify-center gap-2 px-5 text-sm font-bold rounded-[8px] bg-[#22B5A5] text-[#05242A] hover:bg-[#1BA192] active:bg-[#148A7E] dark:bg-[#108486] dark:text-white dark:hover:bg-[#149698] dark:active:bg-[#0D7274] disabled:opacity-55 disabled:cursor-not-allowed transition-colors duration-150 cursor-pointer"
                    >
                      {loading ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                          <span>{t('auth.signingIn')}</span>
                        </>
                      ) : (
                        <>
                          <span>{t('auth.signInButton')}</span>
                          <ArrowRight className="w-4 h-4" aria-hidden="true" />
                        </>
                      )}
                    </button>
                  </div>
                </form>

                {/* Quick Test Accounts by Role (for testing RBAC menus & AI data filtering) */}
                <div className="space-y-2 pt-1">
                  <div className="flex items-center justify-between text-[11px] text-[#546E75] dark:text-[#96B5BC]">
                    <span className="font-semibold">Akun Demo Uji Role (1-Klik):</span>
                    {DEFAULT_SUPER_ADMIN && !isDefaultFilled && (
                      <button
                        type="button"
                        disabled={loading}
                        onClick={handleFillSuperAdmin}
                        className="font-semibold text-[#0D7678] dark:text-[#5EEAD4] hover:underline cursor-pointer"
                      >
                        Reset Admin
                      </button>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    {[
                      {
                        label: 'Administrator',
                        code: 'ADM01',
                        u: 'superuser',
                        p: 'SuperUser#2026',
                      },
                      {
                        label: 'Finance',
                        code: 'FIN01',
                        u: 'rina.finance',
                        p: 'Finance#2026',
                      },
                      {
                        label: 'Sales',
                        code: 'SAL01',
                        u: 'andi.sales',
                        p: 'Sales#2026',
                      },
                      {
                        label: 'Karyawan Biasa',
                        code: 'STAFF',
                        u: 'siti.staff',
                        p: 'Staff#2026',
                      },
                    ].map((preset) => {
                      const activePreset = identifier.trim().toLowerCase() === preset.u;
                      return (
                        <button
                          key={preset.code}
                          type="button"
                          disabled={loading}
                          onClick={() => {
                            setIdentifier(preset.u);
                            setPassword(preset.p);
                            setFieldErrors({});
                          }}
                          className={`px-2.5 py-1.5 rounded-[7px] border text-left transition-colors cursor-pointer disabled:opacity-50 ${
                            activePreset
                              ? 'border-[#0D7678] dark:border-[#45C8C4]/70 bg-[#EEF7F7] dark:bg-[#108486]/16'
                              : 'border-[#D4E6E6] dark:border-[#232D3B] bg-[#F7FAFA] dark:bg-[#0E131A] hover:border-[#0D7678]/60 dark:hover:border-[#334154]'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-1">
                            <span className="text-[11px] font-semibold text-[#08242C] dark:text-[#EEF2F6] truncate">
                              {preset.label}
                            </span>
                            <span className="font-mono text-[10px] font-semibold text-[#0D7678] dark:text-[#45C8C4]">
                              {preset.code}
                            </span>
                          </div>
                          <p className="font-mono text-[10px] text-[#546E75] dark:text-[#94A3B8] truncate">
                            {preset.u}
                          </p>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Divider with centered 'atau' (matches reference card footer) */}
                <div className="relative flex items-center gap-3 pt-0.5">
                  <div className="flex-1 h-px bg-[#DFECEC] dark:bg-[#232D3B]" />
                  <span className="text-xs font-normal text-[#6B858C] dark:text-[#64748B]">
                    atau
                  </span>
                  <div className="flex-1 h-px bg-[#DFECEC] dark:bg-[#232D3B]" />
                </div>

                {/* Help Center Link with Headphones Icon */}
                <div className="flex items-center justify-center flex-wrap gap-1.5 text-xs text-[#4A656C] dark:text-[#94A3B8]">
                  <span>{t('auth.needHelpPrompt')}</span>
                  <button
                    type="button"
                    onClick={() => setHelpOpen(true)}
                    className="inline-flex items-center gap-1.5 font-semibold text-[#0D7678] dark:text-[#45C8C4] hover:text-[#085355] dark:hover:text-[#6AD8D4] underline-offset-4 hover:underline transition-colors duration-150 whitespace-nowrap cursor-pointer"
                  >
                    <span>{t('auth.helpCenter')}</span>
                    <Headphones
                      className="w-3.5 h-3.5 text-[#08242C] dark:text-[#ECF6F6]"
                      aria-hidden="true"
                    />
                  </button>
                </div>
              </div>
            </div>
          </section>
        </div>
      </main>

      {/* Bottom Institutional Copyright with Hijau Tosca Hairline */}
      <footer className="relative z-10 w-full max-w-[1600px] mx-auto px-6 sm:px-10 lg:px-14 xl:px-20 pt-2 pb-5 shrink-0">
        <div
          className="h-px w-full max-w-md bg-[linear-gradient(90deg,#5EEAD4_0%,rgba(94,234,212,0.30)_58%,transparent_100%)] dark:bg-[linear-gradient(90deg,#2DD4BF_0%,rgba(45,212,191,0.25)_58%,transparent_100%)] mb-3"
          aria-hidden="true"
        />
        <p className="text-xs font-normal text-[#CFE7E7] dark:text-[#9AB7BC]">
          {t('auth.copyright', { year: currentYear })}
        </p>
      </footer>

      {/* Modal: Lupa Kata Sandi */}
      {forgotOpen && (
        <div
          className="fixed inset-0 z-50 bg-[#021218]/70 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="nara-forgot-title"
          onClick={() => setForgotOpen(false)}
        >
          <div
            className="w-full max-w-[400px] rounded-[10px] bg-white dark:bg-[#131921] border border-[#D3E3E4] dark:border-[#232D3B] p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <h3
                  id="nara-forgot-title"
                  className="font-display text-base font-semibold text-[#08242C] dark:text-[#EEF2F6]"
                >
                  {t('auth.forgotTitle')}
                </h3>
                <p className="text-xs font-normal text-[#4A656C] dark:text-[#94A3B8] leading-relaxed">
                  {t('auth.forgotSubtitle')}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setForgotOpen(false)}
                aria-label={t('common.close')}
                className="p-1.5 rounded-[6px] text-[#4A656C] hover:text-[#08242C] dark:text-[#94A3B8] dark:hover:text-white transition-colors duration-150 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {forgotResult ? (
              <div className="space-y-4">
                <div className="p-3.5 rounded-[8px] bg-[#EEF7F7] dark:bg-[#1A222D] border border-[#C6DADB] dark:border-[#232D3B] flex items-start gap-2.5 text-xs text-[#08242C] dark:text-[#EEF2F6] leading-relaxed">
                  <CheckCircle2 className="w-4 h-4 text-[#0D7678] dark:text-[#45C8C4] shrink-0 mt-0.5" />
                  <p>
                    {forgotResult.mode === 'sent'
                      ? t('auth.forgotSentMessage', { email: forgotResult.email })
                      : t('auth.forgotInternalMessage')}
                  </p>
                </div>
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => setForgotOpen(false)}
                    className="h-9 px-4 text-xs font-semibold rounded-[8px] bg-[#0D7678] text-white hover:bg-[#0A6264] dark:bg-[#108486] dark:text-white dark:hover:bg-[#149698] transition-colors duration-150 cursor-pointer"
                  >
                    {t('common.close')}
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleForgotSubmit} noValidate className="space-y-4">
                <div className="space-y-1.5">
                  <label
                    htmlFor="nara-forgot-identifier"
                    className="block text-xs font-semibold text-[#08242C] dark:text-[#EEF2F6]"
                  >
                    {t('auth.usernameLabel')}
                  </label>
                  <input
                    id="nara-forgot-identifier"
                    type="text"
                    autoFocus
                    disabled={forgotLoading}
                    value={forgotIdentifier}
                    onChange={(e) => {
                      setForgotIdentifier(e.target.value);
                      if (forgotError) setForgotError(null);
                    }}
                    placeholder={t('auth.usernamePlaceholder')}
                    className="w-full h-10 px-3 text-sm font-normal rounded-[8px] bg-white dark:bg-[#0E131A] border border-[#C6DADB] dark:border-[#232D3B] text-[#08242C] dark:text-[#EEF2F6] focus:outline-none focus:border-[#0E7C7B] dark:focus:border-[#45C8C4] focus:ring-2 focus:ring-[#149A9A]/25 dark:focus:ring-[#45C8C4]/25 transition-colors duration-150"
                  />
                  {forgotError && (
                    <p
                      role="alert"
                      className="flex items-center gap-1.5 text-xs text-[#B3261E] dark:text-[#E0636B]"
                    >
                      <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                      <span>{forgotError}</span>
                    </p>
                  )}
                </div>

                <div className="flex items-center justify-end gap-2 pt-1">
                  <button
                    type="button"
                    disabled={forgotLoading}
                    onClick={() => setForgotOpen(false)}
                    className="h-9 px-3.5 text-xs font-semibold rounded-[8px] border border-[#C6DADB] dark:border-[#232D3B] text-[#08242C] dark:text-[#EEF2F6] hover:bg-[#EEF7F7] dark:hover:bg-[#1A222D] transition-colors duration-150 cursor-pointer"
                  >
                    {t('common.cancel')}
                  </button>
                  <button
                    type="submit"
                    disabled={forgotLoading}
                    className="h-9 px-4 inline-flex items-center gap-1.5 text-xs font-semibold rounded-[8px] bg-[#0D7678] text-white hover:bg-[#0A6264] dark:bg-[#108486] dark:text-white dark:hover:bg-[#149698] disabled:opacity-55 transition-colors duration-150 cursor-pointer"
                  >
                    {forgotLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    <span>{t('auth.forgotSubmit')}</span>
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Modal: Pusat Bantuan */}
      {helpOpen && (
        <div
          className="fixed inset-0 z-50 bg-[#021218]/70 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="nara-help-title"
          onClick={() => setHelpOpen(false)}
        >
          <div
            className="w-full max-w-[440px] rounded-[10px] bg-white dark:bg-[#131921] border border-[#D3E3E4] dark:border-[#232D3B] p-6 space-y-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <h3
                  id="nara-help-title"
                  className="font-display text-base font-semibold text-[#08242C] dark:text-[#EEF2F6]"
                >
                  {t('auth.helpTitle')}
                </h3>
                <p className="text-xs font-normal text-[#4A656C] dark:text-[#94A3B8]">
                  {t('auth.helpSubtitle')}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setHelpOpen(false)}
                aria-label={t('common.close')}
                className="p-1.5 rounded-[6px] text-[#4A656C] hover:text-[#08242C] dark:text-[#94A3B8] dark:hover:text-white transition-colors duration-150 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="divide-y divide-[#D3E3E4] dark:divide-[#232D3B] border-y border-[#D3E3E4] dark:border-[#232D3B] text-xs">
              <div className="py-3 space-y-1">
                <p className="font-semibold text-[#08242C] dark:text-[#EEF2F6]">
                  {t('auth.helpItem1Title')}
                </p>
                <p className="text-[#4A656C] dark:text-[#94A3B8] leading-relaxed">
                  {t('auth.helpItem1Desc')}
                </p>
              </div>
              <div className="py-3 space-y-1">
                <p className="font-semibold text-[#08242C] dark:text-[#EEF2F6]">
                  {t('auth.helpItem2Title')}
                </p>
                <p className="text-[#4A656C] dark:text-[#94A3B8] leading-relaxed">
                  {t('auth.helpItem2Desc')}
                </p>
              </div>
              <div className="py-3 space-y-1">
                <p className="font-semibold text-[#08242C] dark:text-[#EEF2F6]">
                  {t('auth.helpItem3Title')}
                </p>
                <p className="text-[#4A656C] dark:text-[#94A3B8] leading-relaxed">
                  {t('auth.helpItem3Desc')}
                </p>
              </div>
            </div>

            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setHelpOpen(false)}
                className="h-9 px-4 text-xs font-semibold rounded-[8px] bg-[#0D7678] text-white hover:bg-[#0A6264] dark:bg-[#108486] dark:text-white dark:hover:bg-[#149698] transition-colors duration-150 cursor-pointer"
              >
                {t('common.close')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
