import {
  ALARM_NAME,
  DEFAULT_RUNTIME_STATE,
  DEFAULT_SETTINGS,
  SESSION_STATE_KEY,
  SETTINGS_KEY,
  findMatchingRule,
  formatMinutes,
  getHostname,
  isDiscardableUrl,
  normalizeSettings
} from "./constants.js";

const MENU = {
  discardWindow: "discard-window",
  forceDiscardWindow: "force-discard-window",
  discardHighlighted: "discard-highlighted",
  forceDiscardHighlighted: "force-discard-highlighted",
  discardCurrentGroup: "discard-current-group",
  forceDiscardCurrentGroup: "force-discard-current-group",
  reloadDiscardedWindow: "reload-discarded-window",
  toggleAuto: "toggle-auto-discard",
  protectSite: "protect-site",
  openOptions: "open-options"
};

const MANUAL_SOURCE = {
  manual: true,
  ignoreAge: true
};

function isTabUnloaded(tab) {
  return Boolean(tab?.discarded) || tab?.status === "unloaded";
}

void boot();

chrome.runtime.onInstalled.addListener(() => {
  void boot();
});

chrome.runtime.onStartup.addListener(() => {
  void boot();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    void runMaintenance({ source: "alarm" });
  }
});

chrome.tabs.onActivated.addListener((activeInfo) => {
  void markTabActive(activeInfo.tabId);
});

chrome.tabs.onCreated.addListener((tab) => {
  void handleTabCreated(tab);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  void handleTabUpdated(tabId, changeInfo, tab);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void removeTabState(tabId);
});

chrome.tabs.onReplaced.addListener((addedTabId, removedTabId) => {
  void replaceTabState(addedTabId, removedTabId);
});

chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId !== chrome.windows.WINDOW_ID_NONE) {
    void markFocusedWindowTab(windowId);
  }
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  void handleMenuClick(info, tab);
});

chrome.commands.onCommand.addListener((command) => {
  void handleCommand(command);
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "sync" && changes[SETTINGS_KEY]) {
    const settings = normalizeSettings(changes[SETTINGS_KEY].newValue);
    void ensureAlarm(settings);
    void createMenus(settings);
    void updateActionStatus();
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then((payload) => sendResponse({ ok: true, ...payload }))
    .catch((error) => sendResponse({ ok: false, error: errorMessage(error) }));
  return true;
});

async function boot() {
  await chrome.storage.session.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" }).catch(() => {});
  const settings = await getSettings();
  await initializeTabs({ injectContent: true });
  await createMenus(settings);
  await ensureAlarm(settings);
  await updateActionStatus();
}

async function handleMessage(message, sender) {
  if (!message || typeof message !== "object") {
    throw new Error("Invalid message");
  }

  switch (message.type) {
    case "PAGE_STATE":
      await updatePageState(sender.tab?.id, message.state || {});
      return {};

    case "GET_POPUP_DATA":
      return getPopupData(message);

    case "GET_OPTIONS_DATA":
      return { settings: await getSettings() };

    case "SAVE_SETTINGS":
      return { settings: await saveSettings(message.settings || {}) };

    case "RESET_SETTINGS":
      return { settings: await saveSettings(DEFAULT_SETTINGS) };

    case "TOGGLE_TAB_PROTECTION":
      return toggleTabProtection(message.tabId);

    case "TOGGLE_SITE_EXCEPTION":
      return toggleSiteException(message.url);

    case "DISCARD_TAB":
      return discardSingleTab(message.tabId, { force: Boolean(message.force) });

    case "DISCARD_TABS":
      return discardSpecificTabs(message.tabIds, { force: Boolean(message.force) });

    case "DISCARD_HIGHLIGHTED":
      return discardHighlightedTabs(message.windowId, { force: Boolean(message.force) });

    case "DISCARD_GROUP":
      return discardGroup(message.groupId, message.windowId, { force: Boolean(message.force) });

    case "HIGHLIGHT_TABS":
      return highlightTabs(message.tabIds, message.windowId);

    case "DISCARD_WINDOW":
      return discardWindow(message.windowId, {
        ...MANUAL_SOURCE,
        force: Boolean(message.force)
      });

    case "DISCARD_ALL_WINDOWS":
      return discardWindow(null, {
        ...MANUAL_SOURCE,
        force: Boolean(message.force)
      });

    case "RELOAD_TAB":
      return reloadTab(message.tabId);

    case "RELOAD_DISCARDED":
      return reloadDiscardedTabs(message.windowId);

    case "RUN_MAINTENANCE":
      return runMaintenance({ source: "manual", manual: true });

    case "EXPORT_SETTINGS":
      return { json: JSON.stringify(await getSettings(), null, 2) };

    case "IMPORT_SETTINGS":
      return { settings: await saveSettings(message.settings || {}) };

    default:
      throw new Error(`Unknown message type: ${message.type}`);
  }
}

async function getSettings() {
  const stored = await chrome.storage.sync.get({ [SETTINGS_KEY]: DEFAULT_SETTINGS });
  return normalizeSettings(stored[SETTINGS_KEY]);
}

async function saveSettings(nextSettings) {
  const settings = normalizeSettings(nextSettings);
  await chrome.storage.sync.set({ [SETTINGS_KEY]: settings });
  await ensureAlarm(settings);
  await createMenus(settings);
  await updateActionStatus();
  return settings;
}

async function patchSettings(patch) {
  const settings = await getSettings();
  return saveSettings({ ...settings, ...patch });
}

async function getRuntimeState() {
  const stored = await chrome.storage.session.get({ [SESSION_STATE_KEY]: DEFAULT_RUNTIME_STATE });
  return normalizeRuntimeState(stored[SESSION_STATE_KEY]);
}

async function setRuntimeState(state) {
  await chrome.storage.session.set({ [SESSION_STATE_KEY]: normalizeRuntimeState(state) });
}

async function updateRuntimeState(mutator) {
  const state = await getRuntimeState();
  const nextState = mutator(clone(state)) || state;
  await setRuntimeState(nextState);
  return normalizeRuntimeState(nextState);
}

function normalizeRuntimeState(value) {
  const state = value && typeof value === "object" ? value : {};
  return {
    lastActiveAt: objectOrEmpty(state.lastActiveAt),
    pageStateByTabId: objectOrEmpty(state.pageStateByTabId),
    protectedTabIds: objectOrEmpty(state.protectedTabIds),
    discardedAt: objectOrEmpty(state.discardedAt),
    latestBatteryState: {
      ...DEFAULT_RUNTIME_STATE.latestBatteryState,
      ...(state.latestBatteryState && typeof state.latestBatteryState === "object"
        ? state.latestBatteryState
        : {})
    }
  };
}

async function initializeTabs(options = {}) {
  const tabs = await chrome.tabs.query({});
  const now = Date.now();
  const liveIds = new Set(tabs.map((tab) => String(tab.id)));

  await updateRuntimeState((state) => {
    for (const tab of tabs) {
      const tabId = String(tab.id);
      if (!state.lastActiveAt[tabId] || tab.active) {
        state.lastActiveAt[tabId] = tab.lastAccessed || now;
      }

      if (isTabUnloaded(tab) && !state.discardedAt[tabId]) {
        state.discardedAt[tabId] = now;
      }
    }

    pruneObjectToIds(state.lastActiveAt, liveIds);
    pruneObjectToIds(state.pageStateByTabId, liveIds);
    pruneObjectToIds(state.protectedTabIds, liveIds);
    pruneObjectToIds(state.discardedAt, liveIds);
    return state;
  });

  if (options.injectContent) {
    await Promise.allSettled(tabs.map((tab) => injectContentScript(tab)));
  }
}

async function ensureAlarm(settings = null) {
  const currentSettings = settings || (await getSettings());

  if (!currentSettings.autoDiscardEnabled && !currentSettings.closeOldDiscardedTabs) {
    await chrome.alarms.clear(ALARM_NAME);
    return;
  }

  const periodInMinutes = Math.max(1, currentSettings.checkEveryMinutes);
  await chrome.alarms.create(ALARM_NAME, {
    delayInMinutes: periodInMinutes,
    periodInMinutes
  });
}

async function createMenus(settings = null) {
  const currentSettings = settings || (await getSettings());
  await new Promise((resolve) => chrome.contextMenus.removeAll(resolve));

  chrome.contextMenus.create({
    id: MENU.discardWindow,
    title: "Discard eligible tabs in this window",
    contexts: ["action"]
  });
  chrome.contextMenus.create({
    id: MENU.forceDiscardWindow,
    title: "Force-discard tabs in this window",
    contexts: ["action"]
  });
  chrome.contextMenus.create({
    id: MENU.discardHighlighted,
    title: "Discard selected tabs",
    contexts: ["action"]
  });
  chrome.contextMenus.create({
    id: MENU.forceDiscardHighlighted,
    title: "Force-discard selected tabs",
    contexts: ["action"]
  });
  chrome.contextMenus.create({
    id: MENU.discardCurrentGroup,
    title: "Discard current tab group",
    contexts: ["action"]
  });
  chrome.contextMenus.create({
    id: MENU.forceDiscardCurrentGroup,
    title: "Force-discard current tab group",
    contexts: ["action"]
  });
  chrome.contextMenus.create({
    id: MENU.reloadDiscardedWindow,
    title: "Reload discarded tabs in this window",
    contexts: ["action"]
  });
  chrome.contextMenus.create({
    id: "separator-1",
    type: "separator",
    contexts: ["action"]
  });
  chrome.contextMenus.create({
    id: MENU.toggleAuto,
    title: "Automatic discarding",
    type: "checkbox",
    checked: currentSettings.autoDiscardEnabled,
    contexts: ["action"]
  });
  chrome.contextMenus.create({
    id: MENU.openOptions,
    title: "Options",
    contexts: ["action"]
  });
  chrome.contextMenus.create({
    id: MENU.protectSite,
    title: "Never discard this site",
    contexts: ["page"]
  });
}

async function handleMenuClick(info, tab) {
  const targetTab = tab || await getLastFocusedTab();

  switch (info.menuItemId) {
    case MENU.discardWindow:
      await discardWindow(targetTab?.windowId, MANUAL_SOURCE);
      break;

    case MENU.forceDiscardWindow:
      await discardWindow(targetTab?.windowId, { ...MANUAL_SOURCE, force: true });
      break;

    case MENU.discardHighlighted:
      await discardHighlightedTabs(targetTab?.windowId, MANUAL_SOURCE);
      break;

    case MENU.forceDiscardHighlighted:
      await discardHighlightedTabs(targetTab?.windowId, { ...MANUAL_SOURCE, force: true });
      break;

    case MENU.discardCurrentGroup:
      await discardGroup(targetTab?.groupId, targetTab?.windowId, MANUAL_SOURCE);
      break;

    case MENU.forceDiscardCurrentGroup:
      await discardGroup(targetTab?.groupId, targetTab?.windowId, { ...MANUAL_SOURCE, force: true });
      break;

    case MENU.reloadDiscardedWindow:
      await reloadDiscardedTabs(targetTab?.windowId);
      break;

    case MENU.toggleAuto:
      await patchSettings({ autoDiscardEnabled: Boolean(info.checked) });
      break;

    case MENU.protectSite:
      await toggleSiteException(targetTab?.url);
      break;

    case MENU.openOptions:
      await chrome.runtime.openOptionsPage();
      break;
  }
}

async function getLastFocusedTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab || null;
}

async function handleCommand(command) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (command === "discard-inactive-tabs") {
    await discardWindow(tab?.windowId, MANUAL_SOURCE);
  }

  if (command === "reload-discarded-tabs") {
    await reloadDiscardedTabs(tab?.windowId);
  }
}

async function handleTabCreated(tab) {
  await markTabActive(tab.id, tab.lastAccessed || Date.now());
  const settings = await getSettings();

  if (!settings.discardNewInactiveTabs || tab.active) {
    return;
  }

  setTimeout(() => {
    void discardSingleTab(tab.id, { source: "new-tab", ignoreAge: true });
  }, 5000);
}

async function handleTabUpdated(tabId, changeInfo, tab) {
  if (changeInfo.url) {
    await updateRuntimeState((state) => {
      const id = String(tabId);
      state.pageStateByTabId[id] = {};
      state.lastActiveAt[id] = Date.now();
      delete state.discardedAt[id];
      return state;
    });
  }

  if (tab?.active && !isTabUnloaded(tab)) {
    await markTabActive(tabId);
  }

  if (changeInfo.status === "complete") {
    await injectContentScript(tab);
  }

  if (changeInfo.discarded === false && !isTabUnloaded(tab)) {
    await updateRuntimeState((state) => {
      delete state.discardedAt[String(tabId)];
      return state;
    });
  }

  await updateActionStatus();
}

async function injectContentScript(tab) {
  if (!tab?.id || isTabUnloaded(tab) || !isDiscardableUrl(tab.url)) {
    return;
  }

  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ["src/content.js"]
  }).catch(() => {});
}

async function markFocusedWindowTab(windowId) {
  const [tab] = await chrome.tabs.query({ active: true, windowId });
  if (tab?.id) {
    await markTabActive(tab.id);
  }
}

async function markTabActive(tabId, timestamp = Date.now()) {
  if (!Number.isInteger(tabId)) {
    return;
  }

  await updateRuntimeState((state) => {
    const id = String(tabId);
    state.lastActiveAt[id] = timestamp;
    delete state.discardedAt[id];
    return state;
  });

  await updateActionStatus();
}

async function removeTabState(tabId) {
  await updateRuntimeState((state) => {
    const id = String(tabId);
    delete state.lastActiveAt[id];
    delete state.pageStateByTabId[id];
    delete state.protectedTabIds[id];
    delete state.discardedAt[id];
    return state;
  });

  await updateActionStatus();
}

async function replaceTabState(addedTabId, removedTabId) {
  await updateRuntimeState((state) => {
    const oldId = String(removedTabId);
    const newId = String(addedTabId);

    for (const key of ["lastActiveAt", "pageStateByTabId", "protectedTabIds", "discardedAt"]) {
      if (state[key][oldId]) {
        state[key][newId] = state[key][oldId];
        delete state[key][oldId];
      }
    }

    return state;
  });
}

async function updatePageState(tabId, pageState) {
  if (!Number.isInteger(tabId)) {
    return;
  }

  await updateRuntimeState((state) => {
    const id = String(tabId);
    state.pageStateByTabId[id] = {
      ...state.pageStateByTabId[id],
      ...sanitizePageState(pageState),
      updatedAt: Date.now()
    };

    if (pageState?.battery && pageState.battery.available) {
      state.latestBatteryState = {
        available: true,
        charging: pageState.battery.charging,
        level: pageState.battery.level,
        updatedAt: Date.now()
      };
    }

    return state;
  });
}

async function getPopupData(message) {
  const settings = await getSettings();
  const runtimeState = await getRuntimeState();
  const tabs = await chrome.tabs.query(getPopupTabsQuery(message));
  const [groupsById, memorySnapshot] = await Promise.all([
    getGroupsById(tabs),
    getMemorySnapshot(tabs, runtimeState)
  ]);
  const describedTabs = tabs.map((tab) => describeTab(
    tab,
    settings,
    runtimeState,
    groupsById,
    memorySnapshot.byTabId[String(tab.id)]
  ));
  const discardedCount = describedTabs.filter((tab) => tab.discarded).length;
  const activeTab = describedTabs.find((tab) => tab.id === message.activeTabId) ||
    describedTabs.find((tab) => tab.active) ||
    null;

  return {
    settings,
    activeTab,
    tabs: describedTabs,
    groups: summarizeGroups(describedTabs, groupsById),
    summary: {
      totalTabs: describedTabs.length,
      discardedTabs: discardedCount,
      protectedTabs: Object.keys(runtimeState.protectedTabIds).length,
      eligibleTabs: describedTabs.filter((tab) => tab.manualEligible).length,
      selectedChromeTabs: describedTabs.filter((tab) => tab.highlighted).length,
      memory: {
        source: memorySnapshot.source,
        available: memorySnapshot.available,
        unavailableReason: memorySnapshot.unavailableReason,
        observedTabBytes: memorySnapshot.observedTabBytes,
        reportingTabs: memorySnapshot.reportingTabs,
        loadedTabs: describedTabs.filter((tab) => !tab.discarded).length,
        discardedTabs: discardedCount
      },
      battery: runtimeState.latestBatteryState
    }
  };
}

function getPopupTabsQuery(message) {
  if (message.allWindows) {
    return {};
  }

  return Number.isInteger(message.windowId)
    ? { windowId: message.windowId }
    : { currentWindow: true };
}

async function getGroupsById(tabs) {
  const groupIds = [...new Set(tabs
    .map((tab) => tab.groupId)
    .filter((groupId) => Number.isInteger(groupId) && groupId >= 0))];
  const groupsById = {};

  if (!groupIds.length || !chrome.tabGroups?.get) {
    return groupsById;
  }

  await Promise.all(groupIds.map(async (groupId) => {
    try {
      const group = await chrome.tabGroups.get(groupId);
      groupsById[String(groupId)] = {
        id: group.id,
        title: group.title || `Group ${group.id}`,
        color: group.color || "grey",
        collapsed: Boolean(group.collapsed)
      };
    } catch {
      groupsById[String(groupId)] = {
        id: groupId,
        title: `Group ${groupId}`,
        color: "grey",
        collapsed: false
      };
    }
  }));

  return groupsById;
}

function summarizeGroups(tabs, groupsById) {
  const summaries = new Map();

  for (const tab of tabs) {
    if (!Number.isInteger(tab.groupId) || tab.groupId < 0) {
      continue;
    }

    const key = String(tab.groupId);
    const existing = summaries.get(key) || {
      ...(groupsById[key] || {
        id: tab.groupId,
        title: `Group ${tab.groupId}`,
        color: "grey",
        collapsed: false
      }),
      tabCount: 0,
      discardedCount: 0,
      eligibleCount: 0,
      readyCount: 0,
      blockedReasons: {},
      active: false
    };

    existing.tabCount += 1;
    existing.discardedCount += tab.discarded ? 1 : 0;
    existing.eligibleCount += tab.manualEligible ? 1 : 0;
    existing.readyCount += tab.ready ? 1 : 0;
    if (!tab.manualEligible && !tab.discarded) {
      const reason = tab.manualReason || tab.reason || "Not discardable";
      existing.blockedReasons[reason] = (existing.blockedReasons[reason] || 0) + 1;
    }
    existing.active = existing.active || tab.active;
    summaries.set(key, existing);
  }

  return [...summaries.values()].sort((a, b) => a.id - b.id);
}

async function getMemorySnapshot(tabs, runtimeState) {
  const byTabId = {};

  for (const tab of tabs) {
    const pageState = runtimeState.pageStateByTabId[String(tab.id)] || {};
    const bytes = Number(pageState.jsHeapBytes) || 0;

    byTabId[String(tab.id)] = {
      bytes,
      processBytes: bytes,
      sharedCount: 1,
      source: bytes ? "js-heap" : "unavailable"
    };
  }

  return {
    source: "jsHeap",
    available: Object.values(byTabId).some((memory) => memory.bytes > 0),
    unavailableReason: "",
    observedTabBytes: Object.values(byTabId).reduce((total, memory) => total + memory.bytes, 0),
    reportingTabs: Object.values(byTabId).filter((memory) => memory.bytes > 0).length,
    byTabId
  };
}

async function toggleTabProtection(tabId) {
  if (!Number.isInteger(tabId)) {
    throw new Error("No tab selected");
  }

  const tab = await chrome.tabs.get(tabId);
  const runtimeState = await updateRuntimeState((state) => {
    const id = String(tabId);

    if (state.protectedTabIds[id]) {
      delete state.protectedTabIds[id];
    } else {
      state.protectedTabIds[id] = {
        title: tab.title || "",
        url: tab.url || "",
        createdAt: Date.now()
      };
    }

    return state;
  });

  await updateActionStatus();
  return { protected: Boolean(runtimeState.protectedTabIds[String(tabId)]) };
}

async function toggleSiteException(url) {
  const hostname = getHostname(url);
  if (!hostname) {
    throw new Error("This page does not have a site hostname");
  }

  const settings = await getSettings();
  const hasRule = settings.exceptionRules.some((rule) => rule.toLowerCase() === hostname.toLowerCase());
  const exceptionRules = hasRule
    ? settings.exceptionRules.filter((rule) => rule.toLowerCase() !== hostname.toLowerCase())
    : [...settings.exceptionRules, hostname].sort();
  const saved = await saveSettings({ ...settings, exceptionRules });
  return { protected: !hasRule, settings: saved };
}

async function runMaintenance(options = {}) {
  const settings = await getSettings();
  await initializeTabs();
  await closeExpiredDiscardedTabs(settings);

  if (!settings.autoDiscardEnabled && !options.manual) {
    await updateActionStatus();
    return { skipped: true, reason: "Automatic discarding is paused" };
  }

  if (!options.manual) {
    const pauseReason = await getAutomaticPauseReason(settings);
    if (pauseReason) {
      await updateActionStatus();
      return { skipped: true, reason: pauseReason };
    }
  }

  const result = await discardWindow(null, {
    source: options.source || "maintenance",
    manual: Boolean(options.manual),
    ignoreAge: Boolean(options.manual)
  });
  await updateActionStatus();
  return result;
}

async function getAutomaticPauseReason(settings) {
  if (settings.skipBatteryPower) {
    const runtimeState = await getRuntimeState();
    const battery = runtimeState.latestBatteryState;
    const fresh = battery.updatedAt && Date.now() - battery.updatedAt < 10 * 60 * 1000;

    if (fresh && battery.available && battery.charging === false) {
      return "Computer appears to be on battery power";
    }
  }

  return "";
}

async function closeExpiredDiscardedTabs(settings) {
  const tabs = await chrome.tabs.query({});
  const now = Date.now();
  const maxAge = settings.closeDiscardedAfterDays * 24 * 60 * 60 * 1000;
  const runtimeState = await getRuntimeState();
  const idsToClose = [];

  for (const tab of tabs) {
    const id = String(tab.id);
    if (isTabUnloaded(tab) && !runtimeState.discardedAt[id]) {
      runtimeState.discardedAt[id] = now;
    }

    if (
      settings.closeOldDiscardedTabs &&
      isTabUnloaded(tab) &&
      runtimeState.discardedAt[id] &&
      now - runtimeState.discardedAt[id] >= maxAge
    ) {
      idsToClose.push(tab.id);
    }
  }

  await setRuntimeState(runtimeState);

  for (const tabId of idsToClose) {
    await chrome.tabs.remove(tabId).catch(() => {});
    await removeTabState(tabId);
  }
}

async function discardWindow(windowId, options = {}) {
  const settings = await getSettings();
  const runtimeState = await getRuntimeState();
  const query = Number.isInteger(windowId) ? { windowId } : {};
  const tabs = await chrome.tabs.query(query);
  const decisions = tabs.map((tab) => buildDecision(tab, settings, runtimeState, options));
  const candidates = decisions
    .filter((decision) => decision.eligible && decision.ready)
    .sort((a, b) => a.lastActiveAt - b.lastActiveAt);
  const discarded = [];
  const failed = [];

  for (const decision of candidates) {
    const result = await tryDiscardTab(decision.tab, options);
    if (result.discarded) {
      discarded.push(result.tabId);
    } else {
      failed.push({ tabId: decision.tab.id, reason: result.reason });
    }
  }

  await updateRuntimeState((state) => {
    const timestamp = Date.now();
    for (const tabId of discarded) {
      state.discardedAt[String(tabId)] = timestamp;
    }
    return state;
  });
  await updateActionStatus();

  return {
    scanned: tabs.length,
    candidates: candidates.length,
    discarded: discarded.length,
    failed
  };
}

async function discardHighlightedTabs(windowId, options = {}) {
  const query = Number.isInteger(windowId)
    ? { windowId, highlighted: true }
    : { lastFocusedWindow: true, highlighted: true };
  const tabs = await chrome.tabs.query(query);
  return discardSpecificTabs(tabs.map((tab) => tab.id), options);
}

async function discardGroup(groupId, windowId, options = {}) {
  if (!Number.isInteger(groupId) || groupId < 0) {
    throw new Error("Current tab is not in a tab group");
  }

  const query = Number.isInteger(windowId)
    ? { windowId, groupId }
    : { groupId };
  const tabs = await chrome.tabs.query(query);
  return discardSpecificTabs(tabs.map((tab) => tab.id), options);
}

async function highlightTabs(tabIds, windowId) {
  const uniqueTabIds = [...new Set((Array.isArray(tabIds) ? tabIds : [])
    .map((tabId) => Number(tabId))
    .filter((tabId) => Number.isInteger(tabId)))];

  if (!uniqueTabIds.length) {
    return { highlighted: 0 };
  }

  const tabs = (await Promise.all(uniqueTabIds.map((tabId) => (
    chrome.tabs.get(tabId).catch(() => null)
  )))).filter((tab) => tab && !isTabUnloaded(tab));
  const targetWindowId = Number.isInteger(windowId)
    ? windowId
    : tabs[0]?.windowId;

  if (!Number.isInteger(targetWindowId)) {
    return { highlighted: 0 };
  }

  const indexes = tabs
    .filter((tab) => tab.windowId === targetWindowId)
    .map((tab) => tab.index)
    .sort((a, b) => a - b);

  if (!indexes.length) {
    return { highlighted: 0 };
  }

  await chrome.tabs.highlight({
    windowId: targetWindowId,
    tabs: indexes
  });

  return { highlighted: indexes.length };
}

async function discardSpecificTabs(tabIds, options = {}) {
  const uniqueTabIds = [...new Set((Array.isArray(tabIds) ? tabIds : [])
    .map((tabId) => Number(tabId))
    .filter((tabId) => Number.isInteger(tabId)))];

  if (!uniqueTabIds.length) {
    return {
      scanned: 0,
      candidates: 0,
      discarded: 0,
      skipped: 0,
      failed: []
    };
  }

  const [settings, runtimeState] = await Promise.all([
    getSettings(),
    getRuntimeState()
  ]);
  const tabs = (await Promise.all(uniqueTabIds.map((tabId) => (
    chrome.tabs.get(tabId).catch(() => null)
  )))).filter(Boolean);
  const missingCount = uniqueTabIds.length - tabs.length;
  const discarded = [];
  const failed = [];
  let candidates = 0;

  for (const tab of tabs) {
    const decision = buildDecision(tab, settings, runtimeState, {
      ignoreAge: true,
      force: Boolean(options.force)
    });

    if (!decision.eligible) {
      failed.push({ tabId: tab.id, reason: decision.reason });
      continue;
    }

    candidates += 1;
    const result = await tryDiscardTab(tab, options);
    if (result.discarded) {
      discarded.push(result.tabId);
    } else {
      failed.push({ tabId: tab.id, reason: result.reason });
    }
  }

  await updateRuntimeState((state) => {
    const timestamp = Date.now();
    for (const tabId of discarded) {
      state.discardedAt[String(tabId)] = timestamp;
    }
    return state;
  });
  await updateActionStatus();

  return {
    scanned: uniqueTabIds.length,
    candidates,
    discarded: discarded.length,
    skipped: missingCount,
    failed
  };
}

async function discardSingleTab(tabId, options = {}) {
  if (!Number.isInteger(tabId)) {
    throw new Error("No tab selected");
  }

  const [settings, runtimeState, tab] = await Promise.all([
    getSettings(),
    getRuntimeState(),
    chrome.tabs.get(tabId)
  ]);
  const decision = buildDecision(tab, settings, runtimeState, {
    ignoreAge: true,
    force: Boolean(options.force)
  });

  if (!decision.eligible) {
    return {
      discarded: false,
      reason: decision.reason
    };
  }

  const result = await tryDiscardTab(tab, options);

  if (result.discarded) {
    await updateRuntimeState((state) => {
      state.discardedAt[String(tabId)] = Date.now();
      return state;
    });
  }

  await updateActionStatus();
  return result;
}

async function tryDiscardTab(tab, options = {}) {
  if (!tab?.id) {
    return { discarded: false, reason: "Missing tab" };
  }

  try {
    if (options.force && tab.autoDiscardable === false) {
      await chrome.tabs.update(tab.id, { autoDiscardable: true }).catch(() => null);
    }

    const discardedTab = await chrome.tabs.discard(tab.id);
    const updated = discardedTab?.id ? discardedTab : await chrome.tabs.get(tab.id).catch(() => null);

    if (isTabUnloaded(updated)) {
      return { discarded: true, tabId: tab.id };
    }

    return { discarded: false, tabId: tab.id, reason: "Chrome did not discard this tab" };
  } catch (error) {
    return { discarded: false, tabId: tab.id, reason: errorMessage(error) };
  }
}

async function reloadTab(tabId) {
  if (!Number.isInteger(tabId)) {
    throw new Error("No tab selected");
  }

  await chrome.tabs.reload(tabId);
  await updateRuntimeState((state) => {
    delete state.discardedAt[String(tabId)];
    state.lastActiveAt[String(tabId)] = Date.now();
    return state;
  });
  await updateActionStatus();
  return { reloaded: 1 };
}

async function reloadDiscardedTabs(windowId) {
  const query = Number.isInteger(windowId) ? { windowId } : {};
  const tabs = await chrome.tabs.query(query);
  const discardedTabs = tabs.filter((tab) => isTabUnloaded(tab));
  let reloaded = 0;

  for (const tab of discardedTabs) {
    await chrome.tabs.reload(tab.id).then(() => {
      reloaded += 1;
    }).catch(() => {});
  }

  await updateRuntimeState((state) => {
    const timestamp = Date.now();
    for (const tab of discardedTabs) {
      delete state.discardedAt[String(tab.id)];
      state.lastActiveAt[String(tab.id)] = timestamp;
    }
    return state;
  });
  await updateActionStatus();

  return { reloaded };
}

function describeTab(tab, settings, runtimeState, groupsById = {}, memory = null) {
  const decision = buildDecision(tab, settings, runtimeState);
  const manualDecision = buildDecision(tab, settings, runtimeState, { ignoreAge: true });
  const forceDecision = buildDecision(tab, settings, runtimeState, { ignoreAge: true, force: true });
  const pageState = runtimeState.pageStateByTabId[String(tab.id)] || {};
  const groupId = Number.isInteger(tab.groupId) ? tab.groupId : -1;
  const group = groupId >= 0 ? groupsById[String(groupId)] || null : null;

  return {
    id: tab.id,
    windowId: tab.windowId,
    index: tab.index,
    title: tab.title || tab.url || "Untitled tab",
    url: tab.url || "",
    hostname: getHostname(tab.url),
    highlighted: Boolean(tab.highlighted),
    active: Boolean(tab.active),
    pinned: Boolean(tab.pinned),
    audible: Boolean(tab.audible),
    groupId,
    group,
    discarded: isTabUnloaded(tab),
    autoDiscardable: tab.autoDiscardable !== false,
    protected: Boolean(runtimeState.protectedTabIds[String(tab.id)]),
    eligible: decision.eligible,
    ready: decision.ready,
    reason: decision.reason,
    manualEligible: manualDecision.eligible,
    manualReason: manualDecision.reason,
    forceEligible: forceDecision.eligible,
    forceReason: forceDecision.reason,
    ageMinutes: decision.ageMinutes,
    ageLabel: formatMinutes(decision.ageMinutes),
    lastActiveAt: decision.lastActiveAt,
    memory: {
      bytes: Number(memory?.bytes) || 0,
      processBytes: Number(memory?.processBytes) || 0,
      sharedCount: Number(memory?.sharedCount) || 1,
      source: memory?.source || "unavailable"
    },
    pageState: {
      hasDirtyForms: Boolean(pageState.hasDirtyForms),
      mediaPlaying: Boolean(pageState.mediaPlaying),
      mediaPaused: Boolean(pageState.mediaPaused),
      notificationsGranted: Boolean(pageState.notificationsGranted),
      online: pageState.online !== false,
      jsHeapBytes: Number(pageState.jsHeapBytes) || 0,
      updatedAt: Number(pageState.updatedAt) || 0
    }
  };
}

function buildDecision(tab, settings, runtimeState, options = {}) {
  const now = Date.now();
  const tabId = String(tab.id);
  const pageState = runtimeState.pageStateByTabId[tabId] || {};
  const lastActiveAt = getLastActiveAt(tab, runtimeState, now);
  const ageMinutes = Math.max(0, (now - lastActiveAt) / 60000);
  const exceptionRule = options.force ? null : findMatchingRule(settings.exceptionRules, tab.url);
  const forceRule = findMatchingRule(settings.forceRules, tab.url);
  const bypassProtections = Boolean(options.force || forceRule);
  const thresholdMinutes = forceRule?.customMinutes || settings.discardAfterMinutes;
  const heapThresholdBytes = settings.discardWhenHeapAboveMb * 1024 * 1024;
  const heapReady = heapThresholdBytes > 0 && Number(pageState.jsHeapBytes) >= heapThresholdBytes;
  const oldEnough = Boolean(options.ignoreAge) || ageMinutes >= thresholdMinutes;
  const ready = oldEnough || heapReady;
  const base = {
    tab,
    eligible: false,
    ready: false,
    reason: "",
    ageMinutes,
    lastActiveAt,
    thresholdMinutes,
    forceMatched: Boolean(forceRule),
    heapReady
  };

  if (!Number.isInteger(tab.id)) {
    return { ...base, reason: "Missing tab ID" };
  }

  if (tab.active) {
    return { ...base, reason: "Active tab" };
  }

  if (isTabUnloaded(tab)) {
    return { ...base, reason: "Already discarded" };
  }

  if (!isDiscardableUrl(tab.url)) {
    return { ...base, reason: "Unsupported URL" };
  }

  if (exceptionRule) {
    return { ...base, reason: `Site exception: ${exceptionRule.pattern}` };
  }

  if (!bypassProtections) {
    const protectionReason = getProtectionReason(tab, settings, runtimeState, pageState);
    if (protectionReason) {
      return { ...base, reason: protectionReason };
    }
  }

  if (!ready) {
    return {
      ...base,
      eligible: true,
      ready: false,
      reason: `Inactive for ${formatMinutes(ageMinutes)} of ${formatMinutes(thresholdMinutes)}`
    };
  }

  return {
    ...base,
    eligible: true,
    ready: true,
    reason: heapReady
      ? `JS heap over ${settings.discardWhenHeapAboveMb} MB`
      : `Inactive for ${formatMinutes(ageMinutes)}`
  };
}

function getProtectionReason(tab, settings, runtimeState, pageState) {
  const tabId = String(tab.id);

  if (runtimeState.protectedTabIds[tabId]) {
    return "Protected tab";
  }

  if (settings.skipPinned && tab.pinned) {
    return "Pinned tab";
  }

  if (settings.skipAudible && tab.audible) {
    return "Audible tab";
  }

  if (settings.skipAutoDiscardDisabled && tab.autoDiscardable === false) {
    return "Chrome auto-discard disabled";
  }

  if (settings.skipMediaPlaying && pageState.mediaPlaying) {
    return "Media is playing";
  }

  if (settings.skipPausedMedia && pageState.mediaPaused) {
    return "Paused media";
  }

  if (settings.skipUnsavedForms && pageState.hasDirtyForms) {
    return "Unsaved form changes";
  }

  if (settings.skipOfflinePages && pageState.online === false) {
    return "Page reports offline";
  }

  if (settings.skipNotificationPages && pageState.notificationsGranted) {
    return "Notifications allowed";
  }

  return "";
}

function getLastActiveAt(tab, runtimeState, now) {
  const stored = Number(runtimeState.lastActiveAt[String(tab.id)]);

  if (Number.isFinite(stored) && stored > 0) {
    return stored;
  }

  if (Number.isFinite(tab.lastAccessed) && tab.lastAccessed > 0) {
    return tab.lastAccessed;
  }

  return now;
}

async function updateActionStatus() {
  const [settings, runtimeState, tabs, activeTabs] = await Promise.all([
    getSettings(),
    getRuntimeState(),
    chrome.tabs.query({}),
    chrome.tabs.query({ active: true, lastFocusedWindow: true })
  ]);
  const activeTab = activeTabs[0] || null;
  const loadedCount = tabs.filter((tab) => !isTabUnloaded(tab)).length;
  const badgeText = settings.autoDiscardEnabled
    ? (loadedCount ? String(loadedCount) : "")
    : "off";

  await chrome.action.setBadgeBackgroundColor({ color: settings.autoDiscardEnabled ? "#356d8f" : "#72777f" });
  await chrome.action.setBadgeText({ text: badgeText });

  const decision = activeTab
    ? describeTab(activeTab, settings, runtimeState)
    : null;
  const title = [
    "Auto Tab Memory Saver",
    settings.autoDiscardEnabled ? "Automatic discarding is on" : "Automatic discarding is paused",
    settings.autoDiscardEnabled ? `Badge: ${loadedCount} loaded tabs across all windows` : "",
    decision ? `Current tab: ${decision.reason}` : ""
  ].filter(Boolean).join("\n");

  await chrome.action.setTitle({ title });
}

function sanitizePageState(pageState) {
  return {
    hasDirtyForms: Boolean(pageState.hasDirtyForms),
    mediaPlaying: Boolean(pageState.mediaPlaying),
    mediaPaused: Boolean(pageState.mediaPaused),
    notificationsGranted: Boolean(pageState.notificationsGranted),
    online: pageState.online !== false,
    jsHeapBytes: Number(pageState.jsHeapBytes) || 0,
    battery: pageState.battery && typeof pageState.battery === "object"
      ? {
          available: Boolean(pageState.battery.available),
          charging: pageState.battery.charging === null ? null : Boolean(pageState.battery.charging),
          level: Number.isFinite(Number(pageState.battery.level)) ? Number(pageState.battery.level) : null
        }
      : null
  };
}

function objectOrEmpty(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function pruneObjectToIds(object, ids) {
  for (const key of Object.keys(object)) {
    if (!ids.has(key)) {
      delete object[key];
    }
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function errorMessage(error) {
  if (error?.message) {
    return error.message;
  }

  if (chrome.runtime.lastError?.message) {
    return chrome.runtime.lastError.message;
  }

  return String(error || "Unknown error");
}
