/**
 * A small inline icon set — 16px grid, 1.6 stroke, currentColor.
 * Inline SVG keeps the bundle free of an icon dependency.
 */
interface IconProps {
  size?: number;
  className?: string;
}

function Svg({ size = 16, className, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {children}
    </svg>
  );
}

export const IconGauge = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2.5 12a5.5 5.5 0 1 1 11 0" />
    <path d="M8 12V8.6" />
    <circle cx="8" cy="12.6" r="0.8" fill="currentColor" stroke="none" />
  </Svg>
);

export const IconUpstream = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="8" cy="8" r="5.3" />
    <path d="M8 2.7v10.6M2.7 8h10.6" />
  </Svg>
);

export const IconKey = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="5.4" cy="5.4" r="2.9" />
    <path d="m7.6 7.6 5 5M11 11l1.4-1.4M12.6 12.6 14 11.2" />
  </Svg>
);

export const IconActivity = (p: IconProps) => (
  <Svg {...p}>
    <path d="M1.8 8h2.6l1.9-4.8 2.8 9.6 1.9-4.8h3.2" />
  </Svg>
);

export const IconSettings = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="8" cy="8" r="2.2" />
    <path d="M8 1.6v1.8M8 12.6v1.8M14.4 8h-1.8M3.4 8H1.6M12.5 3.5l-1.3 1.3M4.8 11.2l-1.3 1.3M12.5 12.5l-1.3-1.3M4.8 4.8 3.5 3.5" />
  </Svg>
);

export const IconPlus = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8 3.2v9.6M3.2 8h9.6" />
  </Svg>
);

export const IconCopy = (p: IconProps) => (
  <Svg {...p}>
    <rect x="5.6" y="5.6" width="8" height="8" rx="1.6" />
    <path d="M10.4 3.2a1.6 1.6 0 0 0-1.6-1.6H4a1.6 1.6 0 0 0-1.6 1.6v4.8a1.6 1.6 0 0 0 1.6 1.6" />
  </Svg>
);

export const IconCheck = (p: IconProps) => (
  <Svg {...p}>
    <path d="m3 8.4 3.2 3.2L13 4.8" />
  </Svg>
);

export const IconAlert = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8 2.6 14.2 13H1.8z" />
    <path d="M8 6.6v3M8 11.4h.01" />
  </Svg>
);

export const IconRefresh = (p: IconProps) => (
  <Svg {...p}>
    <path d="M13.4 6.8A5.6 5.6 0 0 0 3.3 5.4M2.6 9.2a5.6 5.6 0 0 0 10.1 1.4" />
    <path d="M13.4 2.8v4h-4M2.6 13.2v-4h4" />
  </Svg>
);

export const IconTrash = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2.8 4.4h10.4M6.4 4.4V3.2a1 1 0 0 1 1-1h1.2a1 1 0 0 1 1 1v1.2M4.4 4.4l.6 8a1.2 1.2 0 0 0 1.2 1.1h3.6a1.2 1.2 0 0 0 1.2-1.1l.6-8" />
  </Svg>
);

export const IconEdit = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9.6 3.2 12.8 6.4M2.8 13.2l.6-2.8 7-7a1.4 1.4 0 0 1 2 0l.2.2a1.4 1.4 0 0 1 0 2l-7 7z" />
  </Svg>
);

export const IconClose = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 4l8 8M12 4l-8 8" />
  </Svg>
);

export const IconSun = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="8" cy="8" r="2.8" />
    <path d="M8 1.4v1.4M8 13.2v1.4M14.6 8h-1.4M2.8 8H1.4M12.7 3.3l-1 1M4.3 11.7l-1 1M12.7 12.7l-1-1M4.3 4.3l-1-1" />
  </Svg>
);

export const IconMoon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M13.2 9.4A5.6 5.6 0 0 1 6.6 2.8a5.6 5.6 0 1 0 6.6 6.6Z" />
  </Svg>
);

export const IconLogout = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 13.4H3.6A1.2 1.2 0 0 1 2.4 12.2V3.8a1.2 1.2 0 0 1 1.2-1.2H6M10.4 11.2 13.6 8l-3.2-3.2M13.6 8H6.4" />
  </Svg>
);

export const IconBolt = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8.8 1.6 3.2 9.2h4l-.8 5.2 5.6-7.6h-4z" />
  </Svg>
);

/** The ring of keys the product is named for. */
export const BrandMark = ({ size = 26 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
    <circle cx="16" cy="16" r="10.5" fill="none" stroke="var(--accent)" strokeWidth="2.4" />
    <circle cx="16" cy="5.5" r="3.4" fill="var(--series-2)" />
    <circle cx="26" cy="21.5" r="2.4" fill="var(--accent)" />
    <circle cx="6" cy="21.5" r="2.4" fill="var(--accent)" opacity="0.55" />
  </svg>
);
