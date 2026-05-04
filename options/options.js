import { DEFAULT_SETTINGS, linesToRules, normalizeSettings, rulesToLines } from "../src/constants.js";

const fieldIds = [
  "autoDiscardEnabled",
  "discardAfterMinutes",
  "checkEveryMinutes",
  "discardNewInactiveTabs",
  "discardWhenHeapAboveMb",
  "skipPinned",
  "skipAudible",
  "skipMediaPlaying",
  "skipPausedMedia",
  "skipUnsavedForms",
  "skipOfflinePages",
  "skipNotificationPages",
  "skipBatteryPower",
  "skipAutoDiscardDisabled",
  "closeOldDiscardedTabs",
  "closeDiscardedAfterDays",
  "exceptionRules",
  "forceRules"
];

const els = Object.fromEntries(fieldIds.map((id) => [id, document.querySelector(`#${id}`)]));
els.saveSettings = document.querySelector("#saveSettings");
els.resetSettings = document.querySelector("#resetSettings");
els.exportSettings = document.querySelector("#exportSettings");
els.importSettings = document.querySelector("#importSettings");
els.settingsJson = document.querySelector("#settingsJson");
els.status = document.querySelector("#status");

document.addEventListener("DOMContentLoaded", () => {
  bindEvents();
  void loadSettings();
});

function bindEvents() {
  els.saveSettings.addEventListener("click", () => saveSettings());
  els.resetSettings.addEventListener("click", () => resetSettings());
  els.exportSettings.addEventListener("click", () => exportSettings());
  els.importSettings.addEventListener("click", () => importSettings());
}

async function loadSettings() {
  try {
    const response = await sendMessage({ type: "GET_OPTIONS_DATA" });
    renderSettings(response.settings);
    setStatus("");
  } catch (error) {
    setStatus(error.message, true);
  }
}

function renderSettings(settingsValue) {
  const settings = normalizeSettings(settingsValue);

  for (const [key, value] of Object.entries(settings)) {
    const element = els[key];
    if (!element) {
      continue;
    }

    if (element.type === "checkbox") {
      element.checked = Boolean(value);
    } else if (key === "exceptionRules" || key === "forceRules") {
      element.value = rulesToLines(value);
    } else {
      element.value = value;
    }
  }
}

async function saveSettings() {
  try {
    const settings = collectSettings();
    const response = await sendMessage({ type: "SAVE_SETTINGS", settings });
    renderSettings(response.settings);
    setStatus("Settings saved");
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function resetSettings() {
  try {
    const response = await sendMessage({ type: "RESET_SETTINGS" });
    renderSettings(response.settings || DEFAULT_SETTINGS);
    setStatus("Settings reset");
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function exportSettings() {
  try {
    const response = await sendMessage({ type: "EXPORT_SETTINGS" });
    els.settingsJson.value = response.json;
    setStatus("Settings exported");
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function importSettings() {
  try {
    const parsed = JSON.parse(els.settingsJson.value);
    const response = await sendMessage({ type: "IMPORT_SETTINGS", settings: parsed });
    renderSettings(response.settings);
    setStatus("Settings imported");
  } catch (error) {
    setStatus(error.message, true);
  }
}

function collectSettings() {
  const settings = {};

  for (const id of fieldIds) {
    const element = els[id];

    if (element.type === "checkbox") {
      settings[id] = element.checked;
    } else if (element.type === "number") {
      settings[id] = Number(element.value);
    } else if (id === "exceptionRules" || id === "forceRules") {
      settings[id] = linesToRules(element.value);
    } else {
      settings[id] = element.value;
    }
  }

  return normalizeSettings(settings);
}

function setStatus(text, isError = false) {
  els.status.textContent = text;
  els.status.classList.toggle("error", Boolean(isError));
  els.status.classList.toggle("saved", Boolean(text && !isError));
}

async function sendMessage(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok) {
    throw new Error(response?.error || "Extension worker did not respond");
  }

  return response;
}
