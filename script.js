(() => {
  "use strict";

  /* ===== 設定値（必要に応じて変更してください） ===== */
  const SEPARATOR = ": ";      // 行番号とコードの間の文字（例: "  " や " | " に変更可）
  const FONT_MIN = 12;
  const FONT_MAX = 40;
  const FONT_STEP = 2;
  const FONT_DEFAULT = 18;

  // 「色つきでコピー」で貼り付けた後の見た目（画面の文字サイズ設定とは無関係に固定）
  const RICH_FONT_FAMILY = "Consolas, 'MS Gothic', 'BIZ UDGothic', monospace";
  const RICH_FONT_PT = 11;
  const RICH_LINE_HEIGHT = 1.35;

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
    themeNote: $("themeNote"),
    sample: $("sampleBtn"),
    clear: $("clearBtn"),
    copyPlain: $("copyPlainBtn"),
    copyRich: $("copyRichBtn"),
    copyStatus: $("copyStatus"),
    step2: $("step2"),
    step3: $("step3"),
    step4: $("step4"),
    stdin: $("stdinText"),
    echo: $("echoCheck"),
    run: $("runBtn"),
    result: $("result"),
    copyResult: $("copyResultBtn"),
    copyAll: $("copyAllBtn"),
    copyStatus2: $("copyStatus2"),
  };

  // ファイルの版が食い違っている（一部だけ古い）場合は、動かさずに案内を出す
  const missing = Object.keys(els).filter((k) => !els[k]);
  if (missing.length > 0) {
    const bar = document.createElement("div");
    bar.className = "version-banner";
    bar.textContent = "ファイルの版が食い違っています。index.html・style.css・script.js・cinterp.js の4つをすべて最新に入れ替え、Ctrl+F5 で再読み込みしてください。";
    document.body.insertBefore(bar, document.body.firstChild);
    return;
  }
  const hasInterp = typeof globalThis.CInterp !== "undefined" && typeof globalThis.CInterp.run === "function";

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

  // 色つきコピー用：トークン種別 → CSS変数名と装飾（色は現在の配色から読み取る）
  const TOKEN_STYLE = {
    "tok-keyword": { v: "--tok-keyword", bold: true },
    "tok-type":    { v: "--tok-type" },
    "tok-string":  { v: "--tok-string" },
    "tok-number":  { v: "--tok-number" },
    "tok-comment": { v: "--tok-comment", italic: true },
    "tok-preproc": { v: "--tok-preproc" },
    "tok-func":    { v: "--tok-func" },
  };

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

  // ソース全体を字句解析し、行ごとのトークン配列 [{t: 文字列, c: クラス名}] に分割する
  // （複数行コメントにも対応）
  function highlightToLines(text) {
    const lines = [[]];

    const push = (str, cls) => {
      str.split("\n").forEach((part, i) => {
        if (i > 0) lines.push([]);
        if (part !== "") lines[lines.length - 1].push({ t: part, c: cls });
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

  const tokenToHtml = (tk) => {
    const e = escapeHtml(tk.t);
    return tk.c ? `<span class="${tk.c}">${e}</span>` : e;
  };

  /* ===== タブ展開（全角文字は幅2として数える） ===== */
  const WIDE_RE = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹯＀-｠￠-￦]/;

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
  // state: 現在の変換結果（コピー時に使う）。空のときは null
  let state = null;

  function getStartNumber() {
    const n = parseInt(els.start.value, 10);
    if (!Number.isFinite(n) || n < 0) return 1;
    return Math.min(n, 99999);
  }

  function setCopyEnabled(enabled) {
    els.copyPlain.disabled = !enabled;
    els.copyRich.disabled = !enabled;
    els.run.disabled = !enabled || !hasInterp;
    els.step4.classList.toggle("is-empty", !enabled);
  }

  const RESULT_PLACEHOLDER = '<div class="placeholder">「▶ 実行する」を押すと、ここに実行結果が表示されます。</div>';

  function clearResult() {
    lastRun = null;
    els.result.innerHTML = hasInterp
      ? RESULT_PLACEHOLDER
      : '<div class="placeholder">cinterp.js が読み込めないため、実行機能は使えません。</div>';
    els.copyResult.disabled = true;
    els.copyAll.disabled = true;
    resetCopyFeedback2();
    const bad = els.output.querySelector(".line.err");
    if (bad) bad.classList.remove("err");
  }

  function render() {
    const raw = els.source.value.replace(/\r\n?/g, "\n").trimEnd();
    resetCopyFeedback();
    clearResult();

    if (raw.trim() === "") {
      state = null;
      els.output.innerHTML =
        '<div class="placeholder">① にコードを貼り付けると、ここに行番号つきで自動表示されます。</div>';
      els.lineCount.textContent = "";
      els.step2.classList.add("is-empty");
      els.step3.classList.add("is-empty");
      setCopyEnabled(false);
      return;
    }

    const tabWidth = parseInt(els.tab.value, 10) || 4;
    const plainLines = raw.split("\n").map((l) => expandTabs(l, tabWidth));
    const tokenLines = highlightToLines(plainLines.join("\n"));

    const start = getStartNumber();
    const width = String(start + plainLines.length - 1).length;
    const labels = plainLines.map((_, i) => String(start + i).padStart(width, " ") + SEPARATOR);

    els.output.innerHTML = tokenLines
      .map((tokens, i) =>
        `<div class="line"><span class="ln">${labels[i]}</span>${tokens.map(tokenToHtml).join("")}</div>`)
      .join("");

    state = {
      source: plainLines.join("\n"),
      start,
      tokenLines,
      labels,
      plain: plainLines.map((l, i) => (labels[i] + l).trimEnd()).join("\n"),
    };

    els.lineCount.textContent = `全 ${plainLines.length} 行`;
    els.step2.classList.remove("is-empty");
    els.step3.classList.remove("is-empty");
    setCopyEnabled(true);
  }

  /* ===== 色つきコピー用HTMLの生成 =====
     Word・PowerPoint等はCSS変数を解釈しないため、現在の配色の色を読み取って
     インライン指定にする。1セルの表で囲むと、背景色が崩れにくい。 */
  function buildRichHtml(tokenLines, labels) {
    const cs = getComputedStyle(document.documentElement);
    const css = (name) => cs.getPropertyValue(name).trim();
    const bg = css("--code-bg");
    const fg = css("--text");
    const lnColor = css("--ln");
    const border = css("--border");

    const base = `font-family:${RICH_FONT_FAMILY};font-size:${RICH_FONT_PT}pt;line-height:${RICH_LINE_HEIGHT};`;
    // 連続する空白が詰められないよう、空白は &nbsp; にする
    const nb = (s) => escapeHtml(s).replace(/ /g, "&nbsp;");
    const span = (text, color, extra) =>
      `<span style="color:${color};${extra || ""}">${nb(text)}</span>`;

    const paras = tokenLines.map((tokens, i) => {
      let inner = span(labels[i], lnColor);
      for (const tk of tokens) {
        const st = TOKEN_STYLE[tk.c];
        if (st) {
          inner += span(tk.t, css(st.v),
            (st.bold ? "font-weight:bold;" : "") + (st.italic ? "font-style:italic;" : ""));
        } else {
          inner += span(tk.t, fg);
        }
      }
      return `<p style="margin:0;${base}color:${fg};">${inner}</p>`;
    }).join("");

    return '<meta charset="utf-8">' +
      `<table cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid ${border};">` +
      `<tbody><tr><td bgcolor="${bg}" style="background-color:${bg};padding:8px 12px;">${paras}</td></tr></tbody></table>`;
  }

  /* ===== コピー ===== */
  let copyTimer = null;
  const PLAIN_LABEL = "📋 行番号つきでコピー（文字のみ）";
  const RICH_LABEL = "🎨 行番号つきでコピー（色つき）";

  function resetCopyFeedback() {
    clearTimeout(copyTimer);
    els.copyPlain.classList.remove("copied");
    els.copyRich.classList.remove("copied");
    els.copyPlain.textContent = PLAIN_LABEL;
    els.copyRich.textContent = RICH_LABEL;
    els.copyStatus.textContent = "";
    els.copyStatus.classList.remove("error");
  }

  // 古いブラウザ・http環境向け：copyイベントで文字と書式の両方を差し込む
  function legacyCopy(plain, html) {
    const ta = document.createElement("textarea");
    ta.value = plain;
    ta.setAttribute("readonly", "");
    ta.style.cssText = "position:fixed;top:0;left:0;opacity:0;";
    document.body.appendChild(ta);
    ta.select();

    let intercepted = false;
    const onCopyEvent = (e) => {
      if (!e.clipboardData) return;
      e.clipboardData.setData("text/plain", plain);
      if (html) e.clipboardData.setData("text/html", html);
      e.preventDefault();
      intercepted = true;
    };
    document.addEventListener("copy", onCopyEvent);

    let ok = false;
    try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
    document.removeEventListener("copy", onCopyEvent);
    document.body.removeChild(ta);

    // 色つきを求められたのに書式を渡せなかった場合は失敗として扱う
    return ok && (!html || intercepted);
  }

  async function writeClipboard(plain, html) {
    if (navigator.clipboard && window.isSecureContext) {
      try {
        if (!html) {
          await navigator.clipboard.writeText(plain);
          return true;
        }
        if (typeof ClipboardItem !== "undefined" && navigator.clipboard.write) {
          await navigator.clipboard.write([
            new ClipboardItem({
              "text/html": new Blob([html], { type: "text/html" }),
              "text/plain": new Blob([plain], { type: "text/plain" }),
            }),
          ]);
          return true;
        }
      } catch (e) { /* フォールバックへ */ }
    }
    return legacyCopy(plain, html);
  }

  async function onCopy(kind) {
    if (!state) return;
    const rich = kind === "rich";
    // クリックの直後に同期的に作る（ブラウザのコピー許可のため）
    const html = rich ? buildRichHtml(state.tokenLines, state.labels) : null;
    const plain = state.plain;
    const n = state.labels.length;

    const ok = await writeClipboard(plain, html);
    resetCopyFeedback();

    if (ok) {
      const btn = rich ? els.copyRich : els.copyPlain;
      btn.classList.add("copied");
      btn.textContent = "✔ コピーしました！";
      els.copyStatus.textContent = rich
        ? `${n}行を色つきでコピーしました。Word・PowerPointなどに貼り付けてください。`
        : `${n}行を文字のみでコピーしました。`;
      copyTimer = setTimeout(resetCopyFeedback, 3000);
    } else {
      els.copyStatus.classList.add("error");
      els.copyStatus.textContent = rich
        ? "色つきでコピーできませんでした。「文字のみ」でコピーするか、②の表示を範囲選択して Ctrl+C（⌘+C）でコピーしてください。"
        : "コピーできませんでした。②の表示を範囲選択して Ctrl+C（⌘+C）でコピーしてください。";
    }
  }

  /* ===== ④ 実行 ===== */
  let lastRun = null;       // { output, text }（コピー用）
  let copyTimer2 = null;
  const RES_BG = "#1e1e1e";
  const RES_FG = "#f0f0f0";

  function resetCopyFeedback2() {
    clearTimeout(copyTimer2);
    els.copyResult.classList.remove("copied");
    els.copyAll.classList.remove("copied");
    els.copyResult.textContent = "📋 実行結果だけコピー";
    els.copyAll.textContent = "🎨 コードと実行結果をまとめてコピー";
    els.copyStatus2.textContent = "";
    els.copyStatus2.classList.remove("error");
  }

  function showResult(res) {
    let html = "";
    const err = res.error;
    const out = res.output || "";

    if (err && res.phase !== "run") {
      html += `<div class="res-err"><strong>コンパイルエラー（実行できません）</strong>${
        err.line ? escapeHtml(String(err.line)) + " 行目：" : ""}${escapeHtml(err.message)}</div>`;
    } else {
      html += out === ""
        ? '<pre class="out muted">（出力はありません）</pre>'
        : `<pre class="out">${escapeHtml(out)}</pre>`;
      if (err) {
        html += `<div class="res-err"><strong>実行中にエラー${err.line ? "（" + escapeHtml(String(err.line)) + " 行目）" : ""}</strong>${escapeHtml(err.message)}</div>`;
      } else if (res.exitCode) {
        html += `<div class="res-meta">プログラムは終了コード ${escapeHtml(String(res.exitCode))} で終了しました。</div>`;
      }
      if (res.eofHit && els.stdin.value.trim() === "") {
        html += '<div class="res-note">入力欄が空でした。scanf などで値を読み込むプログラムは、上の入力欄に値を書いてから実行してください。</div>';
      }
    }
    els.result.innerHTML = html;

    if (err && err.line) {
      const idx = err.line - state.start;
      const row = els.output.querySelectorAll(".line")[idx];
      if (row) {
        row.classList.add("err");
        row.scrollIntoView({ block: "nearest" });
      }
    }

    const copyable = res.phase === "run" && out !== "";
    lastRun = copyable ? { output: out } : null;
    els.copyResult.disabled = !copyable;
    els.copyAll.disabled = !copyable;
  }

  function runProgram() {
    if (!state || !hasInterp) return;
    clearResult();
    els.run.disabled = true;
    els.run.textContent = "実行中…";
    const src = state.source;
    const start = state.start;
    setTimeout(() => {
      let res;
      try {
        res = globalThis.CInterp.run(src, {
          input: els.stdin.value,
          lineOffset: start - 1,
          timeLimitMs: 5000,
          echoInput: els.echo.checked,
          longSize: 4,
        });
      } catch (e) {
        res = { output: "", exitCode: 1, phase: "run", error: { message: "内部エラーが起きました：" + (e && e.message ? e.message : e), line: 0 } };
      }
      showResult(res);
      els.run.textContent = "▶ 実行する";
      els.run.disabled = false;
    }, 30);
  }

  const trimEndNl = (s) => s.replace(/\n+$/, "");

  function resultTableHtml(output) {
    const base = `font-family:${RICH_FONT_FAMILY};font-size:${RICH_FONT_PT}pt;line-height:${RICH_LINE_HEIGHT};`;
    const nb = (s) => escapeHtml(s).replace(/ /g, "&nbsp;");
    const paras = trimEndNl(output).split("\n").map((l) =>
      `<p style="margin:0;${base}color:${RES_FG};"><span style="color:${RES_FG};">${l === "" ? "&nbsp;" : nb(l)}</span></p>`
    ).join("");
    return '<table cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #000000;">' +
      `<tbody><tr><td bgcolor="${RES_BG}" style="background-color:${RES_BG};padding:8px 12px;">${paras}</td></tr></tbody></table>`;
  }

  async function onCopyResult(kind) {
    if (!state || !lastRun) return;
    const all = kind === "all";
    const out = lastRun.output;
    let plain, html = null;
    if (all) {
      const codeHtml = buildRichHtml(state.tokenLines, state.labels).replace('<meta charset="utf-8">', "");
      const labelP = `<p style="margin:0;font-family:${RICH_FONT_FAMILY};font-size:${RICH_FONT_PT}pt;font-weight:bold;">【実行結果】</p>`;
      html = '<meta charset="utf-8">' + codeHtml + "<p>&nbsp;</p>" + labelP + resultTableHtml(out);
      plain = state.plain + "\n\n【実行結果】\n" + trimEndNl(out);
    } else {
      plain = out;
    }
    const ok = await writeClipboard(plain, html);
    resetCopyFeedback2();
    if (ok) {
      const btn = all ? els.copyAll : els.copyResult;
      btn.classList.add("copied");
      btn.textContent = "✔ コピーしました！";
      els.copyStatus2.textContent = all
        ? "コードと実行結果をコピーしました。Word に貼るときは貼り付けオプションで「元の書式を保持」を選んでください。"
        : "実行結果をコピーしました。";
      copyTimer2 = setTimeout(resetCopyFeedback2, 3000);
    } else {
      els.copyStatus2.classList.add("error");
      els.copyStatus2.textContent = "コピーできませんでした。実行結果を範囲選択して Ctrl+C（⌘+C）でコピーしてください。";
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
    els.themeNote.textContent = t === "dark" ? "ダーク：黒背景" : "ライト：白背景";
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

  els.copyPlain.addEventListener("click", () => onCopy("plain"));
  els.copyRich.addEventListener("click", () => onCopy("rich"));

  els.run.addEventListener("click", runProgram);
  els.copyResult.addEventListener("click", () => onCopyResult("result"));
  els.copyAll.addEventListener("click", () => onCopyResult("all"));
  els.echo.addEventListener("change", () => store.set("lineno-echo", els.echo.checked ? "1" : "0"));

  els.fontDown.addEventListener("click", () => setFontSize(fontSize - FONT_STEP));
  els.fontUp.addEventListener("click", () => setFontSize(fontSize + FONT_STEP));

  els.themeLight.addEventListener("click", () => setTheme("light"));
  els.themeDark.addEventListener("click", () => setTheme("dark"));

  /* ===== 初期化 ===== */
  const savedFont = parseInt(store.get("lineno-font"), 10);
  setFontSize(Number.isFinite(savedFont) ? savedFont : FONT_DEFAULT);
  setTheme(store.get("lineno-theme") === "dark" ? "dark" : "light");
  els.echo.checked = store.get("lineno-echo") !== "0";
  render();
})();
