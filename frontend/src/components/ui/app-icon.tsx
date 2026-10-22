"use client";

import { type CSSProperties, type ReactNode } from "react";
import {
  AlertTriangle,
  AtSign,
  Ban,
  Bell,
  Calendar,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  CircleInfo,
  ClipboardImport,
  Clock,
  Copy,
  Download,
  Earth,
  Envelope,
  Eye,
  EyeOff,
  File,
  FileText,
  Folder,
  Grid,
  House,
  History,
  Image,
  Import,
  Key,
  Laptop,
  Link,
  List,
  Lock,
  Logout,
  Maximize,
  Menu,
  Minus,
  Moon,
  MoreH,
  Pause,
  Pen,
  Play,
  Plus,
  Plug,
  Power,
  Refresh,
  Save,
  Scissors,
  Search,
  Send,
  Settings,
  Share,
  Shield,
  Sliders,
  Sort,
  Star,
  StopCircle,
  Sun,
  Text,
  Timer,
  Trash,
  Undo,
  Upload,
  UserCheck,
  UserCircle,
  Users,
  X,
  type IconComponent,
} from "reicon-react";
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

const extensionIcons: Record<string, LocalIconName> = {
  folder: "folder", markdown: "document", txt: "document", pdf: "document", docx: "document",
  xls: "grid", xlsx: "grid", jpg: "image", png: "image", svg: "image",
  avi: "play", m4v: "play", mp4: "play", mpeg: "play", mpg: "play", wav: "play",
  "7zip": "file", "7z": "file", zip: "file", rar: "file", deb: "file", exe: "file", msi: "file", rom: "file", ttf: "abc",
};

const iconByName: Record<LocalIconName, IconComponent> = {
  abc: Text,
  arrow_down: ChevronDown,
  arrow_left: ChevronLeft,
  arrow_right: ChevronRight,
  arrow_up: ChevronUp,
  ban: Ban,
  calendar: Calendar,
  clock: Clock,
  connection: Plug,
  copy: Copy,
  cut: Scissors,
  cross: X,
  dark_mode: Moon,
  document: FileText,
  download: Download,
  earth: Earth,
  eye_off: EyeOff,
  exclamation: AlertTriangle,
  file: File,
  folder: Folder,
  grid: Grid,
  house: House,
  image: Image,
  import: Import,
  info: CircleInfo,
  key: Key,
  laptop: Laptop,
  link: Link,
  list: List,
  lock: Lock,
  logout: Logout,
  mail: Envelope,
  mention: AtSign,
  menu: Menu,
  menu7: MoreH,
  minus: Minus,
  notification: Bell,
  pause: Pause,
  paste: ClipboardImport,
  pencil: Pen,
  play: Play,
  plus: Plus,
  power: Power,
  refresh: Refresh,
  restore: History,
  save: Save,
  search: Search,
  send: Send,
  settings: Settings,
  share2: Share,
  shield: Shield,
  slider: Sliders,
  sort: Sort,
  star: Star,
  stop: StopCircle,
  sun: Sun,
  tick: Check,
  time: Timer,
  trash: Trash,
  undo: Undo,
  upload: Upload,
  user_check: UserCheck,
  user_group: Users,
  user_avatar: UserCircle,
  visible: Eye,
  expand: Maximize,
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
      <Icon
        aria-hidden="true"
        focusable="false"
        size={size}
        strokeWidth={1.75}
        weight="Outline"
      />
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
  return <ExtensionIcon item={item} color={itemColor(item, palette)} size={size} />;
}

export function ExtensionIcon({
  className,
  color,
  fallback,
  item,
  size = 20,
}: {
  className?: string;
  color?: string;
  fallback?: ReactNode;
  item: DriveItem;
  size?: number;
}) {
  const iconName = getItemExtensionIconName(item);
  const name = extensionIcons[iconName];

  return (
    <span
      aria-hidden="true"
      className={className ? `icedr-ext-icon ${className}` : "icedr-ext-icon"}
      style={{ color, height: size, width: size }}
    >
      {!name && fallback ? fallback : <LocalIcon name={name ?? kindIcons[getItemKind(item)]} size={size} />}
    </span>
  );
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
