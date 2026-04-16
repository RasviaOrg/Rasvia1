export type MenuTagConfig = {
  key: string;
  label: string;
  color: string;
  bg: string;
  border: string;
  enabled: boolean;
  position: number;
};

export const DEFAULT_MENU_TAGS: MenuTagConfig[] = [
  { key: "entree", label: "Entree", color: "#F97316", bg: "rgba(249,115,22,0.15)", border: "rgba(249,115,22,0.45)", enabled: true, position: 0 },
  { key: "appetizer", label: "Appetizer", color: "#22C55E", bg: "rgba(34,197,94,0.15)", border: "rgba(34,197,94,0.45)", enabled: true, position: 1 },
  { key: "main_course", label: "Main Course", color: "#818CF8", bg: "rgba(129,140,248,0.15)", border: "rgba(129,140,248,0.45)", enabled: true, position: 2 },
  { key: "specials", label: "Specials", color: "#F59E0B", bg: "rgba(245,158,11,0.15)", border: "rgba(245,158,11,0.45)", enabled: true, position: 3 },
  { key: "dessert", label: "Dessert", color: "#EC4899", bg: "rgba(236,72,153,0.15)", border: "rgba(236,72,153,0.45)", enabled: true, position: 4 },
  { key: "beverage", label: "Beverage", color: "#38BDF8", bg: "rgba(56,189,248,0.15)", border: "rgba(56,189,248,0.45)", enabled: true, position: 5 },
  { key: "sides", label: "Sides", color: "#94A3B8", bg: "rgba(148,163,184,0.15)", border: "rgba(148,163,184,0.45)", enabled: true, position: 6 },
];

const WEB_BG_TO_RGBA: Record<string, string> = {
  "bg-orange-500/10": "rgba(249,115,22,0.15)",
  "bg-emerald-500/10": "rgba(34,197,94,0.15)",
  "bg-indigo-500/10": "rgba(129,140,248,0.15)",
  "bg-amber-500/10": "rgba(245,158,11,0.15)",
  "bg-pink-500/10": "rgba(236,72,153,0.15)",
  "bg-sky-500/10": "rgba(56,189,248,0.15)",
  "bg-slate-500/10": "rgba(148,163,184,0.15)",
};

const WEB_BORDER_TO_RGBA: Record<string, string> = {
  "border-orange-500/30": "rgba(249,115,22,0.45)",
  "border-emerald-500/30": "rgba(34,197,94,0.45)",
  "border-indigo-500/30": "rgba(129,140,248,0.45)",
  "border-amber-500/30": "rgba(245,158,11,0.45)",
  "border-pink-500/30": "rgba(236,72,153,0.45)",
  "border-sky-500/30": "rgba(56,189,248,0.45)",
  "border-slate-500/30": "rgba(148,163,184,0.45)",
};

function coerceTagColorValue(raw: unknown, fallback: string, map: Record<string, string>): string {
  const value = String(raw ?? fallback).trim();
  if (!value) return fallback;
  return map[value] ?? value;
}

const LEGACY_KEY_MAP: Record<string, string> = {
  breakfast: "entree",
  lunch: "main_course",
  dinner: "main_course",
  specials: "specials",
  special: "specials",
  all_day: "main_course",
  all: "main_course",
};

export function slugifyTag(value: string): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 32);
}

function normalizeOneTag(raw: unknown, index: number): MenuTagConfig | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const key = slugifyTag(String(obj.key ?? obj.label ?? ""));
  const label = String(obj.label ?? "").trim();
  if (!key || !label) return null;
  return {
    key,
    label,
    color: String(obj.color ?? DEFAULT_MENU_TAGS[index % DEFAULT_MENU_TAGS.length].color),
    bg: coerceTagColorValue(obj.bg, DEFAULT_MENU_TAGS[index % DEFAULT_MENU_TAGS.length].bg, WEB_BG_TO_RGBA),
    border: coerceTagColorValue(obj.border, DEFAULT_MENU_TAGS[index % DEFAULT_MENU_TAGS.length].border, WEB_BORDER_TO_RGBA),
    enabled: obj.enabled !== false,
    position: Number.isFinite(Number(obj.position)) ? Number(obj.position) : index,
  };
}

export function parseRestaurantMenuTags(raw: unknown): MenuTagConfig[] {
  if (!Array.isArray(raw)) return DEFAULT_MENU_TAGS;
  const parsed = raw
    .map((entry, idx) => normalizeOneTag(entry, idx))
    .filter((t): t is MenuTagConfig => !!t)
    .sort((a, b) => a.position - b.position);
  return parsed.length > 0 ? parsed : DEFAULT_MENU_TAGS;
}

export function normalizeMenuItemTags(rawTags: string[] | null | undefined, availableTags: MenuTagConfig[]): string[] {
  const available = new Set(availableTags.map((t) => t.key));
  const seen = new Set<string>();
  const out: string[] = [];

  for (const raw of rawTags ?? []) {
    const legacy = LEGACY_KEY_MAP[String(raw).trim().toLowerCase()] ?? slugifyTag(String(raw));
    if (!legacy || seen.has(legacy)) continue;
    if (!available.has(legacy)) {
      // If item has legacy/custom key not in config, still keep it so data isn't lost.
      out.push(legacy);
      seen.add(legacy);
      continue;
    }
    out.push(legacy);
    seen.add(legacy);
  }

  return out;
}

export function ensureKnownTags(rawTags: string[] | null | undefined, availableTags: MenuTagConfig[]): string[] {
  const normalized = normalizeMenuItemTags(rawTags, availableTags);
  if (normalized.length > 0) return normalized;
  const fallback = availableTags.find((t) => t.enabled)?.key ?? availableTags[0]?.key ?? "main_course";
  return fallback ? [fallback] : [];
}

export function serializeMenuTags(tags: MenuTagConfig[]): MenuTagConfig[] {
  return tags.map((t, idx) => ({ ...t, key: slugifyTag(t.key || t.label), position: idx }));
}
