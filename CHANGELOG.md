# Changelog

All notable changes to Scratch are documented in this file.

## [Unreleased]

This release expands Scratch into a more capable Notion-like Markdown editor while preserving local, plain-file storage. It adds direct manipulation for content and images, richer formatting controls, improved workspace navigation, and independent windows for focused or parallel editing.

### Editor and formatting

- Added a selection-based floating menu for text formatting and link editing.
- Added direct image drag and drop between text blocks, including rendered previews.
- Added drag and drop for editor blocks.
- Added accessible, styled text highlights for light and dark appearances.
- Added a setting to disable mouse-driven editor page-width resizing.
- Added a setting to hide the persistent editor toolbar.

### Title bar and sidebar

- Added a title-bar information setting with `Modification Date`, `Filename`, and `None` options.
- Added sidebar sorting by newest or oldest modification date.
- Added a one-click action to collapse all folders in folder view.

### Windows, workspaces, and settings

- Opening a Markdown file in a standalone window no longer opens the main window in the background.
- Added support for multiple windows and workspaces, allowing several notes and working folders to be edited simultaneously.
- Added access to Settings from a standalone Markdown window without opening the main window.

### Known regression

- Keyboard-based text selection in the rich-text editor no longer fully follows the native operating-system behavior.

### Next

- Add macOS Quick Look previews for Markdown files.
- Improve the table UI: https://tiptap.dev/docs/ui-components/node-components/table-node
- Add a table of contents component: https://tiptap.dev/docs/ui-components/node-components/table-of-contents-node
- Improve the drag context menu: https://tiptap.dev/docs/ui-components/components/drag-context-menu
- Improve the horizontal rule UI: https://tiptap.dev/docs/ui-components/node-components/horizontal-rule-node
- Fix list-item spacing.
