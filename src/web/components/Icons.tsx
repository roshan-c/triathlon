import type { Priority } from "../../core/types.js";

interface IconProps {
  className?: string;
  size?: number;
}

export function BrandMark({ size = 16, className = "" }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className} aria-hidden="true">
      <path d="M8 2L14 13.5H2L8 2Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M8 6.5V13.5" stroke="currentColor" strokeWidth="1.4" />
      <path d="M5.2 10.5H10.8" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

export function BoardIcon({ size = 16, className = "" }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className} aria-hidden="true">
      <rect x="2" y="2.5" width="12" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
      <path d="M6 2.5V13.5M10 2.5V13.5" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

export function BacklogIcon({ size = 16, className = "" }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className} aria-hidden="true">
      <path d="M2.5 4.5H13.5M2.5 8H11.5M2.5 11.5H9.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export function ReviewIcon({ size = 16, className = "" }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className} aria-hidden="true">
      <path d="M2.5 9.5V12.5C2.5 13 3 13.5 3.5 13.5H12.5C13 13.5 13.5 13 13.5 12.5V9.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M2.5 9.5H5.5L6.5 11H9.5L10.5 9.5H13.5L12 3.5H4L2.5 9.5Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  );
}

export function CyclesIcon({ size = 16, className = "" }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className} aria-hidden="true">
      <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.4" />
      <path d="M8 5V8.2L10.2 9.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

export function MetricsIcon({ size = 16, className = "" }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className} aria-hidden="true">
      <path d="M3 13V9M8 13V5M13 13V3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function SettingsIcon({ size = 16, className = "" }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className} aria-hidden="true">
      <path d="M2.5 5H6.5M10 5H13.5M2.5 11H8.5M12 11H13.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="8.2" cy="5" r="1.6" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="10.2" cy="11" r="1.6" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

export function AgentGlyph({ size = 14, className = "" }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className} aria-hidden="true">
      <rect x="2" y="3" width="12" height="10" rx="1.6" stroke="currentColor" strokeWidth="1.4" />
      <path d="M5 6.5L7.2 8.2L5 9.9M8.5 9.9H11" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function PriorityGlyph({ priority, size = 14 }: { priority: Priority; size?: number }) {
  if (priority === "urgent") {
    return (
      <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-label="Urgent priority">
        <rect x="2" y="2" width="12" height="12" rx="2.5" fill="var(--ink)" />
        <path d="M8 5V8.8" stroke="var(--bg-card)" strokeWidth="1.8" strokeLinecap="round" />
        <circle cx="8" cy="11.2" r="1" fill="var(--bg-card)" />
      </svg>
    );
  }
  if (priority === "none") {
    return (
      <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-label="No priority">
        <path d="M3 8H5.5M6.8 8H9.3M10.5 8H13" stroke="var(--ink-3)" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    );
  }
  const activeBars = priority === "high" ? 3 : priority === "medium" ? 2 : 1;
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-label={`${priority} priority`}>
      <rect x="2.5" y="9.5" width="2.4" height="4" rx="0.6" fill={activeBars >= 1 ? "var(--ink-2)" : "var(--border-strong)"} />
      <rect x="6.8" y="6.5" width="2.4" height="7" rx="0.6" fill={activeBars >= 2 ? "var(--ink-2)" : "var(--border-strong)"} />
      <rect x="11.1" y="3.5" width="2.4" height="10" rx="0.6" fill={activeBars >= 3 ? "var(--ink-2)" : "var(--border-strong)"} />
    </svg>
  );
}

export function BlockedIcon({ size = 14, className = "" }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className} aria-hidden="true">
      <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M4.2 11.8L11.8 4.2" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

export function WarningTriangleIcon({ size = 14, className = "" }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className} aria-hidden="true">
      <path d="M8 2.3L14 13H2L8 2.3Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M8 6.4V9.3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="8" cy="11.2" r="0.8" fill="currentColor" />
    </svg>
  );
}

export function ClockIcon({ size = 14, className = "" }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className} aria-hidden="true">
      <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.4" />
      <path d="M8 5V8.2L10 9.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

export function CheckIcon({ size = 14, className = "" }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className} aria-hidden="true">
      <path d="M3.2 8.4L6.4 11.5L12.8 4.8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function SearchIcon({ size = 14, className = "" }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className} aria-hidden="true">
      <circle cx="7.2" cy="7.2" r="4.5" stroke="currentColor" strokeWidth="1.4" />
      <path d="M10.7 10.7L13.6 13.6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

export function SunIcon({ size = 15, className = "" }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className} aria-hidden="true">
      <circle cx="8" cy="8" r="2.8" stroke="currentColor" strokeWidth="1.4" />
      <path d="M8 1.8V3.2M8 12.8V14.2M1.8 8H3.2M12.8 8H14.2M3.6 3.6L4.6 4.6M11.4 11.4L12.4 12.4M12.4 3.6L11.4 4.6M4.6 11.4L3.6 12.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

export function MoonIcon({ size = 15, className = "" }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className} aria-hidden="true">
      <path d="M12.8 9.8A5.4 5.4 0 0 1 6.2 3.2a5.5 5.5 0 1 0 6.6 6.6Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  );
}

export function ChevronsUpDownIcon({ size = 14, className = "" }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className} aria-hidden="true">
      <path d="M5.5 6L8 3.5L10.5 6M5.5 10L8 12.5L10.5 10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function DownloadIcon({ size = 14, className = "" }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className} aria-hidden="true">
      <path d="M8 2.5V10M8 10L5 7M8 10L11 7M3 13H13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function CopyIcon({ size = 14, className = "" }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className} aria-hidden="true">
      <rect x="5.5" y="5.5" width="8" height="8" rx="1.4" stroke="currentColor" strokeWidth="1.4" />
      <path d="M10.5 5.5V3.5C10.5 2.9 10.1 2.5 9.5 2.5H3.5C2.9 2.5 2.5 2.9 2.5 3.5V9.5C2.5 10.1 2.9 10.5 3.5 10.5H5.5" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

export function CloseIcon({ size = 14, className = "" }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className} aria-hidden="true">
      <path d="M4 4L12 12M12 4L4 12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function MoreIcon({ size = 16, className = "" }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className} aria-hidden="true">
      <circle cx="3.5" cy="8" r="1.25" fill="currentColor" />
      <circle cx="8" cy="8" r="1.25" fill="currentColor" />
      <circle cx="12.5" cy="8" r="1.25" fill="currentColor" />
    </svg>
  );
}

export function FilterIcon({ size = 15, className = "" }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className} aria-hidden="true">
      <path d="M2.5 4.2H13.5M4.5 8H11.5M6.5 11.8H9.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export function MoveArrowsIcon({ size = 14, className = "" }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className} aria-hidden="true">
      <path d="M3 5.5H12.5M12.5 5.5L10 3M12.5 5.5L10 8M13 10.5H3.5M3.5 10.5L6 8M3.5 10.5L6 13" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ChevronLeftIcon({ size = 16, className = "" }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className} aria-hidden="true">
      <path d="M10 3.5L5.5 8L10 12.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ChevronRightIcon({ size = 14, className = "" }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className} aria-hidden="true">
      <path d="M6 3.5L10.5 8L6 12.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ChevronDownIcon({ size = 14, className = "" }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className} aria-hidden="true">
      <path d="M4 6L8 10L12 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ChevronUpIcon({ size = 14, className = "" }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className} aria-hidden="true">
      <path d="M4 10L8 6L12 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function EditPencilIcon({ size = 14, className = "" }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className} aria-hidden="true">
      <path d="M11.3 2.7L13.3 4.7L5.2 12.8H3.2V10.8L11.3 2.7Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  );
}

export function PlusIcon({ size = 16, className = "" }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className} aria-hidden="true">
      <path d="M8 3.2V12.8M3.2 8H12.8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
