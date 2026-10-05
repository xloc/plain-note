# Current User Interface

## Purpose

The interface is a compact, local-first workspace for selecting and editing notes without leaving the page.

## Layout

Use a fixed two-panel layout:

- A narrow sidebar for note actions, synchronization state, and note navigation.
- A full-height editor for the selected note.

The sidebar favors brief note identity: title, one-line preview, and a non-synced state when needed. The title comes from the first level-one heading, otherwise “Untitled.”

On desktop, right-clicking a note opens a popup with a “Delete note” action without selecting it. On mobile, swiping a note left reveals its delete button.

## Search

A search field stays above the scrolling note list, directly below the “Notes” heading on mobile. It has a magnifying-glass icon, a “Search notes” placeholder, and a clear button while text is entered.

Search filters locally available notes as the user types. It matches all whitespace-separated query words anywhere in the Markdown content, including the title, without regard to capitalization. Results retain their existing newest-first ordering and date groups, with a short excerpt around the first match. An empty result shows “No matching notes.”

Filtering never changes the open note. Selecting a result uses normal note navigation; clearing the field restores the full list. Results update as notes are edited or synchronized and remain available offline. The query is temporary and is not saved across reloads.

Search scans in small batches that yield to typing and rendering. It pauses once enough matches fill the viewport and a small buffer, then resumes as the user scrolls. Changing the query cancels the previous scan. Only visible note rows and a small buffer are mounted; spacers preserve scrolling and the date groups.

While scanning actively for more than 200 ms, a small spinner replaces the magnifying glass in the same position. It returns to the magnifying glass as soon as scanning completes or pauses, and the clear button remains available. “No matching notes” appears only after a complete scan finds nothing.

Fuzzy matching, highlights inside the editor, and searching attachment contents are deferred.

## Editing

Edit Markdown as a rich document, while retaining Markdown as the stored format. The editor supports the core note structures—headings, paragraphs, lists, tables, quotations, code, and dividers—through direct editing, Markdown input rules, and keyboard shortcuts.

The main interaction choices are:

- Enter creates a paragraph; Shift+Enter creates a line break.
- Markdown links render as links, and bare HTTP URLs become clickable without changing their stored text. Preview mode makes the note read-only and opens links with a click or tap; Cmd/Ctrl-click opens them while editing.
- Typing `> ` at the start of a paragraph creates a toggleable details region. Its summary remains editable, and only the disclosure triangle toggles the body.
- Typing `| ` at the start of a paragraph creates a blockquote. The stored Markdown still uses the standard `> ` quote syntax.
- The visible screen, edit/preview mode, and last open note are remembered locally so reopening the app resumes the same context.
- Each note has a canonical bookmarkable route at `/notes/<uuid>`. Browser back and forward restore the corresponding selected note.
- Selecting a note from the list in edit mode restores its last caret position, focuses the editor, and scrolls only as needed to show the caret. Caret positions are remembered for the current app session; a note without a remembered position opens ready to append at the end.
- Creating a note or explicitly switching from preview to edit mode focuses the editor immediately. Clicking the current note returns focus without moving the caret or scrolling. Preview mode, search, dialogs, and background synchronization never request editor focus.
- Background content updates preserve the current selection through the changed document rather than resetting it to the beginning.
- Scroll positions for the five most recently viewed notes are remembered locally for five minutes.
- The editor header stays fixed while document content scrolls beneath it. Trailing viewport space allows the whole document to scroll above the viewport, and clicking that space places the cursor at the document end.
- The document is centered at a maximum width of `72ch` for readable lines. Wide tables scroll horizontally within their own region instead of widening the page.
- Tab remains inside the editor: it navigates tables, indents lists, inserts four spaces in code blocks, and inserts a literal tab in normal text.
- Heading levels are visible through a small `h1`–`h6` label and a suffix line after the heading’s final visual line.
- Code is visually distinct but remains editable Markdown content.

## Markdown representation

Markdown is the canonical note format; ProseMirror is the editable document view. Editor structures must round-trip through Markdown without losing meaning.

- Blockquotes use the standard `> ` Markdown syntax in storage and exports, regardless of their editor input rule.
- Toggleable regions use structured `<details>` and `<summary>` tags, with Markdown blocks inside the details body. Expanded regions include the standard `open` attribute; collapsed regions omit it.
- An intentional empty paragraph uses `<p></p>` because ordinary Markdown blank lines are only separators and cannot preserve empty paragraphs across parsing.

## Tables

Tables behave as compact content-sized elements rather than full-width layouts. Their controls are contextual: add controls sit on the related right or bottom edge, and drag handles appear only near the related row or column.

Rows and columns can be rearranged with an insertion line showing the destination. Selection-based deletion removes the selected row, column, or table. A gap cursor after a final table keeps it easy to continue writing.

## Synchronization

Edits save locally first. The sync control exposes the current state and allows a manual retry. Resetting local data requires confirmation because it discards the browser copy before reloading from the server.

Concurrent changes merge at the Markdown-document level. Non-overlapping blocks merge automatically. Overlapping blocks become ordinary document content, with the server version followed by the device version between three horizontal dividers:

```markdown
---
server blocks
---

device blocks

---
```

There is no separate conflict UI or special editor node. The resulting document is immediately eligible for normal synchronization.

## Portability

A selected note can be exported as plain Markdown, Markdown with YAML metadata, or standalone HTML.

- Metadata exports include the note UUID, tags, resources, and timestamps. Import always assigns a new UUID so a dropped file creates a new note rather than overwriting an existing one.
- Dropping a `.md` or `.markdown` file onto the note list imports it. Files without recognized metadata are imported as plain Markdown.
- Standalone HTML embeds Tailwind preflight and the note export CSS, with no external stylesheet or script dependency. A live iframe preview uses the same generated HTML as the download.
- Export CSS is maintained separately from editor CSS and synchronized only in dedicated batches when requested.

## Scope

This document records enduring interface choices, not a complete feature inventory. Tag management remains outside the current interface.
