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

- Enter creates a paragraph; Shift+Enter creates a line break.
- Markdown links render as links, and bare HTTP URLs become clickable without changing their stored text. Preview mode makes the note read-only and opens links with a click or tap; Cmd/Ctrl-click opens them while editing.
- Typing `> ` at the start of a paragraph creates a toggleable details region. Its summary remains editable, and only the disclosure triangle toggles the body.
- Typing `| ` at the start of a paragraph creates a blockquote. The stored Markdown still uses the standard `> ` quote syntax.
- The visible screen, edit/preview mode, and last open note are remembered locally so reopening the app resumes the same context.
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

This document records enduring interface choices, not a complete feature inventory. Search, tags, and resource management are outside the current interface.
