"use client";

import { useState, type CSSProperties, type ReactNode } from "react";
import {
  ALargeSmall,
  AtSign,
  Ban,
  ArrowUpDown,
  Bell,
  Calendar,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ClipboardPaste,
  CircleStop,
  CircleUserRound,
  Clock,
  Copy,
  Download,
  Eye,
  Expand,
  File,
  FileText,
  Folder,
  Globe,
  Grid3x3,
  House,
  Image,
  Import,
  Info,
  Key,
  Laptop,
  Link2,
  Lock,
  Mail,
  Menu,
  Minus,
  Moon,
  MoreHorizontal,
  Pause,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Save,
  Search,
  Settings,
  Share2,
  Shield,
  Scissors,
  SlidersHorizontal,
  Star,
  Sun,
  Timer,
  Trash2,
  TriangleAlert,
  Upload,
  UserCheck,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import type { DriveItem, LocalIconName, Palette } from "@/features/file/model";
import { getItemExtensionIconName, getItemKind, itemColor, kindIcons } from "@/features/file/model";

export type LocalIconProps = {
  color?: string;
  decorative?: boolean;
  label?: string;
  name: LocalIconName;
  size?: number;
  style?: CSSProperties;
};

const unavailableExtensionIconNames = new Set<string>();

const iconByName: Record<LocalIconName, LucideIcon> = {
  abc: ALargeSmall,
  arrow_down: ChevronDown,
  arrow_left: ChevronLeft,
  arrow_right: ChevronRight,
  arrow_up: ChevronUp,
  ban: Ban,
  calendar: Calendar,
  clock: Clock,
  copy: Copy,
  cut: Scissors,
  cross: X,
  dark_mode: Moon,
  document: FileText,
  download: Download,
  earth: Globe,
  exclamation: TriangleAlert,
  file: File,
  folder: Folder,
  grid: Grid3x3,
  house: House,
  image: Image,
  import: Import,
  info: Info,
  key: Key,
  laptop: Laptop,
  link: Link2,
  lock: Lock,
  mail: Mail,
  mention: AtSign,
  menu: Menu,
  menu7: MoreHorizontal,
  minus: Minus,
  notification: Bell,
  pause: Pause,
  paste: ClipboardPaste,
  pencil: Pencil,
  play: Play,
  plus: Plus,
  refresh: RefreshCw,
  save: Save,
  search: Search,
  settings: Settings,
  share2: Share2,
  shield: Shield,
  slider: SlidersHorizontal,
  sort: ArrowUpDown,
  star: Star,
  stop: CircleStop,
  sun: Sun,
  tick: Check,
  time: Timer,
  trash: Trash2,
  upload: Upload,
  user_check: UserCheck,
  user_group: Users,
  user_avatar: CircleUserRound,
  visible: Eye,
  expand: Expand,
};

export function LocalIcon({
  color,
  decorative = true,
  label,
  name,
  size = 20,
  style,
}: LocalIconProps) {
  const Icon = iconByName[name] ?? File;

  return (
    <span
      aria-hidden={decorative ? true : undefined}
      aria-label={!decorative ? label : undefined}
      role={!decorative ? "img" : undefined}
      style={{
        alignItems: "center",
        color: color ?? "currentColor",
        display: "inline-flex",
        flexShrink: 0,
        height: size,
        justifyContent: "center",
        lineHeight: 0,
        width: size,
        ...style,
      }}
    >
      <Icon aria-hidden="true" focusable="false" size={size} strokeWidth={2} />
    </span>
  );
}

export function ItemIcon({
  item,
  palette,
  size = 20,
}: {
  item: DriveItem;
  palette: Palette;
  size?: number;
}) {
  const fallback = <LocalIcon name={kindIcons[getItemKind(item)]} size={size} color={itemColor(item, palette)} />;

  return (
    <ExtensionIcon item={item} fallback={fallback} size={size} />
  );
}

export function ExtensionIcon({
  className,
  fallback,
  item,
  size = 20,
}: {
  className?: string;
  fallback?: ReactNode;
  item: DriveItem;
  size?: number;
}) {
  const iconName = getItemExtensionIconName(item);
  const [failedIconName, setFailedIconName] = useState<string | null>(null);

  if (!iconName || failedIconName === iconName || unavailableExtensionIconNames.has(iconName)) {
    return fallback ?? null;
  }

  return (
    <span
      aria-hidden="true"
      className={className ? `icedr-ext-icon ${className}` : "icedr-ext-icon"}
      style={{ height: size, width: size }}
    >
      <img
        alt=""
        draggable={false}
        onError={() => {
          unavailableExtensionIconNames.add(iconName);
          setFailedIconName(iconName);
        }}
        src={getExtensionIconSrc(iconName)}
      />
    </span>
  );
}

function getExtensionIconSrc(iconName: string) {
  const base = import.meta.env.BASE_URL || "/";
  return `${base.endsWith("/") ? base : `${base}/`}ext-icon/${encodeURIComponent(iconName)}.png`;
}

export function AnimatedCheckMark({
  durationMs = 460,
  size = 13,
  strokeWidth = 2.4,
}: {
  durationMs?: number;
  size?: number;
  strokeWidth?: number;
}) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width={size}
      height={size}
      viewBox="0 0 20 20"
      style={{ display: "block", flexShrink: 0 } as CSSProperties}
    >
      <path
        d="M4.5 10.4L8.1 14L15.8 6.2"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={strokeWidth}
        strokeDasharray="18"
        strokeDashoffset="18"
      >
        <animate
          attributeName="stroke-dashoffset"
          from="18"
          to="0"
          dur={`${durationMs}ms`}
          fill="freeze"
          calcMode="spline"
          keyTimes="0;1"
          keySplines="0.22 0.72 0.18 1"
        />
      </path>
    </svg>
  );
}
