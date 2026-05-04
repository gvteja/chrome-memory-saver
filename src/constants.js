export const ALARM_NAME = "auto-tab-memory-saver:sweep";
export const SETTINGS_KEY = "settings";
export const SESSION_STATE_KEY = "runtimeState";

export const DEFAULT_SETTINGS = {
  autoDiscardEnabled: true,
  discardAfterMinutes: 30,
  checkEveryMinutes: 1,
  onlyWhenSystemIdle: false,
  idleThresholdMinutes: 10,
  discardNewInactiveTabs: false,
  discardWhenHeapAboveMb: 0,
  skipPinned: true,
  skipAudible: true,
  skipMediaPlaying: true,
  skipPausedMedia: true,
  skipUnsavedForms: true,
  skipOfflinePages: true,
  skipNotificationPages: false,
  skipBatteryPower: false,
  skipAutoDiscardDisabled: true,
  closeOldDiscardedTabs: false,
  closeDiscardedAfterDays: 7,
  exceptionRules: [],
  forceRules: []
};

export const DEFAULT_RUNTIME_STATE = {
  lastActiveAt: {},
  pageStateByTabId: {},
  protectedTabIds: {},
  discardedAt: {},
  latestBatteryState: {
    available: false,
    charging: null,
    level: null,
    updatedAt: 0
  }
};

const NUMERIC_LIMITS = {
  discardAfterMinutes: { min: 1, max: 10080, fallback: 30 },
  checkEveryMinutes: { min: 1, max: 1440, fallback: 1 },
  idleThresholdMinutes: { min: 1, max: 240, fallback: 10 },
  discardWhenHeapAboveMb: { min: 0, max: 32768, fallback: 0 },
  closeDiscardedAfterDays: { min: 1, max: 3650, fallback: 7 }
};

const BOOLEAN_KEYS = [
  "autoDiscardEnabled",
  "onlyWhenSystemIdle",
  "discardNewInactiveTabs",
  "skipPinned",
  "skipAudible",
  "skipMediaPlaying",
  "skipPausedMedia",
  "skipUnsavedForms",
  "skipOfflinePages",
  "skipNotificationPages",
  "skipBatteryPower",
  "skipAutoDiscardDisabled",
  "closeOldDiscardedTabs"
];

export function normalizeSettings(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  const settings = { ...DEFAULT_SETTINGS };

  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      settings[key] = source[key];
    }
  }

  for (const [key, limit] of Object.entries(NUMERIC_LIMITS)) {
    const number = Number(settings[key]);
    const bounded = Number.isFinite(number) ? number : limit.fallback;
    settings[key] = Math.min(limit.max, Math.max(limit.min, bounded));
  }

  for (const key of BOOLEAN_KEYS) {
    settings[key] = Boolean(settings[key]);
  }

  settings.exceptionRules = normalizeRuleList(settings.exceptionRules);
  settings.forceRules = normalizeRuleList(settings.forceRules);

  return settings;
}

export function normalizeRuleList(value) {
  if (Array.isArray(value)) {
    return value
      .map((entry) => String(entry).trim())
      .filter((entry) => entry && !entry.startsWith("#"));
  }

  if (typeof value === "string") {
    return linesToRules(value);
  }

  return [];
}

export function linesToRules(value) {
  return String(value)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
}

export function rulesToLines(value) {
  return normalizeRuleList(value).join("\n");
}

export function getHostname(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

export function isDiscardableUrl(url) {
  if (!url) {
    return false;
  }

  try {
    const protocol = new URL(url).protocol;
    return protocol === "http:" || protocol === "https:" || protocol === "file:";
  } catch {
    return false;
  }
}

export function findMatchingRule(rules, url) {
  for (const rawRule of normalizeRuleList(rules)) {
    const parsed = parseRule(rawRule);
    if (ruleMatchesUrl(parsed.pattern, url)) {
      return parsed;
    }
  }

  return null;
}

export function parseRule(rawRule) {
  const text = String(rawRule).trim();
  const intervalMatch = text.match(/@(\d+(?:\.\d+)?)(mo|[mhdw])$/i);

  if (!intervalMatch) {
    return {
      raw: text,
      pattern: text,
      customMinutes: null
    };
  }

  return {
    raw: text,
    pattern: text.slice(0, intervalMatch.index).trim(),
    customMinutes: intervalToMinutes(Number(intervalMatch[1]), intervalMatch[2])
  };
}

export function ruleMatchesUrl(pattern, url) {
  const text = String(pattern || "").trim();
  if (!text || !url) {
    return false;
  }

  if (text.toLowerCase().startsWith("re:")) {
    try {
      return new RegExp(text.slice(3), "i").test(url);
    } catch {
      return false;
    }
  }

  const loweredUrl = String(url).toLowerCase();
  const loweredRule = text.toLowerCase();
  const hostname = getHostname(url).toLowerCase();

  if (loweredRule.includes("*")) {
    const regex = wildcardToRegExp(loweredRule);
    return regex.test(loweredUrl) || regex.test(hostname);
  }

  if (loweredRule.includes("/") || loweredRule.includes("?") || loweredRule.includes("#")) {
    return loweredUrl.includes(loweredRule);
  }

  return (
    hostname === loweredRule ||
    hostname.endsWith(`.${loweredRule}`) ||
    loweredUrl.includes(loweredRule)
  );
}

export function formatMinutes(minutes) {
  if (!Number.isFinite(minutes)) {
    return "unknown";
  }

  if (minutes < 1) {
    return "under 1 minute";
  }

  if (minutes < 60) {
    const rounded = Math.floor(minutes);
    return `${rounded} min`;
  }

  if (minutes < 1440) {
    const hours = Math.floor(minutes / 60);
    const mins = Math.floor(minutes % 60);
    return mins ? `${hours}h ${mins}m` : `${hours}h`;
  }

  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  return hours ? `${days}d ${hours}h` : `${days}d`;
}

function intervalToMinutes(amount, unit) {
  const normalizedUnit = String(unit).toLowerCase();

  if (normalizedUnit === "m") {
    return amount;
  }

  if (normalizedUnit === "h") {
    return amount * 60;
  }

  if (normalizedUnit === "d") {
    return amount * 1440;
  }

  if (normalizedUnit === "w") {
    return amount * 10080;
  }

  if (normalizedUnit === "mo") {
    return amount * 43200;
  }

  return null;
}

function wildcardToRegExp(pattern) {
  const escaped = pattern
    .split("*")
    .map((part) => part.replace(/[|\\{}()[\]^$+?.]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${escaped}$`, "i");
}
