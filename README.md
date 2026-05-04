# Auto Tab Memory Saver

A Manifest V3 Chrome extension that uses Chrome's native tab discarding to unload inactive background tabs without replacing pages with a custom suspended page.

## Load Unpacked

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Choose Load unpacked.
4. Select this folder: `/Users/v/workspace/chrome memory`.

## Features

- Automatically discards inactive background tabs on a configurable schedule.
- Manually discards eligible tabs, force-discards tabs, and reloads discarded tabs from the popup or action context menu.
- Highlights checked popup tabs in Chrome's tab strip and discards Chrome-highlighted selections, checked popup tabs, and whole tab groups, with force-discard actions for protected selections and groups.
- Searches tabs in the popup and sorts by tab order, memory, or last accessed time.
- Shows stable-channel-safe observed tab JavaScript heap telemetry when available.
- Supports per-tab protection and site exceptions.
- Supports hostname, wildcard, URL substring, and `re:` regular expression rules.
- Supports force-eligible rules with optional intervals, such as `example.com@2h`.
- Skips protected tab types: pinned, audible, playing media, paused media, unsaved forms, offline pages, notification-enabled pages, battery power, and tabs with Chrome auto-discard disabled.
- Can discard high-memory pages when `performance.memory.totalJSHeapSize` is available.
- Can close discarded tabs after a configurable number of days.
- Exports and imports settings as JSON.

## Notes

Chrome does not allow extensions to discard the active tab. Chrome also blocks script injection on internal pages such as `chrome://`, the Chrome Web Store, and some browser-owned documents, so page-state checks are unavailable there.

Stable Chrome does not expose full per-tab or per-extension process memory to Manifest V3 extensions. The popup reports observed JavaScript heap from page instrumentation when available; this is useful for comparison, but it is not full tab memory.

The battery power option depends on the Battery Status API being available from at least one monitored page. When Chrome does not expose battery status, automatic discarding continues normally.
