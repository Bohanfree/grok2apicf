# Tab Organizer Extension

A small Chrome and Firefox WebExtension prototype for organizing the current window's tabs into native browser tab groups.

## MVP features

- Analyze tabs in the current window.
- Preview a grouping plan before applying it.
- Group by local rules using tab title and URL.
- Group by root domain.
- Detect duplicate URLs without closing anything.
- Skip pinned tabs and browser internal pages.
- Apply native tab group names and colors.
- Copy the generated JSON plan.

## Chrome local install

1. Open chrome://extensions.
2. Enable Developer mode.
3. Click Load unpacked.
4. Select this folder.

## Firefox local install

1. Open about:debugging#/runtime/this-firefox.
2. Click Load Temporary Add-on.
3. Select manifest.json from this folder.

## Notes

This first version is local-only. It does not request site access and does not read page contents.
