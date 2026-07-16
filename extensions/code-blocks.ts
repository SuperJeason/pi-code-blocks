import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { copyToClipboard } from "@earendil-works/pi-coding-agent";
import {
  matchesKey,
  Key,
  decodeKittyPrintable,
  truncateToWidth,
  visibleWidth,
} from "@earendil-works/pi-tui";

/**
 * /code - transparent outline panel · selected/focus highlight only · bottom-anchored.
 * Trigger: /code
 * Keys: up/down move/scroll · right/f preview · left list · tab last/all · enter · esc
 */

// Layout sizes: adaptive by terminal height, preview gets more space.
// MUST stay within overlay maxHeight ("75%") or the TUI slices the bottom border.
function layoutRows(): { list: number; preview: number } {
  const termRows = Math.max(20, process.stdout.rows || 36);
  // chrome rows outside list/preview:
  // top + search + rule + scroll + rule + previewHeader + rule + footer + bottom = 9
  const chrome = 9;
  // Match overlayOptions.maxHeight ("75%") with 1 row margin for compositor safety.
  const maxTotal = Math.max(14, Math.floor(termRows * 0.75) - 1);
  const content = Math.max(6, maxTotal - chrome);
  // Prefer a larger preview pane (~60% of content rows)
  let list = Math.max(3, Math.min(8, Math.round(content * 0.35)));
  let preview = Math.max(4, content - list);
  if (list + preview > content) {
    list = Math.max(3, Math.min(list, content - 4));
    preview = Math.max(4, content - list);
  }
  return { list, preview };
}

const LANG_COLORS: Record<string, string> = {
  ts: "accent", tsx: "accent", typescript: "accent",
  js: "warning", jsx: "warning", javascript: "warning",
  py: "success", python: "success",
  rs: "warning", rust: "warning",
  go: "accent",
  json: "muted", yaml: "muted", yml: "muted", toml: "muted",
  md: "text", markdown: "text",
  sh: "success", bash: "success", shell: "success", zsh: "success",
  css: "accent", scss: "accent",
  html: "error", sql: "warning", java: "error",
  kt: "warning", kotlin: "warning", swift: "error",
  c: "muted", cpp: "muted", h: "muted",
  rb: "error", ruby: "error", php: "accent", lua: "accent", dart: "accent",
  vue: "success", svelte: "error", diff: "warning",
  dockerfile: "accent", docker: "accent", xml: "muted",
  txt: "dim", text: "dim", plain: "dim",
};

type ThemeLike = {
  fg: (name: string, text: string) => string;
  bg: (name: string, text: string) => string;
  bold: (text: string) => string;
};

function langColor(lang: string): string {
  return LANG_COLORS[lang.toLowerCase()] ?? "muted";
}

function langLabel(lang: string): string {
  const raw = (lang || "text").trim() || "text";
  const map: Record<string, string> = {
    typescript: "ts", javascript: "js", python: "py", markdown: "md",
    shell: "sh", bash: "sh", zsh: "sh", plaintext: "text", plain: "text",
  };
  const key = raw.toLowerCase();
  return map[key] ?? (raw.length > 12 ? raw.slice(0, 12) : raw);
}

function padVisible(s: string, width: number): string {
  const w = visibleWidth(s);
  if (w >= width) return truncateToWidth(s, width, "…");
  return s + " ".repeat(width - w);
}

function centerVisible(s: string, width: number): string {
  const w = visibleWidth(s);
  if (w >= width) return truncateToWidth(s, width, "…");
  const left = Math.floor((width - w) / 2);
  return " ".repeat(left) + s + " ".repeat(width - w - left);
}

function keyHint(theme: ThemeLike, key: string, label: string): string {
  return theme.fg("accent", theme.bold(key)) + theme.fg("muted", " " + label);
}

// ── Transparent panel (outline only) ──────────────────────────────────────
// Default surfaces paint no fill so the session background shows through.
// Only selected / focus rows use a light selectedBg highlight.
// Terminals have no real alpha; "transparent" = skip theme.bg entirely.
type Surface = "chrome" | "body" | "selected" | "preview" | "previewFocus";
type BorderTone = "frame" | "muted" | "accent" | "focus";

/** null = fully transparent (no bg). Only interactive emphasis gets a fill. */
const SURFACE_BG: Record<Surface, string | null> = {
  chrome: null,
  body: null,
  selected: "selectedBg",
  preview: null,
  previewFocus: "selectedBg",
};

const BORDER_FG: Record<BorderTone, string> = {
  frame: "border",
  muted: "borderMuted",
  accent: "accent",
  focus: "borderAccent",
};

function surfaceBg(s: Surface = "body"): string | null {
  return SURFACE_BG[s];
}

function borderFg(t: BorderTone = "frame"): string {
  return BORDER_FG[t];
}

/**
 * Pad to full width. Only wrap with theme.bg when a fill is requested —
 * otherwise the line stays transparent and the session shows through.
 */
function paintLine(
  theme: ThemeLike,
  content: string,
  width: number,
  bg: string | null | undefined,
): string {
  const line = padVisible(content, width);
  return bg ? theme.bg(bg, line) : line;
}

function boxRow(
  theme: ThemeLike,
  inner: string,
  width: number,
  opts?: {
    surface?: Surface;
    border?: BorderTone;
    bg?: string | null;
    borderColor?: string;
  },
): string {
  const bg = opts?.bg !== undefined ? opts.bg : surfaceBg(opts?.surface ?? "body");
  const borderColor = opts?.borderColor ?? borderFg(opts?.border ?? "frame");
  const innerW = Math.max(0, width - 2);
  const left = theme.fg(borderColor, "│");
  const right = theme.fg(borderColor, "│");
  return paintLine(theme, left + padVisible(inner, innerW) + right, width, bg);
}

function boxTop(
  theme: ThemeLike,
  titleColored: string,
  titlePlain: string,
  width: number,
  opts?: { surface?: Surface; border?: BorderTone },
): string {
  const bg = surfaceBg(opts?.surface ?? "chrome");
  const borderColor = borderFg(opts?.border ?? "frame");
  const innerW = Math.max(0, width - 2);
  let title = titleColored;
  let titleW = visibleWidth(titlePlain);
  if (titleW > innerW) {
    title = truncateToWidth(titlePlain, innerW, "…");
    titleW = visibleWidth(title);
  }
  const dash = Math.max(0, innerW - titleW);
  const line =
    theme.fg(borderColor, "╭") +
    title +
    theme.fg(borderColor, "─".repeat(dash) + "╮");
  return paintLine(theme, line, width, bg);
}

function boxBottom(
  theme: ThemeLike,
  width: number,
  opts?: { surface?: Surface; border?: BorderTone },
): string {
  const bg = surfaceBg(opts?.surface ?? "chrome");
  const borderColor = borderFg(opts?.border ?? "frame");
  const innerW = Math.max(0, width - 2);
  const line = theme.fg(borderColor, "╰" + "─".repeat(innerW) + "╯");
  return paintLine(theme, line, width, bg);
}

/** Horizontal rule with T-junctions; no fill by default. */
function boxRule(
  theme: ThemeLike,
  width: number,
  opts?: { surface?: Surface; border?: BorderTone },
): string {
  const bg = surfaceBg(opts?.surface ?? "body");
  const borderColor = borderFg(opts?.border ?? "muted");
  const innerW = Math.max(0, width - 2);
  const line = theme.fg(borderColor, "├" + "─".repeat(innerW) + "┤");
  return paintLine(theme, line, width, bg);
}

interface CodeBlock {
  num: number;
  answer: number;
  lang: string;
  code: string;
  firstLine: string;
  lines: number;
}

export default function (pi: ExtensionAPI) {
  pi.registerCommand("code", {
    description: "从历史回答中挑选代码块并复制到剪贴板",
    handler: async (_args, ctx) => {
      const blocks = extractCodeBlocks(ctx.sessionManager.getEntries());

      if (blocks.length === 0) {
        await ctx.ui.custom<void>(
          (_tui, theme, _kb, done) => createEmptyState(theme as ThemeLike, () => done()),
          {
            overlay: true,
            overlayOptions: {
              width: 52,
              minWidth: 44,
              maxHeight: "60%",
              anchor: "bottom-center",
              margin: { bottom: 1 },
            },
          },
        );
        return;
      }

      const code = await ctx.ui.custom<string | null>(
        (tui, theme, _kb, done) => {
          const th = theme as ThemeLike;
          let search = "";
          let filtered = blocks.slice();
          let selectedIdx = 0;
          let listOffset = 0;
          // Adaptive row counts (refreshed each render)
          let listRows = 6;
          let previewRows = 12;
          let focus: "list" | "preview" = "list";
          let previewOffset = 0;
          // Scope: last assistant reply only, or all replies in session
          let scope: "last" | "all" = "last";
          const lastAnswer = blocks.length > 0 ? blocks[blocks.length - 1]!.answer : 0;

          const ensureVisible = () => {
            if (selectedIdx < listOffset) listOffset = selectedIdx;
            else if (selectedIdx >= listOffset + listRows) listOffset = selectedIdx - listRows + 1;
            if (listOffset < 0) listOffset = 0;
            const maxOff = Math.max(0, filtered.length - listRows);
            if (listOffset > maxOff) listOffset = maxOff;
          };

          const selectedBlock = () => filtered[selectedIdx];

          const maxPreviewOffset = () => {
            const b = selectedBlock();
            if (!b) return 0;
            const n = b.code.split("\n").length;
            return Math.max(0, n - previewRows);
          };

          const ensurePreviewVisible = () => {
            const max = maxPreviewOffset();
            if (previewOffset < 0) previewOffset = 0;
            if (previewOffset > max) previewOffset = max;
          };

          const selectIndex = (idx: number) => {
            selectedIdx = Math.max(0, Math.min(idx, Math.max(0, filtered.length - 1)));
            previewOffset = 0;
            ensureVisible();
            ensurePreviewVisible();
          };

          const scopedBlocks = () =>
            scope === "last" ? blocks.filter((b) => b.answer === lastAnswer) : blocks;

          const applyFilter = () => {
            const pool = scopedBlocks();
            const q = search.trim().toLowerCase();
            filtered = q
              ? pool.filter(
                  (b) =>
                    b.lang.toLowerCase().includes(q) ||
                    b.firstLine.toLowerCase().includes(q) ||
                    b.code.toLowerCase().includes(q) ||
                    String(b.num).includes(q) ||
                    String(b.answer).includes(q),
                )
              : pool.slice();
            selectedIdx = Math.min(selectedIdx, Math.max(0, filtered.length - 1));
            if (filtered.length === 0) selectedIdx = 0;
            previewOffset = 0;
            ensurePreviewVisible();
            ensureVisible();
            tui.requestRender();
          };

          // Initialize list to last-reply scope (no render yet)
          filtered = scopedBlocks().slice();
          selectedIdx = 0;
          listOffset = 0;
          focus = "list";
          previewOffset = 0;

          return {
            invalidate() {},

            render(width: number): string[] {
              ({ list: listRows, preview: previewRows } = layoutRows());
              const W = Math.max(40, width);
              const innerW = Math.max(0, W - 2);
              const out: string[] = [];

              const pool = scopedBlocks();
              const countLabel =
                filtered.length === pool.length
                  ? String(pool.length)
                  : filtered.length + "/" + pool.length;
              const scopeLabel = scope === "last" ? "last" : "all";
              const titlePlain = " ✦ Code · " + scopeLabel + " · " + countLabel + " ";
              const titleColored =
                th.fg("accent", th.bold(" ✦ Code ")) +
                th.fg("dim", "· ") +
                th.fg(scope === "last" ? "warning" : "success", th.bold(scopeLabel)) +
                th.fg("dim", " · ") +
                th.fg("text", countLabel + " ");
              out.push(boxTop(th, titleColored, titlePlain, W, { surface: "chrome", border: "frame" }));

              const searchIcon = th.fg("accent", th.bold("⌕"));
              const placeholder = "type to filter…";
              const searchBody =
                search.length > 0 ? th.fg("text", th.bold(search)) : th.fg("dim", placeholder);
              const cursor = th.fg("accent", "▌");
              const visibleSearch = search.length > 0 ? search : placeholder;
              const used = visibleWidth(" " + "⌕" + " " + visibleSearch + "▌");
              const pad = Math.max(0, innerW - used);
              out.push(
                boxRow(th, " " + searchIcon + " " + searchBody + cursor + " ".repeat(pad), W, {
                  surface: "body",
                }),
              );
              out.push(boxRule(th, W, { surface: "body", border: "muted" }));

              // List pane (listRows, adaptive)
              if (filtered.length === 0) {
                for (let r = 0; r < listRows; r++) {
                  if (r === Math.floor(listRows / 2) - 1) {
                    out.push(
                      boxRow(th, centerVisible(th.fg("warning", th.bold("no matches")), innerW), W, {
                        surface: "body",
                      }),
                    );
                  } else if (r === Math.floor(listRows / 2)) {
                    out.push(
                      boxRow(
                        th,
                        centerVisible(th.fg("muted", "backspace / ctrl+u to clear"), innerW),
                        W,
                        { surface: "body" },
                      ),
                    );
                  } else {
                    out.push(boxRow(th, "", W, { surface: "body" }));
                  }
                }
              } else {
                ensureVisible();
                const start = listOffset;
                for (let r = 0; r < listRows; r++) {
                  const idx = start + r;
                  if (idx >= filtered.length) {
                    out.push(boxRow(th, "", W, { surface: "body" }));
                    continue;
                  }

                  const b = filtered[idx]!;
                  const sel = idx === selectedIdx;
                  const lang = langLabel(b.lang);
                  const color = langColor(b.lang);
                  const num = String(b.num).padStart(2, " ");
                  const meta = b.lines + "L";
                  const previewRaw = (b.firstLine || "(empty)").replace(/\s+/g, " ");

                  const caretPlain = sel ? "▌" : " ";
                  const leftPlain = " " + caretPlain + num + " " + lang + "  ";
                  const leftW = visibleWidth(leftPlain);
                  const metaW = visibleWidth(meta);
                  const budget = Math.max(6, innerW - leftW - metaW - 2);
                  const previewCut = truncateToWidth(previewRaw, budget, "…");
                  const gap = Math.max(1, innerW - leftW - visibleWidth(previewCut) - metaW - 1);

                  if (sel) {
                    const caret = th.fg("accent", "▌");
                    const indexPart = th.bold(th.fg("text", num));
                    const chip = th.bold(th.fg(color, lang));
                    const preview = th.fg("text", previewCut);
                    const metaPart = th.fg("muted", meta);
                    const row =
                      " " + caret + indexPart + " " + chip + "  " + preview + " ".repeat(gap) + metaPart;
                    out.push(
                      boxRow(th, row, W, {
                        surface: focus === "list" ? "selected" : "body",
                        border: focus === "list" ? "focus" : "muted",
                      }),
                    );
                  } else {
                    const indexPart = th.fg("muted", num);
                    const chip = th.fg(color, lang);
                    const preview = th.fg("text", previewCut);
                    const metaPart = th.fg("dim", meta);
                    const row =
                      "  " + indexPart + " " + chip + "  " + preview + " ".repeat(gap) + metaPart;
                    out.push(boxRow(th, row, W, { surface: "body", border: "frame" }));
                  }
                }
              }

              // Scroll position (fixed 1 row)
              let scrollHint = "";
              if (filtered.length > 0) {
                const above = listOffset;
                const below = Math.max(0, filtered.length - (listOffset + listRows));
                const parts: string[] = [];
                if (above > 0) parts.push("↑" + above);
                if (below > 0) parts.push("↓" + below);
                const pos = selectedIdx + 1 + "/" + filtered.length;
                const label = (parts.length ? parts.join("  ") + "  ·  " : "") + pos;
                scrollHint = centerVisible(th.fg("muted", label), innerW);
              }
              out.push(boxRow(th, scrollHint, W, { surface: "body", border: "muted" }));
              out.push(boxRule(th, W, { surface: "body", border: "muted" }));

              // Preview pane (previewRows, adaptive; scrollable when focused)
              const sel = filtered[selectedIdx];
              const previewFocused = focus === "preview";
              if (sel) {
                const lang = langLabel(sel.lang);
                const color = langColor(sel.lang);
                const codeLines = sel.code.split("\n");
                ensurePreviewVisible();
                const maxOff = Math.max(0, codeLines.length - previewRows);
                const pStart = Math.min(previewOffset, maxOff);
                const pEnd = Math.min(codeLines.length, pStart + previewRows);
                const focusMark = previewFocused
                  ? th.fg("accent", th.bold("● PREVIEW"))
                  : th.fg("dim", "○ preview");
                const scrollInfo =
                  codeLines.length > previewRows
                    ? th.fg("muted", "  " + (pStart + 1) + "-" + pEnd + "/" + codeLines.length)
                    : th.fg("dim", "  " + codeLines.length + "L");
                const header =
                  " " +
                  focusMark +
                  th.fg("dim", "  ·  ") +
                  th.fg(color, "●") +
                  " " +
                  th.bold(th.fg("text", lang)) +
                  th.fg("dim", "  ·  ") +
                  th.fg("accent", "#" + sel.num) +
                  scrollInfo;
                out.push(
                  boxRow(th, header, W, {
                    surface: previewFocused ? "previewFocus" : "preview",
                    border: previewFocused ? "focus" : "muted",
                  }),
                );

                for (let r = 0; r < previewRows; r++) {
                  const lineIdx = pStart + r;
                  if (lineIdx < codeLines.length) {
                    const raw = codeLines[lineIdx] ?? "";
                    const ln = th.fg(
                      previewFocused ? "accent" : "dim",
                      String(lineIdx + 1).padStart(3, " "),
                    );
                    const bar = th.fg(previewFocused ? "accent" : "borderMuted", "│");
                    const body = th.fg(
                      "text",
                      truncateToWidth(raw.length ? raw : " ", Math.max(8, innerW - 8), "…"),
                    );
                    const row = " " + ln + " " + bar + " " + body;
                    out.push(
                      boxRow(th, row, W, {
                        surface: "preview",
                        border: previewFocused ? "focus" : "muted",
                      }),
                    );
                  } else {
                    out.push(
                      boxRow(th, "", W, {
                        surface: "preview",
                        border: previewFocused ? "focus" : "muted",
                      }),
                    );
                  }
                }
              } else {
                out.push(
                  boxRow(th, " " + th.fg("muted", "no selection"), W, {
                    surface: "preview",
                    border: "muted",
                  }),
                );
                for (let i = 0; i < previewRows; i++) {
                  out.push(boxRow(th, "", W, { surface: "preview", border: "muted" }));
                }
              }

              out.push(boxRule(th, W, { surface: "chrome", border: "muted" }));

              const focusHint =
                focus === "list"
                  ? keyHint(th, "→/f", "preview")
                  : keyHint(th, "←", "list");
              const moveHint =
                focus === "list"
                  ? keyHint(th, "↑↓", "move")
                  : keyHint(th, "↑↓", "scroll");
              const hints =
                " " +
                [
                  keyHint(th, "↵", "copy"),
                  moveHint,
                  focusHint,
                  keyHint(th, "tab", "last/all"),
                  keyHint(th, "esc", "close"),
                ].join(th.fg("dim", "  ·  "));
              out.push(boxRow(th, hints, W, { surface: "chrome", border: "frame" }));
              out.push(boxBottom(th, W, { surface: "chrome", border: "frame" }));
              return out;

            },

            handleInput(data: string): void {
              if (matchesKey(data, Key.escape)) {
                done(null);
                return;
              }
              if (matchesKey(data, Key.enter)) {
                const item = filtered[selectedIdx];
                done(item ? item.code : null);
                return;
              }

              // Focus: list <-> preview
              if (
                matchesKey(data, Key.right) ||
                matchesKey(data, "right") ||
                (!search && matchesKey(data, "f"))
              ) {
                if (focus !== "preview" && filtered[selectedIdx]) {
                  focus = "preview";
                  ensurePreviewVisible();
                  tui.requestRender();
                }
                return;
              }
              if (matchesKey(data, Key.left) || matchesKey(data, "left")) {
                if (focus !== "list") {
                  focus = "list";
                  tui.requestRender();
                }
                return;
              }
              if (matchesKey(data, "ctrl+f")) {
                focus = focus === "list" ? "preview" : "list";
                if (focus === "preview") ensurePreviewVisible();
                tui.requestRender();
                return;
              }

              if (matchesKey(data, Key.up) || matchesKey(data, "ctrl+p") || matchesKey(data, "k")) {
                if (focus === "preview") {
                  if (previewOffset > 0) {
                    previewOffset--;
                    tui.requestRender();
                  }
                } else if (selectedIdx > 0) {
                  selectIndex(selectedIdx - 1);
                  tui.requestRender();
                }
                return;
              }
              if (matchesKey(data, Key.down) || matchesKey(data, "ctrl+n") || matchesKey(data, "j")) {
                if (focus === "preview") {
                  if (previewOffset < maxPreviewOffset()) {
                    previewOffset++;
                    tui.requestRender();
                  }
                } else if (selectedIdx < filtered.length - 1) {
                  selectIndex(selectedIdx + 1);
                  tui.requestRender();
                }
                return;
              }
              if (matchesKey(data, Key.home) || matchesKey(data, "ctrl+a")) {
                if (focus === "preview") {
                  if (previewOffset !== 0) {
                    previewOffset = 0;
                    tui.requestRender();
                  }
                } else if (selectedIdx !== 0) {
                  selectIndex(0);
                  tui.requestRender();
                }
                return;
              }
              if (matchesKey(data, Key.end) || matchesKey(data, "ctrl+e")) {
                if (focus === "preview") {
                  const max = maxPreviewOffset();
                  if (previewOffset !== max) {
                    previewOffset = max;
                    tui.requestRender();
                  }
                } else {
                  const last = Math.max(0, filtered.length - 1);
                  if (selectedIdx !== last) {
                    selectIndex(last);
                    tui.requestRender();
                  }
                }
                return;
              }
              if (matchesKey(data, "pageUp")) {
                if (focus === "preview") {
                  previewOffset = Math.max(0, previewOffset - previewRows);
                  tui.requestRender();
                } else if (filtered.length > 0) {
                  selectIndex(Math.max(0, selectedIdx - listRows));
                  tui.requestRender();
                }
                return;
              }
              if (matchesKey(data, "pageDown")) {
                if (focus === "preview") {
                  previewOffset = Math.min(maxPreviewOffset(), previewOffset + previewRows);
                  tui.requestRender();
                } else if (filtered.length > 0) {
                  selectIndex(Math.min(filtered.length - 1, selectedIdx + listRows));
                  tui.requestRender();
                }
                return;
              }

              // Toggle scope: last reply <-> all replies
              if (
                matchesKey(data, Key.tab) ||
                matchesKey(data, "tab") ||
                matchesKey(data, "shift+tab") ||
                (!search && matchesKey(data, "s"))
              ) {
                scope = scope === "last" ? "all" : "last";
                selectedIdx = 0;
                listOffset = 0;
                focus = "list";
                previewOffset = 0;
                applyFilter();
                return;
              }

              // Absolute scope shortcuts when not searching
              if (!search && matchesKey(data, "a")) {
                if (scope !== "all") {
                  scope = "all";
                  selectedIdx = 0;
                  listOffset = 0;
                  focus = "list";
                  previewOffset = 0;
                  applyFilter();
                }
                return;
              }
              if (!search && matchesKey(data, "l")) {
                if (scope !== "last") {
                  scope = "last";
                  selectedIdx = 0;
                  listOffset = 0;
                  focus = "list";
                  previewOffset = 0;
                  applyFilter();
                }
                return;
              }

              if (!search && data.length === 1 && data >= "1" && data <= "9") {
                const idx = parseInt(data, 10) - 1;
                if (idx < filtered.length) {
                  focus = "list";
                  selectIndex(idx);
                  tui.requestRender();
                }
                return;
              }
              if (matchesKey(data, Key.backspace)) {
                if (search.length > 0) { search = search.slice(0, -1); applyFilter(); }
                return;
              }
              if (matchesKey(data, "ctrl+u")) {
                if (search.length > 0) { search = ""; applyFilter(); }
                return;
              }
              // While preview is focused, ignore plain typing
              if (focus === "preview") return;

              const ch = decodePrintable(data);
              if (ch && ch >= " ") {
                search += ch;
                applyFilter();
              }
            },
          };
        },
        {
          overlay: true,
          overlayOptions: {
            width: "68%",
            minWidth: 60,
            maxHeight: "75%",
            anchor: "bottom-center",
            margin: { bottom: 1 },
          },
        },
      );

      if (code) {
        try {
          await copyToClipboard(code);
          const n = code.split("\n").length;
          ctx.ui.notify("✓ 已复制 " + n + " 行代码", "success");
        } catch (err) {
          ctx.ui.notify("复制失败: " + String(err), "error");
        }
      }
    },
  });
}

function createEmptyState(theme: ThemeLike, done: () => void) {
  return {
    invalidate() {},
    render(width: number): string[] {
      const W = Math.max(36, width);
      const innerW = Math.max(0, W - 2);
      const titlePlain = " ✦ Code Blocks ";
      const titleColored = theme.fg("accent", theme.bold(" ✦ Code Blocks "));
      return [
        boxTop(theme, titleColored, titlePlain, W, { surface: "chrome", border: "frame" }),
        boxRow(theme, "", W, { surface: "body" }),
        boxRow(
          theme,
          centerVisible(theme.fg("text", theme.bold("No code blocks found")), innerW),
          W,
          { surface: "body" },
        ),
        boxRow(
          theme,
          centerVisible(theme.fg("muted", "in this session yet"), innerW),
          W,
          { surface: "body" },
        ),
        boxRow(theme, "", W, { surface: "body" }),
        boxRow(
          theme,
          centerVisible(theme.fg("dim", "Tip: ask for code in ``` fences"), innerW),
          W,
          { surface: "body" },
        ),
        boxRow(theme, "", W, { surface: "body" }),
        boxRule(theme, W, { surface: "chrome", border: "muted" }),
        boxRow(
          theme,
          centerVisible(
            keyHint(theme, "esc", "or") +
              theme.fg("dim", " ") +
              keyHint(theme, "↵", "close"),
            innerW,
          ),
          W,
          { surface: "chrome", border: "frame" },
        ),
        boxBottom(theme, W, { surface: "chrome", border: "frame" }),
      ];

    },
    handleInput(data: string): void {
      if (
        matchesKey(data, Key.escape) ||
        matchesKey(data, Key.enter) ||
        matchesKey(data, "q") ||
        matchesKey(data, "ctrl+c")
      ) {
        done();
      }
    },
  };
}

function decodePrintable(data: string): string | undefined {
  const kitty = decodeKittyPrintable(data);
  if (kitty) return kitty;
  if (data.length === 1) {
    const code = data.charCodeAt(0);
    if (code >= 32 && code !== 127) return data;
  }
  return undefined;
}

function extractCodeBlocks(entries: unknown): CodeBlock[] {
  const out: CodeBlock[] = [];
  if (!Array.isArray(entries)) return out;

  let answer = 0;
  let num = 0;

  for (const e of entries) {
    const entry = e as Record<string, unknown> | null;
    if (!entry || entry.type !== "message") continue;
    const msg = entry.message as Record<string, unknown> | undefined;
    if (!msg || msg.role !== "assistant") continue;
    answer++;

    const content = msg.content;
    if (!Array.isArray(content)) continue;

    for (const c of content) {
      const block = c as Record<string, unknown> | null;
      if (!block || block.type !== "text" || typeof block.text !== "string") continue;

      const text = block.text;
      const fenceOpen = "(" + "`".repeat(3) + "+|" + "~".repeat(3) + "+)";
      const re = new RegExp(fenceOpen + "([^\\n]*)\\n([\\s\\S]*?)\\1", "g");
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        const lang = (m[2] || "").trim();
        let code = m[3] || "";
        code = code.replace(/\n+$/, "");
        if (code.length === 0) continue;

        const codeLines = code.split("\n");
        out.push({
          num: ++num,
          answer,
          lang: lang || "text",
          code,
          firstLine: codeLines[0] || "",
          lines: codeLines.length,
        });
      }
    }
  }
  return out;
}
