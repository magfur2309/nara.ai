import React from 'react';

/**
 * Komponen logo resmi NARA AI.
 * Dipisahkan dalam file tersendiri agar mudah diganti apabila terdapat aset logo final perusahaan.
 */
interface NaraLogoMarkProps {
  size?: number;
  className?: string;
  accentScheme?: 'gold' | 'tosca';
}

export const NaraLogoMark: React.FC<NaraLogoMarkProps> = ({
  size = 28,
  className = '',
  accentScheme = 'tosca',
}) => {
  const palette =
    accentScheme === 'tosca'
      ? {
          leftLeg: '#148A8E',
          leftShadow: '#0A5E6A',
          rightLeg: '#1AA1A2',
          rightShadow: '#0E6E78',
          ribbon: '#4AD9CC',
        }
      : {
          leftLeg: '#D69800',
          leftShadow: '#A87400',
          rightLeg: '#E0A300',
          rightShadow: '#B88000',
          ribbon: '#F4B400',
        };

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      {/* Left vertical ribbon leg */}
      <path
        d="M5.5 34V12.2C5.5 8.2 8.7 5.5 12.1 5.5C13.8 5.5 15.2 6.2 16.4 7.5L11.8 14.2V30.4L5.5 34Z"
        fill={palette.leftLeg}
      />
      {/* Left shadow fold */}
      <path
        d="M5.5 12.4C5.5 8.5 8.5 5.5 12.2 5.5C14.1 5.5 15.8 6.4 17.3 8.1L11.8 14.8C10.5 13.1 8.4 12.5 5.5 12.4Z"
        fill={palette.leftShadow}
      />
      {/* Right vertical ribbon leg */}
      <path
        d="M34.5 6V27.8C34.5 31.8 31.3 34.5 27.9 34.5C26.2 34.5 24.8 33.8 23.6 32.5L28.2 25.8V9.6L34.5 6Z"
        fill={palette.rightLeg}
      />
      {/* Right shadow fold */}
      <path
        d="M34.5 27.6C34.5 31.5 31.5 34.5 27.8 34.5C25.9 34.5 24.2 33.6 22.7 31.9L28.2 25.2C29.5 26.9 31.6 27.5 34.5 27.6Z"
        fill={palette.rightShadow}
      />
      {/* Primary diagonal ribbon sweep */}
      <path
        d="M6.4 10.6C8.1 7.4 11.4 5.5 14.5 6.3C16.6 6.8 18.2 8.4 20.1 10.9L31.4 25.4C32.7 27.1 33.9 27.6 34.5 27.6C34.5 31.3 31.6 34.5 27.6 34.5C25.1 34.5 22.9 33.2 20.8 30.5L9.6 16C8.1 14 6.9 13.1 5.5 12.6C5.6 11.8 5.9 11.2 6.4 10.6Z"
        fill={palette.ribbon}
      />
    </svg>
  );
};

interface BrandLogoProps {
  size?: 'sm' | 'md' | 'lg';
  showText?: boolean;
  subtitle?: string;
  showDivider?: boolean;
  showTagline?: boolean;
  variant?: 'auto' | 'onDark' | 'onLight';
  accentScheme?: 'gold' | 'tosca';
  className?: string;
}

export const BrandLogo: React.FC<BrandLogoProps> = ({
  size = 'md',
  showText = true,
  subtitle,
  showDivider = false,
  showTagline = false,
  variant = 'auto',
  accentScheme = 'tosca',
  className = '',
}) => {
  const markSize = size === 'sm' ? 24 : size === 'lg' ? 36 : 30;
  const wordmarkSize =
    size === 'lg'
      ? 'text-[22px] tracking-[0.12em]'
      : size === 'sm'
        ? 'text-[15px] tracking-[0.1em]'
        : 'text-[18px] tracking-[0.11em]';

  const wordmarkColor =
    variant === 'onDark'
      ? 'text-white'
      : variant === 'onLight'
        ? accentScheme === 'tosca'
          ? 'text-[#08242C]'
          : 'text-[#0D0D0D]'
        : 'text-[var(--text)]';

  const aiMarkerColor =
    accentScheme === 'tosca'
      ? variant === 'onDark'
        ? 'text-[#5EEAD4]'
        : 'text-[#0D7678]'
      : variant === 'onDark'
        ? 'text-[#F4B400]'
        : variant === 'onLight'
          ? 'text-[#8A6200]'
          : 'text-[var(--accent-text)]';

  const subtitleColor =
    variant === 'onDark'
      ? accentScheme === 'tosca'
        ? 'text-[#BFE6E5]'
        : 'text-[#A1A1AA]'
      : variant === 'onLight'
        ? accentScheme === 'tosca'
          ? 'text-[#4A656C]'
          : 'text-[#6B7280]'
        : 'text-[var(--text-muted)]';

  const dividerColor =
    variant === 'onDark'
      ? accentScheme === 'tosca'
        ? 'bg-[#5EEAD4]/55'
        : 'bg-[#F4B400]/55'
      : variant === 'onLight'
        ? accentScheme === 'tosca'
          ? 'bg-[#08242C]/20'
          : 'bg-[#0D0D0D]/20'
        : 'bg-[var(--border-strong)]';

  const taglineHighlightColor =
    accentScheme === 'tosca'
      ? variant === 'onDark'
        ? 'text-[#5EEAD4]'
        : 'text-[#0D7678] font-semibold'
      : variant === 'onDark'
        ? 'text-[#F4B400]'
        : 'text-[#8A6200] font-semibold';

  return (
    <div
      className={`inline-flex items-center ${showDivider ? 'gap-3.5' : 'gap-2.5'} min-w-0 shrink-0 ${className}`}
    >
      <div className="flex items-center justify-center shrink-0">
        <NaraLogoMark size={markSize} accentScheme={accentScheme} />
      </div>

      {showText && showDivider && (
        <span
          className={`w-px ${size === 'lg' ? 'h-9' : 'h-7'} ${dividerColor} shrink-0`}
          aria-hidden="true"
        />
      )}

      {showText && (
        <div className="min-w-0 leading-none">
          <div className="inline-flex items-baseline gap-1.5 whitespace-nowrap">
            <span className={`font-display font-semibold uppercase ${wordmarkSize} ${wordmarkColor}`}>
              NARA
            </span>
            <span
              className={`font-display font-semibold uppercase tracking-[0.14em] ${
                size === 'lg' ? 'text-[11px]' : 'text-[10px]'
              } ${aiMarkerColor}`}
            >
              AI
            </span>
          </div>

          {showTagline ? (
            <p className={`mt-1 text-[11px] font-normal tracking-normal whitespace-nowrap ${subtitleColor}`}>
              Semua Informasi,{' '}
              <span className={taglineHighlightColor}>
                Satu Akses.
              </span>
            </p>
          ) : subtitle ? (
            <span className={`block mt-0.5 text-[11px] font-normal truncate ${subtitleColor}`}>
              {subtitle}
            </span>
          ) : null}
        </div>
      )}
    </div>
  );
};
