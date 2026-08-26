# Current User Interface

## Purpose

The interface is a compact, local-first workspace for selecting and editing notes without leaving the page.

## Layout

Use a fixed two-panel layout:

- A narrow sidebar for note actions, synchronization state, and note navigation.
- A full-height editor for the selected note.

The sidebar favors brief note identity: title, one-line preview, and a non-synced state when needed. The title comes from the first level-one heading, otherwise “Untitled.”

## Editing

Edit Markdown as a rich document, while retaining Markdown as the stored format. The editor supports the core note structures—headings, paragraphs, lists, tables, quotations, code, and dividers—through direct editing, Markdown input rules, and keyboard shortcuts.

The main interaction choices are:

- Single Enter creates a line break; a second consecutive Enter creates a paragraph.
- Tab remains inside the editor: it navigates tables, indents lists, inserts four spaces in code blocks, and inserts a literal tab in normal text.
- Heading levels are visible through a small `h1`–`h6` label and a suffix line after the heading’s final visual line.
- Code is visually distinct but remains editable Markdown content.

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

## Scope

This document records enduring interface choices, not a complete feature inventory. Search, tags, resources, and export are outside the current interface.
