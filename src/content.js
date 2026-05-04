(() => {
  if (globalThis.__autoTabMemorySaverContentLoaded) {
    return;
  }

  globalThis.__autoTabMemorySaverContentLoaded = true;

  const SEND_INTERVAL_MS = 15000;
  const SEND_DELAY_MS = 250;
  const trackedControls = new WeakMap();
  let sendTimer = 0;
  let lastPayload = "";
  let batteryState = {
    available: false,
    charging: null,
    level: null
  };

  captureCurrentFormState();
  installListeners();
  setupBattery();
  scheduleSend(true);
  setInterval(() => sendState(false), SEND_INTERVAL_MS);

  function installListeners() {
    document.addEventListener("focusin", (event) => {
      const control = getControl(event.target);
      if (control) {
        trackControl(control, false);
      }
    }, true);

    document.addEventListener("input", (event) => {
      const control = getControl(event.target);
      if (control) {
        trackControl(control, true);
      }
      scheduleSend(true);
    }, true);

    document.addEventListener("change", (event) => {
      const control = getControl(event.target);
      if (control) {
        trackControl(control, true);
      }
      scheduleSend(true);
    }, true);

    document.addEventListener("submit", () => {
      setTimeout(() => {
        captureCurrentFormState();
        scheduleSend(true);
      }, 0);
    }, true);

    document.addEventListener("reset", () => {
      setTimeout(() => {
        captureCurrentFormState();
        scheduleSend(true);
      }, 0);
    }, true);

    document.addEventListener("play", () => scheduleSend(true), true);
    document.addEventListener("pause", () => scheduleSend(true), true);
    document.addEventListener("ended", () => scheduleSend(true), true);
    window.addEventListener("online", () => scheduleSend(true));
    window.addEventListener("offline", () => scheduleSend(true));
    document.addEventListener("visibilitychange", () => scheduleSend(false));
  }

  function setupBattery() {
    if (!("getBattery" in navigator)) {
      return;
    }

    navigator.getBattery()
      .then((battery) => {
        const updateBattery = () => {
          batteryState = {
            available: true,
            charging: Boolean(battery.charging),
            level: Number.isFinite(battery.level) ? battery.level : null
          };
          scheduleSend(true);
        };

        updateBattery();
        battery.addEventListener("chargingchange", updateBattery);
        battery.addEventListener("levelchange", updateBattery);
      })
      .catch(() => {
        batteryState = {
          available: false,
          charging: null,
          level: null
        };
      });
  }

  function captureCurrentFormState() {
    for (const control of getControls()) {
      trackControl(control, false);
    }
  }

  function hasDirtyForms() {
    for (const control of getControls()) {
      if (!trackedControls.has(control)) {
        trackControl(control, false);
      }

      if (trackedControls.get(control) !== readCurrentValue(control)) {
        return true;
      }
    }

    return false;
  }

  function getControls() {
    return Array.from(document.querySelectorAll("input, textarea, select"))
      .filter((control) => !isIgnoredControl(control));
  }

  function getControl(target) {
    if (!target || !target.matches || !target.matches("input, textarea, select")) {
      return null;
    }

    return isIgnoredControl(target) ? null : target;
  }

  function isIgnoredControl(control) {
    const type = String(control.type || "").toLowerCase();
    return ["button", "submit", "reset", "image", "hidden"].includes(type);
  }

  function trackControl(control, preferDefault) {
    if (trackedControls.has(control)) {
      return;
    }

    trackedControls.set(control, preferDefault ? readDefaultValue(control) : readCurrentValue(control));
  }

  function readCurrentValue(control) {
    const type = String(control.type || "").toLowerCase();

    if (type === "checkbox" || type === "radio") {
      return control.checked ? "1" : "0";
    }

    if (type === "file") {
      return String(control.files ? control.files.length : 0);
    }

    if (control.tagName === "SELECT" && control.multiple) {
      return Array.from(control.options)
        .filter((option) => option.selected)
        .map((option) => option.value)
        .join("\0");
    }

    return String(control.value);
  }

  function readDefaultValue(control) {
    const type = String(control.type || "").toLowerCase();

    if (type === "checkbox" || type === "radio") {
      return control.defaultChecked ? "1" : "0";
    }

    if (type === "file") {
      return "0";
    }

    if (control.tagName === "SELECT" && control.multiple) {
      return Array.from(control.options)
        .filter((option) => option.defaultSelected)
        .map((option) => option.value)
        .join("\0");
    }

    if (control.tagName === "SELECT") {
      const defaultOption = Array.from(control.options).find((option) => option.defaultSelected);
      return defaultOption ? defaultOption.value : "";
    }

    return String(control.defaultValue);
  }

  function getMediaState() {
    const media = Array.from(document.querySelectorAll("audio, video"));
    const mediaPlaying = media.some((element) => (
      !element.paused &&
      !element.ended &&
      element.readyState > 2
    ));
    const mediaPaused = media.some((element) => (
      element.paused &&
      !element.ended &&
      element.currentTime > 0
    ));

    return { mediaPlaying, mediaPaused };
  }

  function getJsHeapBytes() {
    if (performance && performance.memory && Number.isFinite(performance.memory.totalJSHeapSize)) {
      return performance.memory.totalJSHeapSize;
    }

    return 0;
  }

  function collectState() {
    const media = getMediaState();

    return {
      hasDirtyForms: hasDirtyForms(),
      mediaPlaying: media.mediaPlaying,
      mediaPaused: media.mediaPaused,
      notificationsGranted: typeof Notification !== "undefined" && Notification.permission === "granted",
      online: navigator.onLine !== false,
      jsHeapBytes: getJsHeapBytes(),
      battery: batteryState
    };
  }

  function scheduleSend(force) {
    clearTimeout(sendTimer);
    sendTimer = setTimeout(() => sendState(force), SEND_DELAY_MS);
  }

  function sendState(force) {
    const state = collectState();
    const payload = JSON.stringify(state);

    if (!force && payload === lastPayload) {
      return;
    }

    lastPayload = payload;
    chrome.runtime.sendMessage({
      type: "PAGE_STATE",
      state
    }).catch(() => {});
  }
})();
