import { normalizeSettings } from "../src/constants.js";

const els = {
  autoDiscardEnabled: document.querySelector("#autoDiscardEnabled"),
  openOptions: document.querySelector("#openOptions"),
  summaryText: document.querySelector("#summaryText"),
  currentHost: document.querySelector("#currentHost"),
  currentReason: document.querySelector("#currentReason"),
  toggleTabProtection: document.querySelector("#toggleTabProtection"),
  toggleSiteException: document.querySelector("#toggleSiteException"),
  discardWindow: document.querySelector("#discardWindow"),
  forceDiscardWindow: document.querySelector("#forceDiscardWindow"),
  reloadDiscarded: document.querySelector("#reloadDiscarded"),
  tabSearch: document.querySelector("#tabSearch"),
  sortTabs: document.querySelector("#sortTabs"),
  loadedOnlyFilter: document.querySelector("#loadedOnlyFilter"),
  selectMatching: document.querySelector("#selectMatching"),
  clearSelection: document.querySelector("#clearSelection"),
  discardChecked: document.querySelector("#discardChecked"),
  forceDiscardChecked: document.querySelector("#forceDiscardChecked"),
  highlightChecked: document.querySelector("#highlightChecked"),
  discardHighlighted: document.querySelector("#discardHighlighted"),
  forceDiscardHighlighted: document.querySelector("#forceDiscardHighlighted"),
  discardCurrentGroup: document.querySelector("#discardCurrentGroup"),
  forceDiscardCurrentGroup: document.querySelector("#forceDiscardCurrentGroup"),
  selectionSummary: document.querySelector("#selectionSummary"),
  memorySource: document.querySelector("#memorySource"),
  memoryBreakdown: document.querySelector("#memoryBreakdown"),
  status: document.querySelector("#status"),
  eligibleCount: document.querySelector("#eligibleCount"),
  tabsList: document.querySelector("#tabsList")
};

let popupData = null;
let searchTerm = "";
let sortMode = "position";
let loadedOnly = true;
const selectedTabIds = new Set();
let visibleTabsCache = [];

document.addEventListener("DOMContentLoaded", () => {
  loadedOnly = els.loadedOnlyFilter.checked;
  bindEvents();
  void loadPopupData();
});

function bindEvents() {
  els.autoDiscardEnabled.addEventListener("change", () => savePopupSettings());
  els.openOptions.addEventListener("click", () => chrome.runtime.openOptionsPage());
  els.toggleTabProtection.addEventListener("click", () => toggleTabProtection());
  els.toggleSiteException.addEventListener("click", () => toggleSiteException());
  els.discardWindow.addEventListener("click", () => discardWindow(false));
  els.forceDiscardWindow.addEventListener("click", () => discardWindow(true));
  els.reloadDiscarded.addEventListener("click", () => reloadDiscarded());
  els.tabSearch.addEventListener("input", () => {
    searchTerm = els.tabSearch.value.trim().toLowerCase();
    renderTabArea();
  });
  els.sortTabs.addEventListener("change", () => {
    sortMode = els.sortTabs.value;
    renderTabArea();
  });
  els.loadedOnlyFilter.addEventListener("change", () => {
    loadedOnly = els.loadedOnlyFilter.checked;
    renderTabArea();
  });
  els.selectMatching.addEventListener("click", () => selectMatchingTabs());
  els.clearSelection.addEventListener("click", () => clearSelection());
  els.discardChecked.addEventListener("click", () => discardCheckedTabs());
  els.forceDiscardChecked.addEventListener("click", () => discardCheckedTabs(true));
  els.highlightChecked.addEventListener("click", () => highlightCheckedTabs());
  els.discardHighlighted.addEventListener("click", () => discardHighlightedTabs());
  els.forceDiscardHighlighted.addEventListener("click", () => discardHighlightedTabs(true));
  els.discardCurrentGroup.addEventListener("click", () => discardCurrentGroup());
  els.forceDiscardCurrentGroup.addEventListener("click", () => discardCurrentGroup(true));
  els.tabsList.addEventListener("click", (event) => handleTabAction(event));
  els.tabsList.addEventListener("change", (event) => handleTabSelection(event));
}

async function loadPopupData(options = {}) {
  const showLoading = options.showLoading !== false;
  const clearStatus = options.clearStatus !== false;

  try {
    if (showLoading) {
      setStatus("Loading...");
    }

    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const response = await sendMessage({
      type: "GET_POPUP_DATA",
      activeTabId: activeTab?.id,
      windowId: activeTab?.windowId
    });
    popupData = response;
    pruneSelection();
    render(response);
    if (clearStatus) {
      setStatus("");
    }
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function refreshPopupData() {
  await loadPopupData({ showLoading: false, clearStatus: false });
}

function render(data) {
  const settings = normalizeSettings(data.settings);
  const discarded = data.summary.discardedTabs;
  const total = data.summary.totalTabs;

  els.autoDiscardEnabled.checked = settings.autoDiscardEnabled;
  els.summaryText.textContent = `${total} tabs, ${discarded} discarded, ${selectedTabIds.size} checked`;

  renderCurrentTab(data.activeTab);
  renderMemoryStatus(data.summary.memory);
  renderTabArea();
}

function renderCurrentTab(tab) {
  if (!tab) {
    els.currentHost.textContent = "No current tab";
    els.currentReason.textContent = "";
    els.toggleTabProtection.disabled = true;
    els.toggleSiteException.disabled = true;
    els.discardCurrentGroup.disabled = true;
    els.forceDiscardCurrentGroup.disabled = true;
    return;
  }

  els.currentHost.textContent = tab.hostname || "This page";
  els.currentReason.textContent = tab.discarded ? "Discarded" : tab.reason;
  els.toggleTabProtection.textContent = tab.protected ? "Unprotect tab" : "Protect tab";
  els.toggleSiteException.textContent = hasSiteException(tab) ? "Unprotect site" : "Protect site";
  els.discardCurrentGroup.textContent = tab.group ? "Discard group" : "No group";
  els.toggleTabProtection.disabled = tab.discarded;
  els.toggleSiteException.disabled = !tab.hostname;
  els.discardCurrentGroup.disabled = !tab.group || tab.discarded;
  els.forceDiscardCurrentGroup.disabled = !tab.group || tab.discarded;
}

function renderMemoryStatus(memory) {
  els.memoryBreakdown.replaceChildren();
  const observedTabBytes = Number(memory?.observedTabBytes) || 0;
  const reportingTabs = Number(memory?.reportingTabs) || 0;
  const loadedTabs = Number(memory?.loadedTabs) || 0;

  if (memory?.available) {
    els.memorySource.textContent = "Memory: measured tab JavaScript heap only";
  } else {
    els.memorySource.textContent = memory?.unavailableReason
      ? `Memory: unavailable (${memory.unavailableReason})`
      : "Memory: unavailable";
  }

  els.memoryBreakdown.append(
    createMemoryMetric("Observed heap", formatBytes(observedTabBytes)),
    createMemoryMetric("Tabs reporting", `${reportingTabs} / ${loadedTabs}`)
  );
}

function createMemoryMetric(label, value) {
  const item = document.createElement("div");
  item.className = "memory-metric";

  const labelEl = document.createElement("span");
  labelEl.textContent = label;

  const valueEl = document.createElement("strong");
  valueEl.textContent = value;
  valueEl.title = value;

  item.append(labelEl, valueEl);
  return item;
}

function renderTabArea() {
  if (!popupData) {
    return;
  }

  const visibleTabs = getVisibleTabs();
  visibleTabsCache = visibleTabs;
  els.summaryText.textContent = `${popupData.summary.totalTabs} tabs, ${popupData.summary.discardedTabs} discarded, ${selectedTabIds.size} checked`;
  els.eligibleCount.textContent = `${visibleTabs.length} shown, ${countVisibleEligibleTabs(visibleTabs)} eligible`;
  renderTabSections(visibleTabs);
  renderSelectionState();
}

function renderSelectionState() {
  if (!popupData) {
    return;
  }

  visibleTabsCache = visibleTabsCache.length ? visibleTabsCache : getVisibleTabs();
  els.summaryText.textContent = `${popupData.summary.totalTabs} tabs, ${popupData.summary.discardedTabs} discarded, ${selectedTabIds.size} checked`;
  renderSelectionSummary();
  updateBulkControls(visibleTabsCache);
}

function renderSelectionSummary() {
  const checkedStats = getCheckedSelectionStats();
  const chromeStats = getChromeSelectionStats();
  const showChromeStats = chromeStats.count > 1;
  els.selectionSummary.replaceChildren();
  els.selectionSummary.hidden = checkedStats.count === 0 && !showChromeStats;

  if (els.selectionSummary.hidden) {
    return;
  }

  if (checkedStats.count) {
    els.selectionSummary.append(createSelectionSection(
      `${checkedStats.count} checked ${checkedStats.count === 1 ? "tab" : "tabs"}`,
      checkedStats
    ));
  }

  if (showChromeStats) {
    els.selectionSummary.append(createSelectionSection(
      `${chromeStats.count} Chrome-selected tabs`,
      chromeStats
    ));
  }
}

function createSelectionSection(titleText, stats) {
  const section = document.createElement("div");
  section.className = "selection-section";

  const title = document.createElement("div");
  title.className = "selection-title";
  title.textContent = titleText;

  const metrics = document.createElement("div");
  metrics.className = "selection-metrics";
  metrics.append(
    createSelectionMetric("Discardable", String(stats.manualEligible)),
    createSelectionMetric("Force discardable", String(stats.forceEligible)),
    createSelectionMetric("Blocked", String(stats.blocked)),
    createSelectionMetric("Discarded", String(stats.discarded)),
    createSelectionMetric("Observed heap", formatBytes(stats.memoryBytes))
  );

  section.append(title, metrics);
  return section;
}

function createSelectionMetric(label, value) {
  const item = document.createElement("div");
  item.className = "selection-metric";

  const labelEl = document.createElement("span");
  labelEl.textContent = label;

  const valueEl = document.createElement("strong");
  valueEl.textContent = value;
  valueEl.title = value;

  item.append(labelEl, valueEl);
  return item;
}

function renderTabSections(tabs) {
  if (!tabs.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = getEmptyTabsText();
    els.tabsList.replaceChildren(empty);
    return;
  }

  const sections = buildTabSections(tabs);
  els.tabsList.replaceChildren(...sections.map((section) => createTabSection(section)));
}

function buildTabSections(tabs) {
  const sections = [];
  const pinnedTabs = tabs.filter((tab) => tab.pinned);
  const groupedSections = new Map();
  const ungroupedTabs = [];

  tabs.forEach((tab, order) => {
    if (tab.pinned) {
      return;
    }

    if (tab.group) {
      const key = String(tab.groupId);
      const existing = groupedSections.get(key) || {
        type: "group",
        title: tab.group.title || `Group ${tab.groupId}`,
        color: tab.group.color || "grey",
        tabs: [],
        firstOrder: order
      };
      existing.tabs.push(tab);
      existing.firstOrder = Math.min(existing.firstOrder, order);
      groupedSections.set(key, existing);
    } else {
      ungroupedTabs.push(tab);
    }
  });

  if (pinnedTabs.length) {
    sections.push({
      type: "pinned",
      title: "Pinned tabs",
      tabs: pinnedTabs,
      firstOrder: 0
    });
  }

  sections.push(...[...groupedSections.values()]
    .sort((a, b) => a.firstOrder - b.firstOrder || a.title.localeCompare(b.title)));

  if (ungroupedTabs.length) {
    sections.push({
      type: "ungrouped",
      title: "Ungrouped tabs",
      tabs: ungroupedTabs,
      firstOrder: 0
    });
  }

  return sections;
}

function createTabSection(section) {
  const sectionEl = document.createElement("section");
  sectionEl.className = `tab-list-section ${section.type}`;

  const header = document.createElement("div");
  header.className = "tab-list-section-header";

  const titleWrap = document.createElement("div");
  titleWrap.className = "tab-list-section-title";

  if (section.type === "group") {
    const color = document.createElement("span");
    color.className = `group-color group-${section.color || "grey"}`;
    titleWrap.append(color);
  }

  const title = document.createElement("h3");
  title.textContent = section.title;
  title.title = section.title;

  titleWrap.append(title);

  const summary = document.createElement("span");
  summary.className = "tab-list-section-summary";
  summary.textContent = getTabSectionSummary(section.tabs);
  summary.title = summary.textContent;

  const rows = document.createElement("div");
  rows.className = "tab-list-section-tabs";
  rows.replaceChildren(...section.tabs.map((tab) => createTabRow(tab)));

  header.append(titleWrap, summary);
  sectionEl.append(header, rows);
  return sectionEl;
}

function createTabRow(tab) {
  const row = document.createElement("div");
  row.className = [
    "tab-row",
    tab.discarded ? "discarded" : "loaded",
    tab.active ? "active" : "",
    tab.highlighted ? "highlighted" : "",
    selectedTabIds.has(tab.id) ? "checked" : ""
  ].filter(Boolean).join(" ");

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.className = "tab-select";
  checkbox.dataset.selectTabId = String(tab.id);
  checkbox.checked = selectedTabIds.has(tab.id);
  checkbox.disabled = tab.active || tab.discarded;
  checkbox.title = tab.active
    ? "Active tabs cannot be discarded"
    : tab.discarded ? "Already discarded" : "Select tab";

  const main = document.createElement("div");
  main.className = "tab-main";

  const title = document.createElement("div");
  title.className = "tab-title";
  title.textContent = tab.title;
  title.title = tab.title;

  const meta = document.createElement("div");
  meta.className = "tab-meta";
  meta.textContent = getTabMeta(tab);
  meta.title = meta.textContent;

  main.append(title, meta);

  const memory = document.createElement("div");
  memory.className = "tab-memory";
  memory.textContent = formatMemoryLabel(tab);
  memory.title = formatMemoryTitle(tab);

  const button = document.createElement("button");
  button.type = "button";
  button.className = tab.discarded ? "tab-action" : "tab-action quiet";
  button.dataset.tabId = String(tab.id);

  if (tab.discarded) {
    button.dataset.action = "reload";
    button.textContent = "Reload";
  } else {
    button.dataset.action = "discard";
    button.textContent = "Discard";
    button.disabled = tab.active || !tab.manualEligible;
    button.title = tab.active ? "Active tabs cannot be discarded" : tab.manualReason;
  }

  row.append(checkbox, main, memory, button);
  return row;
}

function getTabSectionSummary(tabs) {
  const loadedCount = tabs.filter((tab) => !tab.discarded).length;
  const discardedCount = tabs.length - loadedCount;
  const eligibleCount = countVisibleEligibleTabs(tabs);
  const checkedCount = tabs.filter((tab) => selectedTabIds.has(tab.id)).length;
  const parts = [
    `${tabs.length} shown`,
    `${loadedCount} loaded`
  ];

  if (discardedCount) {
    parts.push(`${discardedCount} discarded`);
  }

  parts.push(`${eligibleCount} eligible`);

  if (checkedCount) {
    parts.push(`${checkedCount} checked`);
  }

  return parts.join(", ");
}

function getVisibleTabs() {
  const tabs = [...(popupData?.tabs || [])];
  const filtered = tabs.filter((tab) => {
    if (loadedOnly && tab.discarded) {
      return false;
    }

    return !searchTerm || tabMatchesSearch(tab, searchTerm);
  });

  return filtered.sort((a, b) => {
    if (sortMode === "memory") {
      return getMemoryBytes(b) - getMemoryBytes(a) || a.index - b.index;
    }

    if (sortMode === "lastAccessed") {
      return Number(a.lastActiveAt) - Number(b.lastActiveAt) || a.index - b.index;
    }

    return a.index - b.index;
  });
}

function countVisibleEligibleTabs(tabs) {
  return tabs.filter((tab) => tab.manualEligible).length;
}

function getEmptyTabsText() {
  if (loadedOnly && searchTerm) {
    return "No matching loaded tabs";
  }

  if (loadedOnly) {
    return "No loaded tabs";
  }

  return "No matching tabs";
}

function tabMatchesSearch(tab, term) {
  return [
    tab.title,
    tab.url,
    tab.hostname,
    tab.group?.title
  ].some((value) => String(value || "").toLowerCase().includes(term));
}

function selectMatchingTabs() {
  const visibleTabs = visibleTabsCache.length ? visibleTabsCache : getVisibleTabs();
  for (const tab of visibleTabs) {
    if (!tab.active && !tab.discarded) {
      selectedTabIds.add(tab.id);
    }
  }

  syncVisibleSelectionRows();
  renderSelectionState();
}

function clearSelection() {
  selectedTabIds.clear();
  syncVisibleSelectionRows();
  renderSelectionState();
}

async function discardCheckedTabs(force = false) {
  const tabIds = [...selectedTabIds];
  if (!tabIds.length) {
    return;
  }

  try {
    const response = await sendMessage({ type: "DISCARD_TABS", tabIds, force });
    selectedTabIds.clear();
    setBulkStatus(response);
    await refreshPopupData();
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function highlightCheckedTabs() {
  const tabIds = [...selectedTabIds];
  if (!tabIds.length) {
    return;
  }

  try {
    const response = await sendMessage({
      type: "HIGHLIGHT_TABS",
      tabIds,
      windowId: popupData?.activeTab?.windowId
    });
    setStatus(`Highlighted ${response.highlighted || 0} tabs`);
    await refreshPopupData();
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function discardHighlightedTabs(force = false) {
  const tab = popupData?.activeTab;

  try {
    const response = await sendMessage({
      type: "DISCARD_HIGHLIGHTED",
      windowId: tab?.windowId,
      force
    });
    setBulkStatus(response);
    await refreshPopupData();
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function discardCurrentGroup(force = false) {
  const tab = popupData?.activeTab;
  if (!tab?.group) {
    return;
  }

  try {
    const response = await sendMessage({
      type: "DISCARD_GROUP",
      windowId: tab.windowId,
      groupId: tab.groupId,
      force
    });
    setBulkStatus(response);
    await refreshPopupData();
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function savePopupSettings() {
  if (!popupData) {
    return;
  }

  const settings = normalizeSettings({
    ...popupData.settings,
    autoDiscardEnabled: els.autoDiscardEnabled.checked
  });

  try {
    await sendMessage({ type: "SAVE_SETTINGS", settings });
    setStatus("Settings saved");
    await refreshPopupData();
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function toggleTabProtection() {
  const tab = popupData?.activeTab;
  if (!tab) {
    return;
  }

  try {
    const response = await sendMessage({ type: "TOGGLE_TAB_PROTECTION", tabId: tab.id });
    setStatus(response.protected ? "Tab protected" : "Tab unprotected");
    await refreshPopupData();
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function toggleSiteException() {
  const tab = popupData?.activeTab;
  if (!tab) {
    return;
  }

  try {
    const response = await sendMessage({ type: "TOGGLE_SITE_EXCEPTION", url: tab.url });
    setStatus(response.protected ? "Site protected" : "Site unprotected");
    await refreshPopupData();
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function discardWindow(force) {
  const tab = popupData?.activeTab;
  const impact = getWindowDiscardImpact(force);

  if (!confirmDiscardWindow(force, impact)) {
    return;
  }

  try {
    const response = await sendMessage({
      type: "DISCARD_WINDOW",
      windowId: tab?.windowId,
      force
    });
    setBulkStatus(response);
    await refreshPopupData();
  } catch (error) {
    setStatus(error.message, true);
  }
}

function getWindowDiscardImpact(force) {
  const tabs = popupData?.tabs || [];
  const eligibleCount = tabs.filter((tab) => (
    force ? tab.forceEligible : tab.manualEligible
  )).length;

  return {
    count: eligibleCount,
    eligibleCount
  };
}

function confirmDiscardWindow(force, impact) {
  if (!impact.count) {
    setStatus(getNoWindowDiscardMessage(force, impact));
    return false;
  }

  const lines = force
    ? [
        `Force discard ${impact.count} ${pluralize(impact.count, "tab")} in this window?`,
        "",
        "This bypasses extension protections where Chrome allows it.",
        "Discarded tabs stay in the tab strip and reload when activated."
      ]
    : [
        `Discard ${impact.count} eligible ${pluralize(impact.count, "tab")} in this window?`,
        "",
        `${impact.eligibleCount} ${pluralize(impact.eligibleCount, "tab")} currently ${impact.eligibleCount === 1 ? "matches" : "match"} the eligible-tab rules.`,
        "Discarded tabs stay in the tab strip and reload when activated."
      ];

  return window.confirm(lines.join("\n"));
}

function getNoWindowDiscardMessage(force, impact) {
  if (force) {
    return "No loaded tabs can be force discarded";
  }

  return "No eligible tabs to discard";
}

async function reloadDiscarded() {
  const tab = popupData?.activeTab;

  try {
    const response = await sendMessage({
      type: "RELOAD_DISCARDED",
      windowId: tab?.windowId
    });
    setStatus(`Reloaded ${response.reloaded} tabs`);
    await refreshPopupData();
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function handleTabAction(event) {
  const button = event.target.closest("button[data-tab-id]");
  if (!button) {
    return;
  }

  const tabId = Number(button.dataset.tabId);
  const action = button.dataset.action;

  try {
    if (action === "reload") {
      await sendMessage({ type: "RELOAD_TAB", tabId });
      setStatus("Tab reloaded");
    } else {
      const response = await sendMessage({ type: "DISCARD_TAB", tabId });
      setStatus(response.discarded ? "Tab discarded" : response.reason);
    }

    await refreshPopupData();
  } catch (error) {
    setStatus(error.message, true);
  }
}

function handleTabSelection(event) {
  const checkbox = event.target.closest("input[data-select-tab-id]");
  if (!checkbox) {
    return;
  }

  const tabId = Number(checkbox.dataset.selectTabId);
  if (checkbox.checked) {
    selectedTabIds.add(tabId);
  } else {
    selectedTabIds.delete(tabId);
  }

  checkbox.closest(".tab-row")?.classList.toggle("checked", checkbox.checked);
  renderSelectionState();
}

function syncVisibleSelectionRows() {
  for (const checkbox of els.tabsList.querySelectorAll("input[data-select-tab-id]")) {
    const tabId = Number(checkbox.dataset.selectTabId);
    const checked = selectedTabIds.has(tabId);
    checkbox.checked = checked;
    checkbox.closest(".tab-row")?.classList.toggle("checked", checked);
  }
}

function updateBulkControls(visibleTabs) {
  const selectableCount = visibleTabs.filter((tab) => !tab.active && !tab.discarded).length;
  const highlightedCount = popupData?.summary?.selectedChromeTabs || 0;
  const selection = getCheckedSelectionStats();

  els.selectMatching.disabled = selectableCount === 0;
  els.clearSelection.disabled = selection.count === 0;
  els.discardChecked.disabled = selection.manualEligible === 0;
  els.forceDiscardChecked.disabled = selection.forceEligible === 0;
  els.highlightChecked.disabled = selection.count === 0;
  els.discardHighlighted.disabled = highlightedCount <= 1;
  els.forceDiscardHighlighted.disabled = highlightedCount <= 1;
  els.discardChecked.textContent = selection.count
    ? `Discard checked (${selection.manualEligible})`
    : "Discard checked";
  els.forceDiscardChecked.textContent = selection.count
    ? `Force checked (${selection.forceEligible})`
    : "Force checked";
  els.discardHighlighted.textContent = highlightedCount > 1
    ? `Discard Chrome selection (${highlightedCount})`
    : "Discard Chrome selection";
  els.forceDiscardHighlighted.textContent = highlightedCount > 1
    ? `Force selection (${highlightedCount})`
    : "Force selection";
}

function getCheckedSelectionStats() {
  const selectedTabs = (popupData?.tabs || [])
    .filter((tab) => selectedTabIds.has(tab.id));
  return getSelectionStats(selectedTabs);
}

function getChromeSelectionStats() {
  const selectedTabs = (popupData?.tabs || [])
    .filter((tab) => tab.highlighted);
  return getSelectionStats(selectedTabs);
}

function getSelectionStats(selectedTabs) {
  const discarded = selectedTabs.filter((tab) => tab.discarded).length;
  const manualEligible = selectedTabs.filter((tab) => tab.manualEligible).length;
  const forceEligible = selectedTabs.filter((tab) => tab.forceEligible).length;

  return {
    count: selectedTabs.length,
    manualEligible,
    forceEligible,
    discarded,
    blocked: Math.max(0, selectedTabs.length - manualEligible - discarded),
    memoryBytes: selectedTabs.reduce((total, tab) => total + getMemoryBytes(tab), 0)
  };
}

function pruneSelection() {
  if (!popupData) {
    return;
  }

  const availableIds = new Set(popupData.tabs.map((tab) => tab.id));

  for (const tabId of [...selectedTabIds]) {
    if (!availableIds.has(tabId)) {
      selectedTabIds.delete(tabId);
    }
  }
}

function getTabMeta(tab) {
  const group = tab.group ? `${tab.group.title} - ` : "";
  const host = tab.hostname || "local";

  if (tab.discarded) {
    return `${group}${host} - discarded`;
  }

  return `${group}${host} - ${tab.ageLabel} inactive - ${tab.reason}`;
}

function getMemoryBytes(tab) {
  return tab.discarded ? 0 : Number(tab.memory?.bytes) || 0;
}

function formatMemoryLabel(tab) {
  if (tab.discarded) {
    return "Unloaded";
  }

  const bytes = getMemoryBytes(tab);
  if (!bytes) {
    return "-";
  }

  const suffix = tab.memory?.sharedCount > 1 ? " est" : "";
  return `${formatBytes(bytes)}${suffix}`;
}

function formatMemoryTitle(tab) {
  if (tab.discarded) {
    return "Tab content is unloaded";
  }

  const bytes = getMemoryBytes(tab);
  if (!bytes) {
    return "Memory unavailable for this tab";
  }

  return `Page JavaScript heap estimate: ${formatBytes(bytes)}`;
}

function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) {
    return `${value} B`;
  }

  const units = ["KB", "MB", "GB"];
  let amount = value / 1024;
  let unitIndex = 0;

  while (amount >= 1024 && unitIndex < units.length - 1) {
    amount /= 1024;
    unitIndex += 1;
  }

  return `${amount >= 10 ? amount.toFixed(0) : amount.toFixed(1)} ${units[unitIndex]}`;
}

function pluralize(count, singular, plural = `${singular}s`) {
  return Number(count) === 1 ? singular : plural;
}

function hasSiteException(tab) {
  if (!tab?.hostname || !popupData?.settings?.exceptionRules) {
    return false;
  }

  return popupData.settings.exceptionRules.some((rule) => {
    const clean = String(rule).trim().toLowerCase();
    return clean === tab.hostname.toLowerCase();
  });
}

function setBulkStatus(response) {
  const skipped = Number(response.skipped || 0);
  const failed = Array.isArray(response.failed) ? response.failed.length : 0;
  const totalSkipped = skipped + failed;
  const reasonSummary = summarizeFailureReasons(response.failed);
  const details = totalSkipped
    ? `, ${totalSkipped} skipped${reasonSummary ? ` (${reasonSummary})` : ""}`
    : "";
  setStatus(`Discarded ${response.discarded || 0} tabs${details}`);
}

function summarizeFailureReasons(failed) {
  if (!Array.isArray(failed) || !failed.length) {
    return "";
  }

  const counts = new Map();
  for (const entry of failed) {
    const reason = String(entry?.reason || "Unknown reason");
    counts.set(reason, (counts.get(reason) || 0) + 1);
  }

  return formatReasonCounts(Object.fromEntries(counts.entries()));
}

function formatReasonCounts(reasons) {
  if (!reasons || typeof reasons !== "object") {
    return "";
  }

  return Object.entries(reasons)
    .map(([reason, count]) => [reason, Number(count) || 0])
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 2)
    .map(([reason, count]) => `${reason}: ${count}`)
    .join("; ");
}

function setStatus(text, isError = false) {
  els.status.textContent = text;
  els.status.classList.toggle("error", Boolean(isError));
}

async function sendMessage(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok) {
    throw new Error(response?.error || "Extension worker did not respond");
  }

  return response;
}
