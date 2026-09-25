import { useEffect, useId, useState } from 'react';
import { copyText } from '../lib/clipboard';
import { IconCheck, IconClose, IconCopy } from './Icons';

/* --- Badge ---------------------------------------------------------------- */
export type BadgeTone = 'good' | 'warning' | 'serious' | 'critical' | 'neutral' | 'accent';

export function Badge({
  tone = 'neutral',
  children,
  dot = true,
}: {
  tone?: BadgeTone;
  children: React.ReactNode;
  dot?: boolean;
}) {
  return (
    <span className={`badge badge-${tone}`}>
      {dot && <span className="badge-dot" />}
      {children}
    </span>
  );
}

/* --- Meter ---------------------------------------------------------------- */
/** Severity rides the fill, so the state reads without looking at the number. */
export function Meter({
  value,
  label,
  detail,
}: {
  value: number;
  label?: string;
  detail?: string;
}) {
  const ratio = Math.max(0, Math.min(1, value));
  const tone =
    ratio >= 1 ? 'critical' : ratio >= 0.9 ? 'serious' : ratio >= 0.72 ? 'warning' : '';
  return (
    <div>
      {(label || detail) && (
        <div className="meter-label">
          <span>{label}</span>
          <span>{detail}</span>
        </div>
      )}
      <div
        className="meter"
        role="meter"
        aria-valuenow={Math.round(ratio * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label ?? 'Utilisation'}
      >
        <div className={`meter-fill ${tone}`} style={{ width: `${ratio * 100}%` }} />
      </div>
    </div>
  );
}

/* --- Field ---------------------------------------------------------------- */
export function Field({
  label,
  help,
  error,
  children,
}: {
  label: string;
  help?: string;
  error?: string;
  children: (id: string) => React.ReactNode;
}) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children(id)}
      {error ? <span className="error">{error}</span> : help ? <span className="help">{help}</span> : null}
    </div>
  );
}

/* --- Switch --------------------------------------------------------------- */
export function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: React.ReactNode;
}) {
  return (
    <label className="switch">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="switch-track">
        <span className="switch-thumb" />
      </span>
      <span>{label}</span>
    </label>
  );
}

/* --- Segmented ------------------------------------------------------------ */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (next: T) => void;
  ariaLabel: string;
}) {
  return (
    <div className="segmented" role="group" aria-label={ariaLabel}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/* --- Copy field ----------------------------------------------------------- */
export function CopyField({
  value,
  label,
  wrap,
}: {
  value: string;
  label?: string;
  /** Lets a long URL wrap instead of scrolling — used in the narrow sidebar. */
  wrap?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1_600);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <div className={`copyfield${wrap ? ' wrap' : ''}`}>
      <code>{value}</code>
      <button
        type="button"
        className="btn btn-ghost btn-sm btn-icon"
        aria-label={copied ? 'Copied' : `Copy ${label ?? 'value'}`}
        onClick={async () => setCopied(await copyText(value))}
      >
        {copied ? <IconCheck /> : <IconCopy />}
      </button>
    </div>
  );
}

/* --- Dialog --------------------------------------------------------------- */
export function Dialog({
  title,
  description,
  onClose,
  children,
  footer,
  wide,
}: {
  title: string;
  description?: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  return (
    <div
      className="overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className={`dialog${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="dialog-head">
          <div>
            <h2>{title}</h2>
            {description && <p>{description}</p>}
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-sm btn-icon"
            style={{ marginLeft: 'auto' }}
            onClick={onClose}
            aria-label="Close"
          >
            <IconClose />
          </button>
        </div>
        <div className="dialog-body">{children}</div>
        {footer && <div className="dialog-foot">{footer}</div>}
      </div>
    </div>
  );
}

/* --- Empty state ---------------------------------------------------------- */
export function EmptyState({
  title,
  message,
  action,
}: {
  title: string;
  message: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      <p>{message}</p>
      {action}
    </div>
  );
}
