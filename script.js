(() => {
  "use strict";

  /* ===== 設定値（必要に応じて変更してください） ===== */
  const SEPARATOR = ": ";      // 行番号とコードの間の文字（例: "  " や " | " に変更可）
  const FONT_MIN = 12;
  const FONT_MAX = 40;
  const FONT_STEP = 2;
  const FONT_DEFAULT = 18;

  const SAMPLE = String.raw`#include <stdio.h>

/* 配列の合計と平均を求めるプログラム */
int main(void)
{
    int score[5] = {70, 85, 90, 65, 100};
    int sum = 0;
    double average;

    for (int i = 0; i < 5; i++) {
        sum += score[i];   // 合計を求める
    }
    average = (double)sum / 5;

    if (average >= 80.0) {
        printf("平均点は %.1f 点です。よくできました！\n", average);
    } else {
        printf("平均点は %.1f 点です。\n", average);
    }
    return 0;
}
`;

  /* ===== 要素 ===== */
  const $ = (id) => document.getElementById(id);
  const els = {
    source: $("source"),
    output: $("output"),
    lineCount: $("lineCount"),
    start: $("startNumber"),
    tab: $("tabWidth"),
    fontDown: $("fontDown"),
    fontUp: $("fontUp"),
    fontLabel: $("fontSizeLabel"),
    themeLight: $("themeLight"),
    themeDark: $("themeDark"),
    sample: $("sampleBtn"),
    clear: $("clearBtn"),
    copy: $("copyBtn"),
    copyStatus: $("copyStatus"),
    step2: $("step2"),
    step3: $("step3"),
  };

  const store = {
    get(key) { try { return localStorage.getItem(key); } catch (e) { return null; } },
    set(key, value) { try { localStorage.setItem(key, value); } catch (e) { /* 保存できなくても動作に影響なし */ } },
  };

  /* ===== シンタックスハイライト ===== */
  const KEYWORDS = new Set([
    "auto", "break", "case", "const", "continue", "default", "do", "else", "enum",
    "extern", "for", "goto", "if", "inline", "register", "restrict", "return",
    "sizeof", "static", "struct", "switch", "typedef", "union", "volatile", "while",
  ]);
  const TYPES = new Set([
    "char", "double", "float", "int", "long", "short", "signed", "unsigned", "void",
    "_Bool", "bool", "size_t", "FILE",
    "int8_t", "int16_t", "int32_t", "int64_t", "uint8_t", "uint16_t", "uint32_t", "uint64_t",
  ]);
  const CONSTS = new Set(["NULL", "true", "false", "EOF"]);

  const TOKEN_RE = new RegExp([
    /\/\*[\s\S]*?(?:\*\/|(?![\s\S]))/.source,                                     // 1: ブロックコメント
    /\/\/[^\n]*/.source,                                                          // 2: 行コメント
    /^[ \t]*#[^\n]*/.source,                                                      // 3: プリプロセッサ
    /"(?:\\.|[^"\\\n])*"?/.source,                                                // 4: 文字列
    /'(?:\\.|[^'\\\n])*'?/.source,                                                // 5: 文字定数
    /(?:0[xX][0-9a-fA-F]+|(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)[uUlLfF]*/.source, // 6: 数値
    /[A-Za-z_]\w*/.source,                                                        // 7: 識別子
  ].map((s) => "(" + s + ")").join("|"), "gm");

  const FN_RE = /\s*\(/y;

  const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;" };
  const escapeHtml = (s) => s.replace(/[&<>]/g, (c) => ESC[c]);

  // ソース全体を字句解析し、行ごとのHTMLに分割する（複数行コメントにも対応）
  function highlightToLines(text) {
    const lines = [""];

    const push = (str, cls) => {
      str.split("\n").forEach((part, i) => {
        if (i > 0) lines.push("");
        if (part === "") return;
        const e = escapeHtml(part);
        lines[lines.length - 1] += cls ? `<span class="${cls}">${e}</span>` : e;
      });
    };

    let last = 0;
    let m;
    TOKEN_RE.lastIndex = 0;
    while ((m = TOKEN_RE.exec(text)) !== null) {
      if (m.index > last) push(text.slice(last, m.index), "");

      let cls = "";
      if (m[1] !== undefined) cls = "tok-comment";
      else if (m[2] !== undefined) cls = "tok-comment";
      else if (m[3] !== undefined) cls = "tok-preproc";
      else if (m[4] !== undefined || m[5] !== undefined) cls = "tok-string";
      else if (m[6] !== undefined) cls = "tok-number";
      else {
        const word = m[7];
        if (KEYWORDS.has(word)) cls = "tok-keyword";
        else if (TYPES.has(word)) cls = "tok-type";
        else if (CONSTS.has(word)) cls = "tok-number";
        else {
          FN_RE.lastIndex = TOKEN_RE.lastIndex;
          if (FN_RE.test(text)) cls = "tok-func";
        }
      }

      push(m[0], cls);
      last = TOKEN_RE.lastIndex;
    }
    if (last < text.length) push(text.slice(last), "");
    return lines;
  }

  /* ===== タブ展開（全角文字は幅2として数える） ===== */
  const WIDE_RE = /[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE6F\uFF00-\uFF60\uFFE0-\uFFE6]/;

  function expandTabs(line, width) {
    if (line.indexOf("\t") === -1) return line;
    let out = "";
    let col = 0;
    for (const ch of line) {
      if (ch === "\t") {
        const n = width - (col % width);
        out += " ".repeat(n);
        col += n;
      } else {
        out += ch;
        col += WIDE_RE.test(ch) ? 2 : 1;
      }
    }
    return out;
  }

  /* ===== 変換・表示 ===== */
  let copyPayload = "";

  function getStartNumber() {
    const n = parseInt(els.start.value, 10);
    if (!Number.isFinite(n) || n < 0) return 1;
    return Math.min(n, 99999);
  }

  function render() {
    const raw = els.source.value.replace(/\r\n?/g, "\n").trimEnd();
    resetCopyFeedback();

    if (raw.trim() === "") {
      copyPayload = "";
      els.output.innerHTML =
        '<div class="placeholder">① にコードを貼り付けると、ここに行番号つきで自動表示されます。</div>';
      els.lineCount.textContent = "";
      els.step2.classList.add("is-empty");
      els.step3.classList.add("is-empty");
      els.copy.disabled = true;
      return;
    }

    const tabWidth = parseInt(els.tab.value, 10) || 4;
    const plainLines = raw.split("\n").map((l) => expandTabs(l, tabWidth));
    const htmlLines = highlightToLines(plainLines.join("\n"));

    const start = getStartNumber();
    const width = String(start + plainLines.length - 1).length;
    const label = (i) => String(start + i).padStart(width, " ") + SEPARATOR;

    els.output.innerHTML = htmlLines
      .map((h, i) => `<div class="line"><span class="ln">${label(i)}</span>${h}</div>`)
      .join("");

    copyPayload = plainLines.map((l, i) => (label(i) + l).trimEnd()).join("\n");

    els.lineCount.textContent = `全 ${plainLines.length} 行`;
    els.step2.classList.remove("is-empty");
    els.step3.classList.remove("is-empty");
    els.copy.disabled = false;
  }

  /* ===== コピー ===== */
  let copyTimer = null;
  const COPY_LABEL = "📋 行番号つきでコピー";

  function resetCopyFeedback() {
    clearTimeout(copyTimer);
    els.copy.classList.remove("copied");
    els.copy.textContent = COPY_LABEL;
    els.copyStatus.textContent = "";
    els.copyStatus.classList.remove("error");
  }

  async function writeClipboard(text) {
    if (navigator.clipboard && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch (e) { /* フォールバックへ */ }
    }
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.cssText = "position:fixed;top:0;left:0;opacity:0;";
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
    document.body.removeChild(ta);
    return ok;
  }

  async function onCopy() {
    if (!copyPayload) return;
    const ok = await writeClipboard(copyPayload);
    clearTimeout(copyTimer);
    if (ok) {
      const n = copyPayload.split("\n").length;
      els.copy.classList.add("copied");
      els.copy.textContent = "✔ コピーしました！";
      els.copyStatus.classList.remove("error");
      els.copyStatus.textContent = `${n}行をコピーしました。貼り付けてお使いください。`;
      copyTimer = setTimeout(resetCopyFeedback, 3000);
    } else {
      els.copyStatus.classList.add("error");
      els.copyStatus.textContent =
        "コピーできませんでした。②の表示を範囲選択して Ctrl+C（⌘+C）でコピーしてください。";
    }
  }

  /* ===== 文字サイズ ===== */
  let fontSize = FONT_DEFAULT;

  function setFontSize(px) {
    fontSize = Math.max(FONT_MIN, Math.min(FONT_MAX, px));
    document.documentElement.style.setProperty("--code-size", fontSize + "px");
    els.fontLabel.textContent = fontSize + "px";
    els.fontDown.disabled = fontSize <= FONT_MIN;
    els.fontUp.disabled = fontSize >= FONT_MAX;
    store.set("lineno-font", String(fontSize));
  }

  /* ===== 配色 ===== */
  function setTheme(theme) {
    const t = theme === "dark" ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", t);
    els.themeLight.setAttribute("aria-pressed", String(t === "light"));
    els.themeDark.setAttribute("aria-pressed", String(t === "dark"));
    store.set("lineno-theme", t);
  }

  /* ===== イベント ===== */
  els.source.addEventListener("input", render);
  els.start.addEventListener("input", render);
  els.tab.addEventListener("change", render);

  els.sample.addEventListener("click", () => {
    els.source.value = SAMPLE;
    render();
  });
  els.clear.addEventListener("click", () => {
    els.source.value = "";
    render();
    els.source.focus();
  });

  els.copy.addEventListener("click", onCopy);

  els.fontDown.addEventListener("click", () => setFontSize(fontSize - FONT_STEP));
  els.fontUp.addEventListener("click", () => setFontSize(fontSize + FONT_STEP));

  els.themeLight.addEventListener("click", () => setTheme("light"));
  els.themeDark.addEventListener("click", () => setTheme("dark"));

  /* ===== 初期化 ===== */
  const savedFont = parseInt(store.get("lineno-font"), 10);
  setFontSize(Number.isFinite(savedFont) ? savedFont : FONT_DEFAULT);
  setTheme(store.get("lineno-theme") === "dark" ? "dark" : "light");
  render();
})();
