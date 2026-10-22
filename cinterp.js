/* ===== C言語 簡易インタプリタ：字句解析・プリプロセッサ ===== */
(function (g) {
  "use strict";

  class CError extends Error {
    constructor(message, line) {
      super(message);
      this.name = "CError";
      this.cMessage = message;
      this.line = line;
    }
  }

  const KEYWORDS = new Set([
    "auto", "break", "case", "char", "const", "continue", "default", "do", "double",
    "else", "enum", "extern", "float", "for", "goto", "if", "int", "long", "register",
    "return", "short", "signed", "sizeof", "static", "struct", "switch", "typedef",
    "union", "unsigned", "void", "volatile", "while", "_Bool",
  ]);

  // あらかじめ定義されているマクロ（ヘッダファイルの代わり）
  const PREDEF = {
    NULL: "0", EOF: "(-1)", M_PI: "3.14159265358979323846", M_E: "2.71828182845904523536",
    RAND_MAX: "32767", INT_MAX: "2147483647", INT_MIN: "(-2147483647-1)",
    UINT_MAX: "4294967295u", CHAR_BIT: "8",
    LLONG_MAX: "9223372036854775807LL", LLONG_MIN: "(-9223372036854775807LL-1)",
    stdin: "0", stdout: "1", stderr: "2", true: "1", false: "0", CLOCKS_PER_SEC: "1000",
    DBL_MAX: "1.7976931348623157e308", DBL_EPSILON: "2.220446049250313e-16",
    FLT_MAX: "3.40282347e38f",
  };

  const OPS3 = ["<<=", ">>=", "..."];
  const OPS2 = ["->", "++", "--", "<<", ">>", "<=", ">=", "==", "!=", "&&", "||",
    "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^="];
  const OPS1 = "+-*/%=<>!&|^~?:;,.()[]{}";

  const NUM_RE = /(0[xX][0-9a-fA-F]+|(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)([uUlLfF]*)/y;
  const ENC = new TextEncoder();

  // ソース文字列 → 生のトークン列（#で始まる行は dir トークンになる）
  function scan(src, line0) {
    const toks = [];
    const n = src.length;
    let i = 0;
    let line = line0;
    let lineStart = true;
    const err = (m) => { throw new CError(m, line); };

    const readEscape = () => {
      i++; // バックスラッシュ
      const e = src[i];
      if (e === undefined) err("文字列の途中でソースが終わっています");
      i++;
      switch (e) {
        case "n": return 10;
        case "t": return 9;
        case "r": return 13;
        case "a": return 7;
        case "b": return 8;
        case "f": return 12;
        case "v": return 11;
        case "\\": return 92;
        case "'": return 39;
        case '"': return 34;
        case "?": return 63;
        case "x": {
          let h = "";
          while (/[0-9a-fA-F]/.test(src[i] || "")) h += src[i++];
          if (!h) err("\\x の後ろに16進数がありません");
          return parseInt(h, 16) & 255;
        }
        default:
          if (e >= "0" && e <= "7") {
            let o = e;
            while (o.length < 3 && src[i] >= "0" && src[i] <= "7") o += src[i++];
            return parseInt(o, 8) & 255;
          }
          return e.charCodeAt(0) & 255;
      }
    };

    while (i < n) {
      const c = src[i];
      if (c === "\n") { line++; i++; lineStart = true; continue; }
      if (c === " " || c === "\t" || c === "\r" || c === "\f" || c === "\v") { i++; continue; }
      if (c === "/" && src[i + 1] === "/") { while (i < n && src[i] !== "\n") i++; continue; }
      if (c === "/" && src[i + 1] === "*") {
        const end = src.indexOf("*/", i + 2);
        if (end < 0) err("コメントが閉じられていません（*/ がありません）");
        for (let k = i; k < end; k++) if (src[k] === "\n") line++;
        i = end + 2;
        continue;
      }
      if (c === "#" && lineStart) {
        const startLine = line;
        let text = "";
        while (i < n && src[i] !== "\n") {
          if (src[i] === "\\" && src[i + 1] === "\n") { i += 2; line++; continue; }
          if (src[i] === "\\" && src[i + 1] === "\r" && src[i + 2] === "\n") { i += 3; line++; continue; }
          text += src[i++];
        }
        toks.push({ t: "dir", v: text, line: startLine });
        continue;
      }
      lineStart = false;

      if (/[A-Za-z_]/.test(c)) {
        let j = i + 1;
        while (j < n && /[A-Za-z0-9_]/.test(src[j])) j++;
        toks.push({ t: "id", v: src.slice(i, j), line });
        i = j;
        continue;
      }

      if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(src[i + 1] || ""))) {
        NUM_RE.lastIndex = i;
        const m = NUM_RE.exec(src);
        const body = m[1];
        const suf = m[2].toLowerCase();
        const isHex = /^0x/i.test(body);
        const isFloat = !isHex && /[.eE]/.test(body);
        const tok = {
          t: "num", line, isFloat, hex: false,
          u: suf.includes("u"), l: (suf.match(/l/g) || []).length, f: isFloat && suf.includes("f"),
        };
        if (isFloat) {
          tok.v = parseFloat(body);
        } else if (isHex) {
          tok.v = BigInt(body); tok.hex = true;
        } else if (body.length > 1 && body[0] === "0") {
          if (/[89]/.test(body)) err("8進数の定数に 8 か 9 が含まれています");
          tok.v = BigInt("0o" + body.slice(1)); tok.hex = true;
        } else {
          tok.v = BigInt(body);
        }
        toks.push(tok);
        i = NUM_RE.lastIndex;
        continue;
      }

      if (c === '"') {
        i++;
        const bytes = [];
        let closed = false;
        while (i < n) {
          const ch = src[i];
          if (ch === '"') { i++; closed = true; break; }
          if (ch === "\n") break;
          if (ch === "\\") {
            if (src[i + 1] === "\n") { i += 2; line++; continue; }
            bytes.push(readEscape());
            continue;
          }
          const cp = src.codePointAt(i);
          const s = String.fromCodePoint(cp);
          i += s.length;
          for (const b of ENC.encode(s)) bytes.push(b);
        }
        if (!closed) err('文字列が閉じられていません（" がありません）');
        toks.push({ t: "str", v: bytes, line });
        continue;
      }

      if (c === "'") {
        i++;
        let val;
        if (src[i] === "\\") {
          val = readEscape();
          if (val > 127) val -= 256;
        } else if (src[i] === undefined || src[i] === "\n" || src[i] === "'") {
          err("文字定数が空です");
        } else {
          const cp = src.codePointAt(i);
          if (cp > 127) err("文字定数 ' ' に全角文字は使えません。全角文字は文字列 \" \" で書いてください");
          val = cp;
          i++;
        }
        if (src[i] !== "'") err("文字定数が閉じられていません（' がありません）");
        i++;
        toks.push({ t: "chr", v: val, line });
        continue;
      }

      let op = null;
      const s3 = src.substr(i, 3);
      const s2 = src.substr(i, 2);
      if (OPS3.includes(s3)) op = s3;
      else if (OPS2.includes(s2)) op = s2;
      else if (OPS1.includes(c)) op = c;
      if (op === null) err(`使えない文字 '${c}' があります（全角の記号や空白が混ざっていないか確認してください）`);
      toks.push({ t: "op", v: op, line });
      i += op.length;
    }
    return toks;
  }

  // マクロ展開・#include/#define の処理
  function preprocess(raw) {
    const macros = new Map();
    const includes = [];
    for (const name of Object.keys(PREDEF)) macros.set(name, scan(PREDEF[name], 0));

    const out = [];
    const emit = (tok, active, line) => {
      if (tok.t === "id") {
        const body = macros.get(tok.v);
        if (body && !active.has(tok.v)) {
          const act = new Set(active);
          act.add(tok.v);
          for (const b of body) emit(b, act, line);
          return;
        }
        out.push({ t: KEYWORDS.has(tok.v) ? "kw" : "id", v: tok.v, line });
        return;
      }
      out.push(Object.assign({}, tok, { line }));
    };

    let lastLine = 1;
    for (const tok of raw) {
      lastLine = tok.line;
      if (tok.t !== "dir") { emit(tok, new Set(), tok.line); continue; }

      const text = tok.v.slice(1)
        .replace(/\/\*.*?\*\//g, " ")
        .replace(/\/\/.*$/, "")
        .trim();
      const m = /^(\w+)\s*(.*)$/.exec(text);
      if (!m) continue;
      const name = m[1];
      const rest = m[2];
      if (name === "include") {
        const mm = /^[<"]([^>"]+)[>"]/.exec(rest);
        if (mm) includes.push(mm[1]);
      } else if (name === "define") {
        const dm = /^([A-Za-z_]\w*)(\()?\s*(.*)$/.exec(rest);
        if (!dm) throw new CError("#define の書き方が正しくありません", tok.line);
        if (dm[2]) {
          throw new CError("引数つきマクロ（関数のように書く #define）は未対応です。通常の関数に書き換えてください", tok.line);
        }
        macros.set(dm[1], scan(dm[3], tok.line));
      } else if (name === "undef") {
        macros.delete(rest.trim());
      }
      // それ以外の指令（#pragma, #if など）は無視する
    }
    out.push({ t: "eof", v: "", line: lastLine });
    return { tokens: out, includes };
  }

  function tokenize(src, lineOffset) {
    return preprocess(scan(src, 1 + (lineOffset || 0)));
  }

  g.CLexer = { CError, tokenize };
})(globalThis);
/* ===== C言語 簡易インタプリタ：構文解析 ===== */
(function (g) {
  "use strict";
  const { CError } = g.CLexer;

  const TYPE_KW = new Set(["const", "volatile", "static", "extern", "register", "auto", "signed",
    "unsigned", "short", "long", "int", "char", "float", "double", "void", "_Bool", "enum"]);
  const TYPE_IDS = new Set(["size_t", "bool"]);
  const UNSUPPORTED = { struct: "構造体（struct）", union: "共用体（union）", typedef: "typedef", goto: "goto文" };
  const ASSIGN_OPS = new Set(["=", "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=", "<<=", ">>="]);
  const BINPREC = {
    "||": 1, "&&": 2, "|": 3, "^": 4, "&": 5, "==": 6, "!=": 6,
    "<": 7, ">": 7, "<=": 7, ">=": 7, "<<": 8, ">>": 8, "+": 9, "-": 9, "*": 10, "/": 10, "%": 10,
  };

  class Parser {
    constructor(tokens) { this.toks = tokens; this.p = 0; }

    get tok() { return this.toks[this.p]; }
    peek(k) { return this.toks[Math.min(this.p + (k === undefined ? 1 : k), this.toks.length - 1)]; }
    next() { const t = this.toks[this.p]; if (t.t !== "eof") this.p++; return t; }
    isOp(v) { const t = this.tok; return t.t === "op" && t.v === v; }
    isKw(v) { const t = this.tok; return t.t === "kw" && t.v === v; }
    accept(v) { if (this.isOp(v)) { this.p++; return true; } return false; }

    describe(t) {
      if (t.t === "eof") return "ファイルの終わり";
      if (t.t === "str") return "文字列";
      if (t.t === "num") return String(t.v);
      return t.v;
    }
    syntax(msg, line) {
      const t = this.tok;
      return new CError(`構文エラー: ${msg}（'${this.describe(t)}' の付近）`, line || t.line);
    }
    expect(v) {
      if (this.accept(v)) return;
      // 「;」や「)」の付け忘れは、直前のトークンがある行を指す
      const prev = this.toks[this.p - 1];
      const line = (v === ";" || v === ")") && prev ? prev.line : this.tok.line;
      throw this.syntax(`'${v}' が必要です`, line);
    }

    isTypeStart(t) {
      t = t || this.tok;
      return (t.t === "kw" && TYPE_KW.has(t.v)) || (t.t === "id" && TYPE_IDS.has(t.v));
    }

    /* ---------- 型 ---------- */
    parseSpec() {
      const start = this.tok;
      let sawAny = false, unsigned = false, short = false, longs = 0, base = null;
      let isStatic = false, enumItems = null;
      for (;;) {
        const t = this.tok;
        if (t.t === "kw" && TYPE_KW.has(t.v)) {
          this.p++; sawAny = true;
          switch (t.v) {
            case "unsigned": unsigned = true; break;
            case "short": short = true; break;
            case "long": longs++; break;
            case "static": isStatic = true; break;
            case "enum": base = "enum"; enumItems = this.parseEnumBody(); break;
            case "signed": case "const": case "volatile": case "extern": case "register": case "auto": break;
            default: base = t.v === "_Bool" ? "bool" : t.v;
          }
        } else if (t.t === "id" && TYPE_IDS.has(t.v) && base === null && !unsigned && !short && !longs) {
          this.p++; sawAny = true; base = t.v;
        } else break;
      }
      if (!sawAny) return null;
      let name;
      if (base === "char") name = unsigned ? "uchar" : "char";
      else if (base === "float") name = "float";
      else if (base === "double") name = "double";
      else if (base === "void") name = "void";
      else if (base === "bool") name = "bool";
      else if (base === "enum") name = "int";
      else if (base === "size_t") name = "uint";
      else if (short) name = unsigned ? "ushort" : "short";
      else if (longs >= 2) name = unsigned ? "ull" : "ll";
      else if (longs === 1) name = unsigned ? "ulong" : "long";
      else name = unsigned ? "uint" : "int";
      return { name, isStatic, enumItems, line: start.line };
    }

    parseEnumBody() {
      if (this.tok.t === "id") this.p++; // タグ名
      if (!this.accept("{")) return null;
      const items = [];
      while (!this.isOp("}")) {
        const nt = this.next();
        if (nt.t !== "id") throw new CError("構文エラー: enum の中には名前が必要です", nt.line);
        let e = null;
        if (this.accept("=")) e = this.parseTernary();
        items.push({ name: nt.v, e, line: nt.line });
        if (!this.accept(",")) break;
      }
      this.expect("}");
      return items;
    }

    parseDeclarator(needName) {
      let ptr = 0;
      while (this.accept("*")) {
        ptr++;
        while (this.isKw("const") || this.isKw("volatile")) this.p++;
      }
      if (this.isOp("(")) throw new CError("関数ポインタは未対応です", this.tok.line);
      let name = null;
      if (this.tok.t === "id") name = this.next().v;
      else if (needName !== false) throw this.syntax("変数名（または関数名）が必要です");
      const dims = [];
      while (this.accept("[")) {
        if (this.accept("]")) dims.push(null);
        else { dims.push(this.parseTernary()); this.expect("]"); }
      }
      return { name, ptr, dims };
    }

    parseTypeName() {
      const spec = this.parseSpec();
      let ptr = 0;
      while (this.accept("*")) { ptr++; while (this.isKw("const")) this.p++; }
      const dims = [];
      while (this.accept("[")) { dims.push(this.parseTernary()); this.expect("]"); }
      return { spec, ptr, dims };
    }

    /* ---------- 宣言 ---------- */
    parseInitList() {
      const line = this.tok.line;
      this.expect("{");
      const items = [];
      while (!this.isOp("}")) {
        items.push(this.isOp("{") ? this.parseInitList() : this.parseAssign());
        if (!this.accept(",")) break;
      }
      this.expect("}");
      return { k: "list", items, line };
    }

    // spec の後ろ：「名前 [= 初期値] , ... ;」
    parseDecl(spec) {
      const line = spec.line;
      const items = [];
      do {
        const d = this.parseDeclarator();
        let init = null;
        if (this.accept("=")) init = this.isOp("{") ? this.parseInitList() : this.parseAssign();
        items.push({ name: d.name, ptr: d.ptr, dims: d.dims, init, line: this.tok.line });
      } while (this.accept(","));
      this.expect(";");
      return { k: "decl", spec, items, line };
    }

    parseProgram() {
      const items = [];
      while (this.tok.t !== "eof") {
        if (this.accept(";")) continue;
        const t = this.tok;
        if (t.t === "kw" && UNSUPPORTED[t.v]) throw new CError(`「${UNSUPPORTED[t.v]}」は未対応です`, t.line);
        const spec = this.parseSpec();
        if (!spec) throw this.syntax("ここには関数または変数の宣言が必要です");
        if (this.accept(";")) {
          if (spec.enumItems) items.push({ k: "decl", spec, items: [], line: t.line });
          continue;
        }
        const save = this.p;
        const d = this.parseDeclarator();
        if (this.isOp("(")) {
          const f = this.parseFunction(spec, d, t.line);
          if (f) items.push(f);
          continue;
        }
        this.p = save;
        items.push(this.parseDecl(spec));
      }
      return items;
    }

    parseFunction(spec, d, line) {
      this.expect("(");
      const params = [];
      let variadic = false;
      if (this.isKw("void") && this.peek().t === "op" && this.peek().v === ")") {
        this.p++;
      } else if (!this.isOp(")")) {
        for (;;) {
          if (this.accept("...")) { variadic = true; break; }
          const pspec = this.parseSpec();
          if (!pspec) throw this.syntax("引数の型が必要です");
          const pd = this.parseDeclarator(false);
          params.push({ spec: pspec, ptr: pd.ptr, dims: pd.dims, name: pd.name });
          if (!this.accept(",")) break;
        }
      }
      this.expect(")");
      if (this.accept(";")) return null; // プロトタイプ宣言
      const body = this.parseBlock();
      return { k: "func", name: d.name, ret: { spec, ptr: d.ptr }, params, variadic, body, line };
    }

    /* ---------- 文 ---------- */
    parseBlock() {
      const line = this.tok.line;
      this.expect("{");
      const items = [];
      while (!this.isOp("}")) {
        if (this.tok.t === "eof") throw new CError("構文エラー: '}' が足りません（{ が閉じられていません）", this.tok.line);
        items.push(this.parseStatement());
      }
      this.p++;
      return { k: "block", items, line };
    }

    parseStatement() {
      const t = this.tok;
      const line = t.line;
      if (t.t === "op") {
        if (t.v === "{") return this.parseBlock();
        if (t.v === ";") { this.p++; return { k: "empty", line }; }
      }
      if (t.t === "kw") {
        if (UNSUPPORTED[t.v]) throw new CError(`「${UNSUPPORTED[t.v]}」は未対応です`, line);
        switch (t.v) {
          case "if": {
            this.p++; this.expect("(");
            const cond = this.parseExpr();
            this.expect(")");
            const then = this.parseStatement();
            let els = null;
            if (this.isKw("else")) { this.p++; els = this.parseStatement(); }
            return { k: "if", cond, then, els, line };
          }
          case "while": {
            this.p++; this.expect("(");
            const cond = this.parseExpr();
            this.expect(")");
            return { k: "while", cond, body: this.parseStatement(), line };
          }
          case "do": {
            this.p++;
            const body = this.parseStatement();
            if (!this.isKw("while")) throw this.syntax("do の後ろの while が必要です");
            this.p++; this.expect("(");
            const cond = this.parseExpr();
            this.expect(")"); this.expect(";");
            return { k: "dowhile", cond, body, line };
          }
          case "for": {
            this.p++; this.expect("(");
            let init = null;
            if (this.isOp(";")) this.p++;
            else if (this.isTypeStart()) init = this.parseDecl(this.parseSpec());
            else { init = this.parseExpr(); this.expect(";"); }
            let cond = null;
            if (!this.isOp(";")) cond = this.parseExpr();
            this.expect(";");
            let step = null;
            if (!this.isOp(")")) step = this.parseExpr();
            this.expect(")");
            return { k: "for", init, cond, step, body: this.parseStatement(), line };
          }
          case "switch": {
            this.p++; this.expect("(");
            const e = this.parseExpr();
            this.expect(")");
            const body = this.parseStatement();
            if (body.k !== "block") throw new CError("構文エラー: switch の後ろは { } で囲んでください", line);
            return { k: "switch", e, body, line };
          }
          case "case": {
            this.p++;
            const e = this.parseTernary();
            this.expect(":");
            return { k: "case", e, line };
          }
          case "default":
            this.p++; this.expect(":");
            return { k: "default", line };
          case "break": this.p++; this.expect(";"); return { k: "break", line };
          case "continue": this.p++; this.expect(";"); return { k: "continue", line };
          case "return": {
            this.p++;
            let e = null;
            if (!this.isOp(";")) e = this.parseExpr();
            this.expect(";");
            return { k: "return", e, line };
          }
          case "else": throw this.syntax("対応する if がない else があります");
        }
      }
      if (this.isTypeStart()) return this.parseDecl(this.parseSpec());
      const e = this.parseExpr();
      this.expect(";");
      return { k: "expr", e, line };
    }

    /* ---------- 式 ---------- */
    parseExpr() {
      let left = this.parseAssign();
      while (this.isOp(",")) {
        const line = this.next().line;
        left = { k: "comma", l: left, r: this.parseAssign(), line };
      }
      return left;
    }

    parseAssign() {
      const left = this.parseTernary();
      const t = this.tok;
      if (t.t === "op" && ASSIGN_OPS.has(t.v)) {
        this.p++;
        return { k: "asg", op: t.v, l: left, r: this.parseAssign(), line: t.line };
      }
      return left;
    }

    parseTernary() {
      const c = this.parseBin(1);
      if (this.isOp("?")) {
        const line = this.next().line;
        const a = this.parseExpr();
        this.expect(":");
        const b = this.parseTernary();
        return { k: "cond", c, a, b, line };
      }
      return c;
    }

    parseBin(min) {
      let left = this.parseUnary();
      for (;;) {
        const t = this.tok;
        if (t.t !== "op") break;
        const prec = BINPREC[t.v];
        if (prec === undefined || prec < min) break;
        this.p++;
        const right = this.parseBin(prec + 1);
        left = { k: t.v === "&&" || t.v === "||" ? "log" : "bin", op: t.v, l: left, r: right, line: t.line };
      }
      return left;
    }

    parseUnary() {
      const t = this.tok;
      const line = t.line;
      if (t.t === "op") {
        if (t.v === "++" || t.v === "--") {
          this.p++;
          return { k: "pre", op: t.v, e: this.parseUnary(), line };
        }
        if (t.v === "+" || t.v === "-" || t.v === "!" || t.v === "~" || t.v === "*" || t.v === "&") {
          this.p++;
          return { k: "un", op: t.v, e: this.parseUnary(), line };
        }
        if (t.v === "(" && this.isTypeStart(this.peek())) {
          this.p++;
          const type = this.parseTypeName();
          this.expect(")");
          return { k: "cast", type, e: this.parseUnary(), line };
        }
      }
      if (t.t === "kw" && t.v === "sizeof") {
        this.p++;
        if (this.isOp("(") && this.isTypeStart(this.peek())) {
          this.p++;
          const type = this.parseTypeName();
          this.expect(")");
          return { k: "sizeofT", type, line };
        }
        return { k: "sizeofE", e: this.parseUnary(), line };
      }
      return this.parsePostfix();
    }

    parsePostfix() {
      let e = this.parsePrimary();
      for (;;) {
        const t = this.tok;
        if (t.t !== "op") break;
        if (t.v === "[") {
          this.p++;
          const i = this.parseExpr();
          this.expect("]");
          e = { k: "idx", a: e, i, line: t.line };
        } else if (t.v === "(") {
          if (e.k !== "id") throw new CError("関数ポインタを使った呼び出しは未対応です", t.line);
          this.p++;
          const args = [];
          if (!this.isOp(")")) {
            do { args.push(this.parseAssign()); } while (this.accept(","));
          }
          this.expect(")");
          e = { k: "call", fn: e, args, line: t.line };
        } else if (t.v === "++" || t.v === "--") {
          this.p++;
          e = { k: "post", op: t.v, e, line: t.line };
        } else if (t.v === "." || t.v === "->") {
          throw new CError("構造体のメンバ参照（. や ->）は未対応です", t.line);
        } else break;
      }
      return e;
    }

    parsePrimary() {
      const t = this.tok;
      switch (t.t) {
        case "num": this.p++; return { k: "num", v: t.v, isFloat: t.isFloat, u: t.u, l: t.l, f: t.f, hex: t.hex, line: t.line };
        case "chr": this.p++; return { k: "chr", v: t.v, line: t.line };
        case "str": {
          this.p++;
          let bytes = t.v;
          while (this.tok.t === "str") bytes = bytes.concat(this.next().v); // 隣り合う文字列は連結
          return { k: "str", v: bytes, line: t.line };
        }
        case "id": this.p++; return { k: "id", name: t.v, line: t.line };
        case "op":
          if (t.v === "(") {
            this.p++;
            const e = this.parseExpr();
            this.expect(")");
            return e;
          }
          break;
      }
      throw this.syntax("式が必要です");
    }
  }

  function parse(tokens) {
    return new Parser(tokens).parseProgram();
  }

  g.CParser = { parse };
})(globalThis);
/* ===== C言語 簡易インタプリタ：型・変換・printf/scanf の書式処理 ===== */
(function (g) {
  "use strict";

  /* ---------- 型 ---------- */
  const mkInt = (n, size, u) => ({ k: "int", n, size, u });
  const T = {
    void: { k: "void", n: "void", size: 1 },
    char: mkInt("char", 1, false),
    uchar: mkInt("unsigned char", 1, true),
    short: mkInt("short", 2, false),
    ushort: mkInt("unsigned short", 2, true),
    int: mkInt("int", 4, false),
    uint: mkInt("unsigned int", 4, true),
    ll: mkInt("long long", 8, false),
    ull: mkInt("unsigned long long", 8, true),
    float: { k: "float", n: "float", size: 4 },
    double: { k: "double", n: "double", size: 8 },
    bool: { k: "int", n: "bool", size: 1, u: true, bool: true },
  };
  const ptrTo = (t) => ({ k: "ptr", to: t, size: 8 });
  const arrOf = (t, n) => ({ k: "arr", of: t, n, size: t.size * n });
  const isFloat = (t) => t.k === "float" || t.k === "double";

  const intTypeBySize = (size, u) => {
    if (size === 1) return u ? T.uchar : T.char;
    if (size === 2) return u ? T.ushort : T.short;
    if (size === 8) return u ? T.ull : T.ll;
    return u ? T.uint : T.int;
  };

  // 整数型 t の範囲に収める（size 8 のときだけ BigInt）
  function wrapInt(v, t) {
    if (t.size === 8) {
      if (typeof v !== "bigint") v = BigInt(v);
      return t.u ? BigInt.asUintN(64, v) : BigInt.asIntN(64, v);
    }
    if (typeof v === "bigint") v = Number(BigInt.asIntN(32, v));
    if (t.bool) return v != 0 ? 1 : 0;
    switch (t.size) {
      case 1: return t.u ? v & 255 : (v << 24) >> 24;
      case 2: return t.u ? v & 65535 : (v << 16) >> 16;
      default: return t.u ? v >>> 0 : v | 0;
    }
  }

  const toNum = (v) => (typeof v === "bigint" ? Number(v) : v);

  // 値 v（型 from）を型 to に変換する
  function conv(v, from, to) {
    switch (to.k) {
      case "int": {
        if (isFloat(from)) {
          if (!isFinite(v)) return to.size === 8 ? 0n : 0;
          if (to.bool) return v != 0 ? 1 : 0;
          v = Math.trunc(v);
        }
        return wrapInt(v, to);
      }
      case "float": return Math.fround(toNum(v));
      case "double": return toNum(v);
      case "ptr": return typeof v === "bigint" ? Number(BigInt.asUintN(32, v)) : (v >>> 0);
    }
    return v;
  }

  /* ---------- printf ---------- */
  function fixedStr(ax, prec) {
    if (prec > 100) prec = 100;
    if (ax >= 1e21) {
      const s = BigInt(ax).toString();
      return prec > 0 ? s + "." + "0".repeat(prec) : s;
    }
    let s = ax.toFixed(prec);
    // ちょうど半分の値は、C の printf と同じ「偶数への丸め」にする
    const ext = ax.toFixed(Math.min(100, prec + 30));
    const dot = ext.indexOf(".");
    const tail = ext.slice(dot + 1 + prec);
    if (/^50*$/.test(tail)) {
      const trunc = prec === 0 ? ext.slice(0, dot) : ext.slice(0, dot + 1 + prec);
      if (parseInt(trunc[trunc.length - 1], 10) % 2 === 0) s = trunc;
    }
    return s;
  }

  function expStr(ax, prec) {
    if (prec > 100) prec = 100;
    return ax.toExponential(prec).replace(/e([+-])(\d)$/, "e$10$2");
  }

  function genericStr(ax, prec, alt) {
    const P = prec < 0 ? 6 : prec === 0 ? 1 : prec;
    let X = 0;
    if (ax !== 0) X = Number(ax.toExponential(Math.min(P - 1, 100)).split("e")[1]);
    let s;
    if (X < -4 || X >= P) {
      s = expStr(ax, P - 1);
      if (!alt) s = s.replace(/\.?0+e/, "e");
    } else {
      s = fixedStr(ax, P - 1 - X);
      if (!alt && s.indexOf(".") >= 0) s = s.replace(/\.?0+$/, "");
    }
    return s;
  }

  const strBytes = (s) => { const a = []; for (let i = 0; i < s.length; i++) a.push(s.charCodeAt(i) & 255); return a; };

  // fmt: バイト列, args: 値の配列, types: 型の配列 → 出力バイト列
  function formatPrintf(rt, fmt, args, types) {
    const out = [];
    let ai = 0;
    const nextArg = () => {
      if (ai >= args.length) throw rt.err("printf の書式に対して引数が足りません（% の数と引数の数を確認してください）");
      return ai++;
    };
    const ch = (k) => (k < fmt.length ? String.fromCharCode(fmt[k]) : "");

    for (let i = 0; i < fmt.length; i++) {
      if (fmt[i] !== 37) { out.push(fmt[i]); continue; }
      i++;
      if (i >= fmt.length) { out.push(37); break; }
      const fl = { minus: false, plus: false, space: false, alt: false, zero: false };
      for (;;) {
        const f = ch(i);
        if (f === "-") fl.minus = true;
        else if (f === "+") fl.plus = true;
        else if (f === " ") fl.space = true;
        else if (f === "#") fl.alt = true;
        else if (f === "0") fl.zero = true;
        else break;
        i++;
      }
      let width = 0;
      if (ch(i) === "*") {
        width = Number(args[nextArg()]); i++;
        if (width < 0) { fl.minus = true; width = -width; }
      } else {
        while (fmt[i] >= 48 && fmt[i] <= 57) width = width * 10 + (fmt[i++] - 48);
      }
      let prec = -1;
      if (ch(i) === ".") {
        i++; prec = 0;
        if (ch(i) === "*") { prec = Number(args[nextArg()]); i++; if (prec < 0) prec = -1; }
        else while (fmt[i] >= 48 && fmt[i] <= 57) prec = prec * 10 + (fmt[i++] - 48);
      }
      let lmod = "";
      while ("hlLzjt".includes(ch(i)) && ch(i) !== "") lmod += ch(i++);
      const cv = ch(i);

      // 幅をそろえて出力
      const emitBody = (body, signPart, numeric) => {
        const len = signPart.length + body.length;
        if (width > len) {
          if (fl.minus) { out.push(...strBytes(signPart), ...body); for (let k = len; k < width; k++) out.push(32); return; }
          if (numeric && fl.zero) { out.push(...strBytes(signPart)); for (let k = len; k < width; k++) out.push(48); out.push(...body); return; }
          for (let k = len; k < width; k++) out.push(32);
        }
        out.push(...strBytes(signPart), ...body);
      };

      const bitsFor = () => (lmod === "hh" ? 8 : lmod === "h" ? 16
        : (lmod === "ll" || lmod === "j" || (lmod === "l" && rt.longSize === 8)) ? 64 : 32);
      const toBig = (k) => {
        const v = args[k];
        if (typeof v === "bigint") return v;
        if (!Number.isFinite(v)) return 0n;
        return BigInt(Math.trunc(v));
      };

      switch (cv) {
        case "d": case "i": {
          const k = nextArg();
          const b = BigInt.asIntN(bitsFor(), toBig(k));
          let digits = (b < 0n ? -b : b).toString();
          if (prec >= 0) { digits = digits.padStart(prec, "0"); if (prec === 0 && b === 0n) digits = ""; }
          const sign = b < 0n ? "-" : fl.plus ? "+" : fl.space ? " " : "";
          const z = fl.zero; if (prec >= 0) fl.zero = false;
          emitBody(strBytes(digits), sign, true);
          fl.zero = z;
          break;
        }
        case "u": case "x": case "X": case "o": {
          const k = nextArg();
          const b = BigInt.asUintN(bitsFor(), toBig(k));
          let digits = b.toString(cv === "u" ? 10 : cv === "o" ? 8 : 16);
          if (cv === "X") digits = digits.toUpperCase();
          if (prec >= 0) { digits = digits.padStart(prec, "0"); if (prec === 0 && b === 0n) digits = ""; }
          let prefix = "";
          if (fl.alt && b !== 0n) prefix = cv === "x" ? "0x" : cv === "X" ? "0X" : cv === "o" ? "0" : "";
          const z = fl.zero; if (prec >= 0) fl.zero = false;
          emitBody(strBytes(digits), prefix, true);
          fl.zero = z;
          break;
        }
        case "c": {
          const k = nextArg();
          emitBody([Number(toBig(k) & 255n)], "", false);
          break;
        }
        case "s": {
          const k = nextArg();
          const addr = Number(args[k]);
          let bytes = addr === 0 ? strBytes("(null)") : rt.readCStr(addr);
          if (prec >= 0 && bytes.length > prec) bytes = bytes.slice(0, prec);
          emitBody(bytes, "", false);
          break;
        }
        case "f": case "F": case "e": case "E": case "g": case "G": {
          const x = toNum(args[nextArg()]);
          const neg = x < 0 || Object.is(x, -0);
          const ax = Math.abs(x);
          const sign = neg ? "-" : fl.plus ? "+" : fl.space ? " " : "";
          let s;
          let numeric = true;
          if (!Number.isFinite(x)) {
            s = Number.isNaN(x) ? "nan" : "inf";
            numeric = false;
          } else if (cv === "f" || cv === "F") {
            s = fixedStr(ax, prec < 0 ? 6 : prec);
            if (fl.alt && prec === 0) s += ".";
          } else if (cv === "e" || cv === "E") {
            s = expStr(ax, prec < 0 ? 6 : prec);
          } else {
            s = genericStr(ax, prec, fl.alt);
          }
          if (cv === "E" || cv === "G" || cv === "F") s = s.toUpperCase();
          emitBody(strBytes(s), Number.isNaN(x) ? (fl.plus ? "+" : fl.space ? " " : "") : sign, numeric);
          break;
        }
        case "p": {
          const k = nextArg();
          emitBody(strBytes(Number(args[k]).toString(16)), "0x", false);
          break;
        }
        case "%": out.push(37); break;
        default:
          out.push(37);
          for (let k = i; k < Math.min(i + 1, fmt.length); k++) out.push(fmt[k]);
      }
    }
    return out;
  }

  /* ---------- scanf ---------- */
  // inp: { bytes: Uint8Array|Array, pos: number }
  function scanfCore(rt, fmt, ptrs, inp) {
    const peek = () => { rt.echoAt(inp); return inp.pos < inp.bytes.length ? inp.bytes[inp.pos] : -1; };
    const isSpace = (b) => b === 32 || (b >= 9 && b <= 13);
    const skipWs = () => { while (isSpace(peek())) inp.pos++; };
    const isDigit = (b) => b >= 48 && b <= 57;
    let count = 0, ai = 0, i = 0;
    let failedAtEof = false;

    const nextPtr = () => {
      if (ai >= ptrs.length) throw rt.err("scanf の書式に対して引数が足りません（& を付けた変数を渡しているか確認してください）");
      return Number(ptrs[ai++]);
    };

    outer:
    while (i < fmt.length) {
      const c = fmt[i];
      if (isSpace(c)) { skipWs(); i++; continue; }
      if (c !== 37) {
        if (peek() === c) { inp.pos++; i++; continue; }
        if (peek() === -1 && count === 0) failedAtEof = true;
        break;
      }
      i++;
      if (fmt[i] === 37) {
        skipWs();
        if (peek() === 37) { inp.pos++; i++; continue; }
        break;
      }
      let suppress = false;
      if (fmt[i] === 42) { suppress = true; i++; }
      let width = 0;
      while (fmt[i] >= 48 && fmt[i] <= 57) width = width * 10 + (fmt[i++] - 48);
      let lmod = "";
      while (i < fmt.length && "hlLzjt".includes(String.fromCharCode(fmt[i]))) lmod += String.fromCharCode(fmt[i++]);
      const cv = String.fromCharCode(fmt[i]); i++;
      const limit = width > 0 ? width : Infinity;

      switch (cv) {
        case "d": case "i": case "u": case "x": case "X": case "o": {
          skipWs();
          if (peek() === -1) { if (count === 0) failedAtEof = true; break outer; }
          let base = cv === "x" || cv === "X" ? 16 : cv === "o" ? 8 : 10;
          let used = 0, neg = false, text = "";
          if ((peek() === 43 || peek() === 45) && used < limit) { neg = peek() === 45; inp.pos++; used++; }
          if (cv === "i" || base === 16) {
            if (peek() === 48 && used < limit) {
              const nx = inp.bytes[inp.pos + 1];
              if (nx === 120 || nx === 88) { base = 16; inp.pos += 2; used += 2; }
              else if (cv === "i") base = 8;
            }
          }
          const isDig = (b) => base === 16 ? (isDigit(b) || (b >= 97 && b <= 102) || (b >= 65 && b <= 70)) : base === 8 ? (b >= 48 && b <= 55) : isDigit(b);
          while (isDig(peek()) && used < limit) { text += String.fromCharCode(peek()); inp.pos++; used++; }
          if (text === "") break outer;
          let val = BigInt((base === 16 ? "0x" : base === 8 ? "0o" : "") + text);
          if (neg) val = -val;
          if (!suppress) {
            const size = lmod === "hh" ? 1 : lmod === "h" ? 2 : lmod === "l" ? rt.longSize : (lmod === "ll" || lmod === "j") ? 8 : 4;
            const t = intTypeBySize(size, cv !== "d" && cv !== "i");
            rt.store(nextPtr(), t, wrapInt(val, t));
            count++;
          }
          break;
        }
        case "f": case "e": case "g": case "E": case "G": case "a": {
          skipWs();
          if (peek() === -1) { if (count === 0) failedAtEof = true; break outer; }
          let used = 0, text = "";
          const take = () => { text += String.fromCharCode(peek()); inp.pos++; used++; };
          if ((peek() === 43 || peek() === 45) && used < limit) take();
          const rest = String.fromCharCode(...inp.bytes.slice(inp.pos, inp.pos + 3)).toLowerCase();
          if (rest === "inf" || rest === "nan") {
            for (let k = 0; k < 3; k++) take();
          } else {
            let digits = 0;
            while (isDigit(peek()) && used < limit) { take(); digits++; }
            if (peek() === 46 && used < limit) { take(); while (isDigit(peek()) && used < limit) { take(); digits++; } }
            if (digits === 0) break outer;
            if ((peek() === 101 || peek() === 69) && used < limit) {
              const save = inp.pos, saveText = text, saveUsed = used;
              take();
              if ((peek() === 43 || peek() === 45) && used < limit) take();
              if (isDigit(peek())) { while (isDigit(peek()) && used < limit) take(); }
              else { inp.pos = save; text = saveText; used = saveUsed; }
            }
          }
          const val = parseFloat(text);
          if (!suppress) {
            const isDouble = lmod === "l" || lmod === "L";
            rt.store(nextPtr(), isDouble ? T.double : T.float, isDouble ? val : Math.fround(val));
            count++;
          }
          break;
        }
        case "c": {
          const n = width > 0 ? width : 1;
          if (peek() === -1) { if (count === 0) failedAtEof = true; break outer; }
          const bytes = [];
          for (let k = 0; k < n && peek() !== -1; k++) { bytes.push(peek()); inp.pos++; }
          if (!suppress) {
            const p = nextPtr();
            for (let k = 0; k < bytes.length; k++) rt.store(p + k, T.uchar, bytes[k]);
            count++;
          }
          break;
        }
        case "s": {
          skipWs();
          if (peek() === -1) { if (count === 0) failedAtEof = true; break outer; }
          const bytes = [];
          while (peek() !== -1 && !isSpace(peek()) && bytes.length < limit) { bytes.push(peek()); inp.pos++; }
          if (!suppress) {
            const p = nextPtr();
            for (let k = 0; k < bytes.length; k++) rt.store(p + k, T.uchar, bytes[k]);
            rt.store(p + bytes.length, T.uchar, 0);
            count++;
          }
          break;
        }
        case "[": {
          let neg = false;
          if (fmt[i] === 94) { neg = true; i++; }
          const set = new Set();
          let first = true;
          while (i < fmt.length && (fmt[i] !== 93 || first)) {
            if (fmt[i + 1] === 45 && fmt[i + 2] !== 93 && fmt[i + 2] !== undefined) {
              for (let b = fmt[i]; b <= fmt[i + 2]; b++) set.add(b);
              i += 3;
            } else { set.add(fmt[i]); i++; }
            first = false;
          }
          i++; // ]
          if (peek() === -1) { if (count === 0) failedAtEof = true; break outer; }
          const bytes = [];
          while (peek() !== -1 && (set.has(peek()) !== neg) && bytes.length < limit) { bytes.push(peek()); inp.pos++; }
          if (bytes.length === 0) break outer;
          if (!suppress) {
            const p = nextPtr();
            for (let k = 0; k < bytes.length; k++) rt.store(p + k, T.uchar, bytes[k]);
            rt.store(p + bytes.length, T.uchar, 0);
            count++;
          }
          break;
        }
        default:
          break outer;
      }
    }
    // 読み込む値の数に対して、入力が最後まで読み切られて足りなかった
    if (inp === rt.stdin && count < ptrs.length && inp.pos >= inp.bytes.length) rt.eofHit = true;
    return failedAtEof && count === 0 ? -1 : count;
  }

  g.CLib = {
    T, ptrTo, arrOf, isFloat, intTypeBySize, wrapInt, toNum, conv,
    formatPrintf, scanfCore, strBytes, builtins: {},
  };
})(globalThis);
/* ===== C言語 簡易インタプリタ：標準ライブラリ関数 ===== */
(function (g) {
  "use strict";
  const L = g.CLib;
  const { wrapInt, strBytes, T } = L;
  const B = L.builtins;

  class ExitSignal { constructor(code) { this.code = code; } }

  const def = (name, ret, fn) => { B[name] = { ret, fn }; };
  const num = (v) => (typeof v === "bigint" ? Number(v) : v);
  const need = (rt, a, n, name) => {
    if (a.length < n) throw rt.err(`関数 ${name} の引数が足りません（${n}個必要です）`);
  };
  const putBytes = (rt, addr, bytes, nul) => {
    for (let k = 0; k < bytes.length; k++) rt.store(addr + k, T.uchar, bytes[k]);
    if (nul) rt.store(addr + bytes.length, T.uchar, 0);
  };

  /* ----- 出力 ----- */
  def("printf", "int", (rt, a, t) => {
    need(rt, a, 1, "printf");
    const bytes = L.formatPrintf(rt, rt.readCStr(num(a[0])), a.slice(1), t.slice(1));
    rt.write(bytes);
    return bytes.length;
  });
  def("fprintf", "int", (rt, a, t) => {
    need(rt, a, 2, "fprintf");
    const bytes = L.formatPrintf(rt, rt.readCStr(num(a[1])), a.slice(2), t.slice(2));
    rt.write(bytes);
    return bytes.length;
  });
  def("sprintf", "int", (rt, a, t) => {
    need(rt, a, 2, "sprintf");
    const bytes = L.formatPrintf(rt, rt.readCStr(num(a[1])), a.slice(2), t.slice(2));
    putBytes(rt, num(a[0]), bytes, true);
    return bytes.length;
  });
  def("snprintf", "int", (rt, a, t) => {
    need(rt, a, 3, "snprintf");
    const bytes = L.formatPrintf(rt, rt.readCStr(num(a[2])), a.slice(3), t.slice(3));
    const n = num(a[1]);
    if (n > 0) putBytes(rt, num(a[0]), bytes.slice(0, n - 1), true);
    return bytes.length;
  });
  def("puts", "int", (rt, a) => { need(rt, a, 1, "puts"); rt.write(rt.readCStr(num(a[0])).concat([10])); return 1; });
  def("fputs", "int", (rt, a) => { need(rt, a, 1, "fputs"); rt.write(rt.readCStr(num(a[0]))); return 1; });
  def("putchar", "int", (rt, a) => { need(rt, a, 1, "putchar"); rt.write([num(a[0]) & 255]); return num(a[0]) & 255; });
  def("fputc", "int", (rt, a) => { need(rt, a, 1, "fputc"); rt.write([num(a[0]) & 255]); return num(a[0]) & 255; });
  B.putc = B.fputc;
  def("fflush", "int", () => 0);

  /* ----- 入力 ----- */
  def("scanf", "int", (rt, a) => {
    need(rt, a, 1, "scanf");
    return L.scanfCore(rt, rt.readCStr(num(a[0])), a.slice(1), rt.stdin);
  });
  def("fscanf", "int", (rt, a) => {
    need(rt, a, 2, "fscanf");
    return L.scanfCore(rt, rt.readCStr(num(a[1])), a.slice(2), rt.stdin);
  });
  def("sscanf", "int", (rt, a) => {
    need(rt, a, 2, "sscanf");
    return L.scanfCore(rt, rt.readCStr(num(a[1])), a.slice(2), { bytes: rt.readCStr(num(a[0])), pos: 0 });
  });
  def("getchar", "int", (rt) => {
    const s = rt.stdin;
    rt.echoAt(s);
    if (s.pos < s.bytes.length) return s.bytes[s.pos++];
    rt.eofHit = true;
    return -1;
  });
  B.getc = B.getchar;
  B.fgetc = B.getchar;
  def("fgets", "cptr", (rt, a) => {
    need(rt, a, 2, "fgets");
    const s = rt.stdin, buf = num(a[0]), n = num(a[1]);
    rt.echoAt(s);
    if (n <= 0 || s.pos >= s.bytes.length) { rt.eofHit = true; return 0; }
    const bytes = [];
    while (bytes.length < n - 1 && s.pos < s.bytes.length) {
      const b = s.bytes[s.pos++];
      bytes.push(b);
      if (b === 10) break;
    }
    putBytes(rt, buf, bytes, true);
    return buf;
  });
  def("gets", "cptr", (rt, a) => {
    need(rt, a, 1, "gets");
    const s = rt.stdin, buf = num(a[0]);
    rt.echoAt(s);
    if (s.pos >= s.bytes.length) { rt.eofHit = true; return 0; }
    const bytes = [];
    while (s.pos < s.bytes.length) {
      const b = s.bytes[s.pos++];
      if (b === 10) break;
      bytes.push(b);
    }
    putBytes(rt, buf, bytes, true);
    return buf;
  });

  /* ----- 文字列・メモリ ----- */
  def("strlen", "uint", (rt, a) => { need(rt, a, 1, "strlen"); return rt.readCStr(num(a[0])).length; });
  def("strcpy", "cptr", (rt, a) => { need(rt, a, 2, "strcpy"); putBytes(rt, num(a[0]), rt.readCStr(num(a[1])), true); return num(a[0]); });
  def("strncpy", "cptr", (rt, a) => {
    need(rt, a, 3, "strncpy");
    const n = num(a[2]);
    const bytes = rt.readCStr(num(a[1])).slice(0, n);
    while (bytes.length < n) bytes.push(0);
    putBytes(rt, num(a[0]), bytes, false);
    return num(a[0]);
  });
  def("strcat", "cptr", (rt, a) => {
    need(rt, a, 2, "strcat");
    const len = rt.readCStr(num(a[0])).length;
    putBytes(rt, num(a[0]) + len, rt.readCStr(num(a[1])), true);
    return num(a[0]);
  });
  def("strncat", "cptr", (rt, a) => {
    need(rt, a, 3, "strncat");
    const len = rt.readCStr(num(a[0])).length;
    putBytes(rt, num(a[0]) + len, rt.readCStr(num(a[1])).slice(0, num(a[2])), true);
    return num(a[0]);
  });
  const cmpBytes = (x, y, limit) => {
    const n = Math.min(Math.max(x.length, y.length) + 1, limit);
    for (let i = 0; i < n; i++) {
      const p = i < x.length ? x[i] : 0, q = i < y.length ? y[i] : 0;
      if (p !== q) return p - q;
      if (p === 0) return 0;
    }
    return 0;
  };
  def("strcmp", "int", (rt, a) => { need(rt, a, 2, "strcmp"); return cmpBytes(rt.readCStr(num(a[0])), rt.readCStr(num(a[1])), Infinity); });
  def("strncmp", "int", (rt, a) => { need(rt, a, 3, "strncmp"); return cmpBytes(rt.readCStr(num(a[0])), rt.readCStr(num(a[1])), num(a[2])); });
  def("strchr", "cptr", (rt, a) => {
    need(rt, a, 2, "strchr");
    const s = num(a[0]), c = num(a[1]) & 255, bytes = rt.readCStr(s);
    if (c === 0) return s + bytes.length;
    const i = bytes.indexOf(c);
    return i < 0 ? 0 : s + i;
  });
  def("strrchr", "cptr", (rt, a) => {
    need(rt, a, 2, "strrchr");
    const s = num(a[0]), c = num(a[1]) & 255, bytes = rt.readCStr(s);
    if (c === 0) return s + bytes.length;
    const i = bytes.lastIndexOf(c);
    return i < 0 ? 0 : s + i;
  });
  def("strstr", "cptr", (rt, a) => {
    need(rt, a, 2, "strstr");
    const s = num(a[0]), h = rt.readCStr(s), nd = rt.readCStr(num(a[1]));
    if (nd.length === 0) return s;
    for (let i = 0; i + nd.length <= h.length; i++) {
      let ok = true;
      for (let j = 0; j < nd.length; j++) if (h[i + j] !== nd[j]) { ok = false; break; }
      if (ok) return s + i;
    }
    return 0;
  });
  def("strdup", "cptr", (rt, a) => {
    need(rt, a, 1, "strdup");
    const bytes = rt.readCStr(num(a[0]));
    const p = rt.heapAlloc(bytes.length + 1);
    if (p === 0) return 0;
    putBytes(rt, p, bytes, true);
    return p;
  });
  def("memset", "vptr", (rt, a) => { need(rt, a, 3, "memset"); rt.fillMem(num(a[0]), num(a[1]) & 255, num(a[2])); return num(a[0]); });
  def("memcpy", "vptr", (rt, a) => { need(rt, a, 3, "memcpy"); rt.copyMem(num(a[0]), num(a[1]), num(a[2])); return num(a[0]); });
  B.memmove = B.memcpy;
  def("memcmp", "int", (rt, a) => {
    need(rt, a, 3, "memcmp");
    const n = num(a[2]), p = num(a[0]), q = num(a[1]);
    for (let i = 0; i < n; i++) {
      const x = rt.load(p + i, T.uchar), y = rt.load(q + i, T.uchar);
      if (x !== y) return x - y;
    }
    return 0;
  });

  /* ----- 変換・数学 ----- */
  def("atoi", "int", (rt, a) => {
    need(rt, a, 1, "atoi");
    const m = /^\s*[+-]?\d+/.exec(String.fromCharCode(...rt.readCStr(num(a[0]))));
    return m ? wrapInt(parseInt(m[0], 10), T.int) : 0;
  });
  B.atol = B.atoi;
  def("atof", "double", (rt, a) => {
    need(rt, a, 1, "atof");
    const m = /^\s*[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(String.fromCharCode(...rt.readCStr(num(a[0]))));
    return m ? parseFloat(m[0]) : 0;
  });
  def("abs", "int", (rt, a) => { need(rt, a, 1, "abs"); return wrapInt(Math.abs(num(a[0])), T.int); });
  B.labs = B.abs;
  def("llabs", "ll", (rt, a) => { need(rt, a, 1, "llabs"); const v = BigInt(a[0]); return wrapInt(v < 0n ? -v : v, T.ll); });

  for (const name of ["sqrt", "sin", "cos", "tan", "asin", "acos", "atan", "sinh", "cosh", "tanh",
    "exp", "log", "log10", "log2", "floor", "ceil", "trunc", "cbrt"]) {
    def(name, "double", (rt, a) => { need(rt, a, 1, name); return Math[name](num(a[0])); });
  }
  def("fabs", "double", (rt, a) => { need(rt, a, 1, "fabs"); return Math.abs(num(a[0])); });
  def("round", "double", (rt, a) => { need(rt, a, 1, "round"); const x = num(a[0]); return x < 0 ? -Math.round(-x) : Math.round(x); });
  def("pow", "double", (rt, a) => { need(rt, a, 2, "pow"); return Math.pow(num(a[0]), num(a[1])); });
  def("atan2", "double", (rt, a) => { need(rt, a, 2, "atan2"); return Math.atan2(num(a[0]), num(a[1])); });
  def("fmod", "double", (rt, a) => { need(rt, a, 2, "fmod"); return num(a[0]) % num(a[1]); });
  def("hypot", "double", (rt, a) => { need(rt, a, 2, "hypot"); return Math.hypot(num(a[0]), num(a[1])); });
  def("fmax", "double", (rt, a) => { need(rt, a, 2, "fmax"); return Math.max(num(a[0]), num(a[1])); });
  def("fmin", "double", (rt, a) => { need(rt, a, 2, "fmin"); return Math.min(num(a[0]), num(a[1])); });

  /* ----- 文字の種類 ----- */
  const ctype = (name, re) => def(name, "int", (rt, a) => {
    need(rt, a, 1, name);
    const c = num(a[0]);
    return c >= 0 && c < 128 && re.test(String.fromCharCode(c)) ? 1 : 0;
  });
  ctype("isdigit", /[0-9]/);
  ctype("isalpha", /[A-Za-z]/);
  ctype("isalnum", /[A-Za-z0-9]/);
  ctype("isupper", /[A-Z]/);
  ctype("islower", /[a-z]/);
  ctype("isspace", /[ \t\n\v\f\r]/);
  ctype("ispunct", /[!-\/:-@\[-`{-~]/);
  def("toupper", "int", (rt, a) => { need(rt, a, 1, "toupper"); const c = num(a[0]); return c >= 97 && c <= 122 ? c - 32 : c; });
  def("tolower", "int", (rt, a) => { need(rt, a, 1, "tolower"); const c = num(a[0]); return c >= 65 && c <= 90 ? c + 32 : c; });

  /* ----- 乱数・時刻・メモリ確保・終了 ----- */
  def("srand", "void", (rt, a) => { need(rt, a, 1, "srand"); rt.randState = num(a[0]) | 0; return 0; });
  def("rand", "int", (rt) => {
    rt.randState = (Math.imul(rt.randState, 1103515245) + 12345) | 0;
    return (rt.randState >>> 16) & 0x7fff;
  });
  def("time", "int", (rt, a) => {
    const now = Math.floor(Date.now() / 1000);
    if (a.length > 0 && num(a[0]) !== 0) rt.store(num(a[0]), T.int, now | 0);
    return now | 0;
  });
  def("clock", "int", (rt) => Date.now() - rt.startTime);
  def("malloc", "vptr", (rt, a) => { need(rt, a, 1, "malloc"); return rt.heapAlloc(num(a[0])); });
  def("calloc", "vptr", (rt, a) => { need(rt, a, 2, "calloc"); return rt.heapAlloc(num(a[0]) * num(a[1])); });
  def("realloc", "vptr", (rt, a) => {
    need(rt, a, 2, "realloc");
    const old = num(a[0]), size = num(a[1]);
    const p = rt.heapAlloc(size);
    if (p !== 0 && old !== 0) rt.copyMem(p, old, Math.min(size, rt.heapSizes.get(old) || 0));
    return p;
  });
  def("free", "void", () => 0);
  def("exit", "void", (rt, a) => { throw new ExitSignal(a.length ? num(a[0]) : 0); });
  def("abort", "void", () => { throw new ExitSignal(134); });

  L.ExitSignal = ExitSignal;
})(globalThis);
/* ===== C言語 簡易インタプリタ：実行環境（メモリ・変数・宣言） ===== */
(function (g) {
  "use strict";
  const { CError } = g.CLexer;
  const L = g.CLib;
  const { T, ptrTo, arrOf, conv } = L;

  const MEM_SIZE = 8 * 1024 * 1024;     // 仮想メモリ全体
  const NULL_GUARD = 4096;               // 0〜4095番地は NULL 付近として使用禁止
  const STATIC_END = 1 << 20;            // 静的領域（グローバル変数・文字列定数）
  const STACK_END = STATIC_END + 4 * 1024 * 1024; // スタック（ローカル変数）。その先がヒープ
  const MAX_OUT = 2 * 1024 * 1024;

  class Interp {
    constructor(items, opts) {
      this.items = items;
      this.longSize = opts.longSize || 4;
      this.buf = new ArrayBuffer(MEM_SIZE);
      this.dv = new DataView(this.buf);
      this.u8 = new Uint8Array(this.buf);
      this.staticPtr = NULL_GUARD;
      this.sp = STATIC_END;
      this.heapPtr = STACK_END;
      this.heapSizes = new Map();
      this.globalScope = new Map();
      this.scopes = [this.globalScope];
      this.funcs = new Map();
      this.strCache = new Map();
      this.statics = new Map();
      this.paramTypes = new Map();
      this.out = [];
      this.stdin = { bytes: Array.from(new TextEncoder().encode(opts.input || "")), pos: 0, echoed: 0 };
      this.echoInput = !!opts.echoInput;   // 入力した値を画面にも表示する（ターミナルの見た目）
      this.eofHit = false;                 // 入力が足りなかったか
      this.steps = 0;
      this.depth = 0;
      this.line = 0;
      this.T = T.int;
      this.startTime = Date.now();
      this.limitMs = opts.timeLimitMs || 5000;
      this.deadline = this.startTime + this.limitMs;
      this.randState = 1;
      this.inGlobal = true;
    }

    err(msg) { return new CError(msg, this.line); }

    tick() {
      if (Date.now() > this.deadline) {
        throw this.err(`実行時間が長すぎるため中断しました（${this.limitMs / 1000}秒）。無限ループになっていないか確認してください`);
      }
    }

    /* ---------- メモリ ---------- */
    chk(a, n) {
      if (!(a >= NULL_GUARD && a + n <= MEM_SIZE)) {
        throw this.err(a < NULL_GUARD
          ? "NULLポインタ（または不正なアドレス）の指す先を読み書きしようとしました"
          : "不正なメモリアクセスです（配列の範囲外など）");
      }
    }

    load(a, t) {
      const s = t.size;
      this.chk(a, s);
      const dv = this.dv;
      switch (t.k) {
        case "int":
          switch (s) {
            case 1: return t.u ? dv.getUint8(a) : dv.getInt8(a);
            case 2: return t.u ? dv.getUint16(a, true) : dv.getInt16(a, true);
            case 4: return t.u ? dv.getUint32(a, true) : dv.getInt32(a, true);
            default: return t.u ? dv.getBigUint64(a, true) : dv.getBigInt64(a, true);
          }
        case "float": return dv.getFloat32(a, true);
        case "double": return dv.getFloat64(a, true);
        case "ptr": return dv.getUint32(a, true);
      }
      throw this.err("この型の値は読み出せません");
    }

    store(a, t, v) {
      const s = t.size;
      this.chk(a, s);
      const dv = this.dv;
      switch (t.k) {
        case "int":
          switch (s) {
            case 1: dv.setUint8(a, v & 255); return;
            case 2: dv.setUint16(a, v & 65535, true); return;
            case 4: dv.setUint32(a, v >>> 0, true); return;
            default: dv.setBigUint64(a, BigInt.asUintN(64, v), true); return;
          }
        case "float": dv.setFloat32(a, v, true); return;
        case "double": dv.setFloat64(a, v, true); return;
        case "ptr": dv.setUint32(a, v >>> 0, true); dv.setUint32(a + 4, 0, true); return;
      }
      throw this.err("この型の値は書き込めません");
    }

    readCStr(addr) {
      addr = Number(addr);
      if (!(addr >= NULL_GUARD && addr < MEM_SIZE)) {
        throw this.err(addr < NULL_GUARD ? "NULLポインタが指す文字列を読もうとしました" : "不正なアドレスの文字列を読もうとしました");
      }
      const u8 = this.u8;
      let e = addr;
      while (e < MEM_SIZE && u8[e] !== 0) e++;
      return Array.from(u8.subarray(addr, e));
    }

    write(bytes) {
      const out = this.out;
      for (let i = 0; i < bytes.length; i++) out.push(bytes[i]);
      if (out.length > MAX_OUT) throw this.err("出力が多すぎるため中断しました（無限ループの可能性があります）");
    }

    // 標準入力の次の行を、必要になった時点で画面にも出す（ターミナルでは入力が画面に表示されるため）
    echoAt(inp) {
      if (!this.echoInput || inp !== this.stdin) return;
      const b = inp.bytes;
      if (inp.pos >= b.length || inp.pos < inp.echoed) return;
      const e = b.indexOf(10, inp.pos);
      const end = e < 0 ? b.length : e + 1;
      const chunk = b.slice(inp.pos, end);
      if (e < 0) chunk.push(10);
      this.write(chunk);
      inp.echoed = end;
    }

    fillMem(p, c, n) { if (n <= 0) return; this.chk(p, n); this.u8.fill(c, p, p + n); }
    copyMem(d, s, n) { if (n <= 0) return; this.chk(d, n); this.chk(s, n); this.u8.copyWithin(d, s, s + n); }

    allocStack(size, align) {
      size = Math.max(size, 1);
      const a = Math.ceil(this.sp / align) * align;
      if (a + size > STACK_END) throw this.err("スタックを使い果たしました（再帰が深すぎる、配列が大きすぎるなど）");
      this.u8.fill(0, a, a + size);
      this.sp = a + size;
      return a;
    }

    allocStatic(size, align) {
      size = Math.max(size, 1);
      const a = Math.ceil(this.staticPtr / align) * align;
      if (a + size > STATIC_END) throw this.err("グローバル変数・定数のためのメモリが足りません");
      this.staticPtr = a + size;
      return a;
    }

    heapAlloc(size) {
      size = Math.ceil(Math.max(size, 1) / 16) * 16;
      if (!(size > 0) || this.heapPtr + size > MEM_SIZE) return 0;
      const a = this.heapPtr;
      this.heapPtr += size;
      this.heapSizes.set(a, size);
      return a;
    }

    strAddr(n) {
      let a = this.strCache.get(n);
      if (a === undefined) {
        a = this.allocStatic(n.v.length + 1, 1);
        this.u8.set(n.v, a);
        this.strCache.set(n, a);
      }
      return a;
    }

    /* ---------- 変数・型 ---------- */
    lookup(name) {
      for (let i = this.scopes.length - 1; i >= 0; i--) {
        const v = this.scopes[i].get(name);
        if (v) return v;
      }
      return null;
    }

    decay(t) { return t.k === "arr" ? ptrTo(t.of) : t; }

    alignOf(t) {
      if (t.k === "arr") return this.alignOf(t.of);
      return Math.max(1, Math.min(t.size, 8));
    }

    baseType(name) {
      switch (name) {
        case "long": return this.longSize === 8 ? T.ll : T.int;
        case "ulong": return this.longSize === 8 ? T.ull : T.uint;
        default: return T[name];
      }
    }

    dimValue(d) {
      const v = Number(this.ev(d));
      if (!Number.isInteger(v) || v < 1 || v > 4000000) throw this.err(`配列の大きさが正しくありません（${v}）`);
      return v;
    }

    typeOf(tn) {
      let t = this.baseType(tn.spec.name);
      for (let i = 0; i < tn.ptr; i++) t = ptrTo(t);
      if (tn.dims && tn.dims.length) {
        const ns = tn.dims.map((d) => this.dimValue(d));
        for (let i = ns.length - 1; i >= 0; i--) t = arrOf(t, ns[i]);
      }
      return t;
    }

    paramType(p) {
      let t = this.paramTypes.get(p);
      if (t) return t;
      t = this.baseType(p.spec.name);
      for (let i = 0; i < p.ptr; i++) t = ptrTo(t);
      if (p.dims.length) {
        // 配列の引数は、先頭の [ ] をポインタに読み替える
        for (let i = p.dims.length - 1; i >= 1; i--) t = arrOf(t, this.dimValue(p.dims[i]));
        t = ptrTo(t);
      }
      this.paramTypes.set(p, t);
      return t;
    }

    retType(f) {
      let t = this.baseType(f.ret.spec.name);
      for (let i = 0; i < f.ret.ptr; i++) t = ptrTo(t);
      return t;
    }

    /* ---------- 宣言と初期化 ---------- */
    arrayType(base, it) {
      const nums = [];
      for (let k = 0; k < it.dims.length; k++) {
        if (it.dims[k]) nums.push(this.dimValue(it.dims[k]));
        else if (k === 0) nums.push(null);
        else throw this.err("配列の大きさは、最初の [ ] 以外は省略できません");
      }
      if (nums[0] === null) {
        const init = it.init;
        if (!init) throw this.err(`配列 ${it.name} の大きさが決められません（[ ] に大きさを書くか、初期値を与えてください）`);
        if (init.k === "str" && nums.length === 1) {
          nums[0] = init.v.length + 1;
        } else if (init.k === "list") {
          let inner = 1;
          for (let k = 1; k < nums.length; k++) inner *= nums[k];
          nums[0] = init.items.some((x) => x.k === "list") || nums.length === 1
            ? init.items.length : Math.ceil(init.items.length / inner);
        } else {
          throw this.err(`配列 ${it.name} の初期値の書き方が正しくありません`);
        }
        if (nums[0] < 1) throw this.err(`配列 ${it.name} の大きさが 0 になっています`);
      }
      let t = base;
      for (let i = nums.length - 1; i >= 0; i--) t = arrOf(t, nums[i]);
      return t;
    }

    execDecl(n) {
      const spec = n.spec;
      if (spec.enumItems) this.defineEnum(spec.enumItems);
      for (const it of n.items) {
        this.line = it.line;
        const scope = this.scopes[this.scopes.length - 1];
        if (spec.isStatic && !this.inGlobal) {
          const prev = this.statics.get(it);
          if (prev) { scope.set(it.name, prev); continue; }
        }
        let type = this.baseType(spec.name);
        for (let i = 0; i < it.ptr; i++) type = ptrTo(type);
        if (it.dims.length) type = this.arrayType(type, it);
        if (type.k === "void") throw this.err(`変数 ${it.name} を void 型にはできません`);
        const useStatic = this.inGlobal || spec.isStatic;
        const addr = useStatic ? this.allocStatic(type.size, this.alignOf(type))
          : this.allocStack(type.size, this.alignOf(type));
        const v = { addr, type };
        scope.set(it.name, v);
        if (spec.isStatic && !this.inGlobal) this.statics.set(it, v);
        if (it.init) this.initVar(addr, type, it.init);
      }
    }

    defineEnum(items) {
      let val = 0;
      for (const it of items) {
        this.line = it.line;
        if (it.e) val = Number(this.ev(it.e));
        const addr = this.inGlobal ? this.allocStatic(4, 4) : this.allocStack(4, 4);
        this.store(addr, T.int, val | 0);
        this.scopes[this.scopes.length - 1].set(it.name, { addr, type: T.int });
        val++;
      }
    }

    isCharArray(t) { return t.k === "arr" && t.of.k === "int" && t.of.size === 1; }

    copyStr(addr, arrType, node) {
      const n = Math.min(node.v.length, arrType.n);
      for (let i = 0; i < n; i++) this.u8[addr + i] = node.v[i];
    }

    initScalar(addr, t, node) {
      const v = this.ev(node);
      this.store(addr, t, conv(v, this.decay(this.T), t));
    }

    initVar(addr, type, init) {
      if (init.k === "list") {
        if (type.k === "arr") this.initList(addr, type, init.items, 0);
        else if (init.items.length) this.initScalar(addr, type, init.items[0]);
      } else if (type.k === "arr") {
        if (init.k === "str" && this.isCharArray(type)) this.copyStr(addr, type, init);
        else throw this.err("配列の初期値は { } で囲んで書いてください");
      } else {
        this.initScalar(addr, type, init);
      }
    }

    initList(addr, type, items, pos) {
      for (let i = 0; i < type.n; i++) {
        if (pos >= items.length) break;
        const et = type.of;
        const ea = addr + i * et.size;
        const it = items[pos];
        if (et.k === "arr") {
          if (it.k === "list") { this.initList(ea, et, it.items, 0); pos++; }
          else if (it.k === "str" && this.isCharArray(et)) { this.copyStr(ea, et, it); pos++; }
          else pos = this.initList(ea, et, items, pos);
        } else {
          this.initScalar(ea, et, it.k === "list" ? it.items[0] : it);
          pos++;
        }
      }
      return pos;
    }

    /* ---------- 実行の開始 ---------- */
    run() {
      let exitCode = 0;
      let error = null;
      try {
        for (const it of this.items) if (it.k === "func") this.funcs.set(it.name, it);
        this.line = 1;
        for (const it of this.items) if (it.k === "decl") this.execDecl(it);
        this.inGlobal = false;
        const main = this.funcs.get("main");
        if (!main) throw new CError("main 関数がありません", 1);
        const args = [], types = [];
        if (main.params.length >= 1) { args.push(1); types.push(T.int); }
        if (main.params.length >= 2) {
          const s = this.allocStatic(6, 1);
          this.u8.set(L.strBytes("a.out"), s);
          const av = this.allocStatic(16, 8);
          this.store(av, ptrTo(T.char), s);
          args.push(av); types.push(ptrTo(ptrTo(T.char)));
        }
        const r = this.callUser(main, args, types);
        exitCode = Number(r) | 0;
      } catch (e) {
        if (e instanceof L.ExitSignal) exitCode = e.code;
        else if (e instanceof CError) error = { message: e.cMessage, line: e.line };
        else if (e instanceof RangeError && /call stack/i.test(e.message)) {
          error = { message: "再帰呼び出しが深すぎます（スタックオーバーフロー）", line: this.line };
        } else throw e;
      }
      const output = new TextDecoder("utf-8").decode(Uint8Array.from(this.out));
      return { output, exitCode, error, eofHit: this.eofHit };
    }
  }

  g.CInterp = { Interp };
})(globalThis);
/* ===== C言語 簡易インタプリタ：式の評価・文の実行 ===== */
(function (g) {
  "use strict";
  const { CError, tokenize } = g.CLexer;
  const { parse } = g.CParser;
  const L = g.CLib;
  const { T, ptrTo, arrOf, isFloat, wrapInt, toNum, conv } = L;
  const Interp = g.CInterp.Interp;

  const MAX_DEPTH = 3000;
  const BRK = { brk: true };
  const CNT = { cnt: true };
  const RET = {
    int: T.int, uint: T.uint, double: T.double, void: T.void, ll: T.ll,
    cptr: ptrTo(T.char), vptr: ptrTo(T.void),
  };
  const CMP = new Set(["<", ">", "<=", ">=", "==", "!="]);

  const promote = (t) => (t.k === "int" && t.size < 4 ? T.int : t);

  function common(a, b) {
    if (a.k === "double" || b.k === "double") return T.double;
    if (a.k === "float" || b.k === "float") return T.float;
    a = promote(a); b = promote(b);
    if (a.size === b.size) return a.u ? a : b.u ? b : a;
    return a.size > b.size ? a : b;
  }

  const P = Interp.prototype;

  /* ---------- 式 ---------- */
  P.ev = function (n) {
    if ((++this.steps & 4095) === 0) this.tick();
    this.line = n.line;
    // 再帰が深くなってもスタックを使い切らないよう、この関数は小さく保つ
    switch (n.k) {
      case "num": return this.evNum(n);
      case "id": return this.evId(n);
      case "bin": {
        const a = this.ev(n.l);
        const ta = this.decay(this.T);
        const b = this.ev(n.r);
        const tb = this.decay(this.T);
        this.line = n.line;
        return this.binop(n.op, a, ta, b, tb);
      }
      case "call": return this.evCall(n);
      case "idx": return this.evIdx(n);
      case "asg": return this.evAsg(n);
      case "un": return this.evUn(n);
      case "cond": return this.ev(n.c) != 0 ? this.ev(n.a) : this.ev(n.b);
      case "log": return this.evLog(n);
      case "pre": case "post": return this.evIncDec(n);
      case "chr": this.T = T.int; return n.v;
      case "str": return this.evStr(n);
      default: return this.evMisc(n);
    }
  };

  P.evId = function (n) {
    const v = this.lookup(n.name);
    if (!v) throw this.err(`'${n.name}' は宣言されていません（変数名のつづりや、宣言の位置を確認してください）`);
    this.T = v.type;
    return v.type.k === "arr" ? v.addr : this.load(v.addr, v.type);
  };

  P.evStr = function (n) {
    const a = this.strAddr(n);
    this.T = arrOf(T.char, n.v.length + 1);
    return a;
  };

  P.evIdx = function (n) {
    const a = this.idxAddr(n);
    return this.T.k === "arr" ? a : this.load(a, this.T);
  };

  P.evBin = function (n) {
    const a = this.ev(n.l);
    const ta = this.decay(this.T);
    const b = this.ev(n.r);
    const tb = this.decay(this.T);
    this.line = n.line;
    return this.binop(n.op, a, ta, b, tb);
  };

  P.evLog = function (n) {
    const a = this.ev(n.l);
    this.T = T.int;
    if (n.op === "&&") {
      if (a == 0) return 0;
      const b = this.ev(n.r);
      this.T = T.int;
      return b == 0 ? 0 : 1;
    }
    if (a != 0) return 1;
    const b = this.ev(n.r);
    this.T = T.int;
    return b != 0 ? 1 : 0;
  };

  P.evMisc = function (n) {
    switch (n.k) {
      case "cast": {
        const t = this.typeOf(n.type);
        const v = this.ev(n.e);
        const ft = this.decay(this.T);
        this.T = t;
        return t.k === "void" ? 0 : conv(v, ft, t);
      }
      case "sizeofT": { const t = this.typeOf(n.type); this.T = T.uint; return t.size; }
      case "sizeofE": { this.ev(n.e); const sz = this.T.size; this.T = T.uint; return sz; }
      case "comma": this.ev(n.l); return this.ev(n.r);
    }
    throw this.err("この式は実行できません");
  };

  P.evNum = function (n) {
    if (n.isFloat) { this.T = n.f ? T.float : T.double; return n.f ? Math.fround(n.v) : n.v; }
    const v = n.v;
    const wantLL = n.l >= 2 || (n.l === 1 && this.longSize === 8);
    let t;
    if (wantLL) t = n.u || v > 0x7FFFFFFFFFFFFFFFn ? T.ull : T.ll;
    else if (n.u) t = v > 0xFFFFFFFFn ? T.ull : T.uint;
    else if (v <= 0x7FFFFFFFn) t = T.int;
    else if (n.hex && v <= 0xFFFFFFFFn) t = T.uint;
    else t = v <= 0x7FFFFFFFFFFFFFFFn ? T.ll : T.ull;
    this.T = t;
    return t.size === 8 ? wrapInt(v, t) : Number(v);
  };

  // 左辺値のアドレス（this.T に型を入れる）
  P.lv = function (n) {
    this.line = n.line;
    switch (n.k) {
      case "id": {
        const v = this.lookup(n.name);
        if (!v) throw this.err(`'${n.name}' は宣言されていません（変数名のつづりや、宣言の位置を確認してください）`);
        this.T = v.type;
        return v.addr;
      }
      case "idx": return this.idxAddr(n);
      case "un":
        if (n.op === "*") {
          const p = this.ev(n.e);
          const t = this.decay(this.T);
          if (t.k !== "ptr") throw this.err("* の対象がポインタではありません");
          this.T = t.to;
          return p;
        }
        break;
    }
    throw this.err("代入できない式です（変数・配列の要素・*ポインタ にだけ代入できます）");
  };

  P.idxAddr = function (n) {
    let base = this.ev(n.a);
    let tb = this.decay(this.T);
    let idx = this.ev(n.i);
    let ti = this.decay(this.T);
    if (tb.k !== "ptr" && ti.k === "ptr") { [base, idx] = [idx, base]; [tb, ti] = [ti, tb]; }
    if (tb.k !== "ptr") throw this.err("[ ] は配列またはポインタにしか使えません");
    if (ti.k !== "int") throw this.err("配列の添字は整数にしてください");
    this.line = n.line;
    this.T = tb.to;
    return base + Number(idx) * tb.to.size;
  };

  P.evUn = function (n) {
    switch (n.op) {
      case "&": { const a = this.lv(n.e); this.T = ptrTo(this.T); return a; }
      case "*": {
        const p = this.ev(n.e);
        const t = this.decay(this.T);
        if (t.k !== "ptr") throw this.err("* の対象がポインタではありません");
        if (t.to.k === "void") throw this.err("void* の指す先は直接読み書きできません（型を変換してください）");
        this.line = n.line;
        this.T = t.to;
        return t.to.k === "arr" ? p : this.load(p, t.to);
      }
      case "!": { const v = this.ev(n.e); this.T = T.int; return v == 0 ? 1 : 0; }
      case "-": case "+": case "~": {
        const v = this.ev(n.e);
        const t = this.T;
        if (isFloat(t)) {
          if (n.op === "~") throw this.err("小数には ~ は使えません");
          return n.op === "-" ? -v : v;
        }
        if (t.k !== "int") throw this.err(`${n.op} は数値にしか使えません`);
        const pt = promote(t);
        this.T = pt;
        return wrapInt(n.op === "-" ? -v : n.op === "~" ? ~v : v, pt);
      }
    }
    throw this.err("この式は実行できません");
  };

  P.evIncDec = function (n) {
    const a = this.lv(n.e);
    const t = this.T;
    if (t.k === "arr") throw this.err("配列そのものには ++ や -- は使えません");
    const old = this.load(a, t);
    const d = n.op === "++" ? 1 : -1;
    let nv;
    if (t.k === "ptr") nv = old + d * t.to.size;
    else if (t.k === "float") nv = Math.fround(old + d);
    else if (t.k === "double") nv = old + d;
    else nv = wrapInt(typeof old === "bigint" ? old + BigInt(d) : old + d, t);
    this.store(a, t, nv);
    this.T = t;
    return n.k === "pre" ? nv : old;
  };

  P.evAsg = function (n) {
    const a = this.lv(n.l);
    const lt = this.T;
    if (lt.k === "arr") throw this.err("配列全体には代入できません（文字列のコピーには strcpy を使います）");
    const rv = this.ev(n.r);
    const rt = this.decay(this.T);
    this.line = n.line;
    let val;
    if (n.op === "=") {
      val = conv(rv, rt, lt);
    } else {
      const old = this.load(a, lt);
      const res = this.binop(n.op.slice(0, -1), old, lt, rv, rt);
      val = conv(res, this.T, lt);
    }
    this.store(a, lt, val);
    this.T = lt;
    return val;
  };

  P.binop = function (op, a, ta, b, tb) {
    // よく使う「int どうし」「double どうし」は近道で計算する
    if (ta === T.int && tb === T.int) {
      switch (op) {
        case "+": this.T = T.int; return (a + b) | 0;
        case "-": this.T = T.int; return (a - b) | 0;
        case "*": this.T = T.int; return Math.imul(a, b);
        case "<": this.T = T.int; return a < b ? 1 : 0;
        case ">": this.T = T.int; return a > b ? 1 : 0;
        case "<=": this.T = T.int; return a <= b ? 1 : 0;
        case ">=": this.T = T.int; return a >= b ? 1 : 0;
        case "==": this.T = T.int; return a === b ? 1 : 0;
        case "!=": this.T = T.int; return a !== b ? 1 : 0;
      }
    } else if (ta === T.double && tb === T.double) {
      switch (op) {
        case "+": this.T = T.double; return a + b;
        case "-": this.T = T.double; return a - b;
        case "*": this.T = T.double; return a * b;
        case "/": this.T = T.double; return a / b;
        case "<": this.T = T.int; return a < b ? 1 : 0;
        case ">": this.T = T.int; return a > b ? 1 : 0;
      }
    }
    const pa = ta.k === "ptr", pb = tb.k === "ptr";
    if (pa || pb) return this.ptrOp(op, a, ta, b, tb);
    if (ta.k === "void" || tb.k === "void") throw this.err("void の値は計算に使えません");
    if (op === "<<" || op === ">>") return this.shiftOp(op, a, ta, b);
    const C = common(ta, tb);
    if (isFloat(C)) {
      const x = toNum(a), y = toNum(b);
      let r;
      switch (op) {
        case "+": r = x + y; break;
        case "-": r = x - y; break;
        case "*": r = x * y; break;
        case "/": r = x / y; break;
        case "<": this.T = T.int; return x < y ? 1 : 0;
        case ">": this.T = T.int; return x > y ? 1 : 0;
        case "<=": this.T = T.int; return x <= y ? 1 : 0;
        case ">=": this.T = T.int; return x >= y ? 1 : 0;
        case "==": this.T = T.int; return x === y ? 1 : 0;
        case "!=": this.T = T.int; return x !== y ? 1 : 0;
        default: throw this.err(`小数（float, double）には ${op} は使えません`);
      }
      this.T = C;
      return C.k === "float" ? Math.fround(r) : r;
    }
    const x = wrapInt(a, C), y = wrapInt(b, C);
    if (CMP.has(op)) {
      this.T = T.int;
      switch (op) {
        case "<": return x < y ? 1 : 0;
        case ">": return x > y ? 1 : 0;
        case "<=": return x <= y ? 1 : 0;
        case ">=": return x >= y ? 1 : 0;
        case "==": return x == y ? 1 : 0;
        default: return x != y ? 1 : 0;
      }
    }
    this.T = C;
    if (C.size === 8) {
      switch (op) {
        case "+": return wrapInt(x + y, C);
        case "-": return wrapInt(x - y, C);
        case "*": return wrapInt(x * y, C);
        case "/": if (y === 0n) throw this.err("0で割り算をしました"); return wrapInt(x / y, C);
        case "%": if (y === 0n) throw this.err("0で割った余りを求めようとしました"); return wrapInt(x % y, C);
        case "&": return wrapInt(x & y, C);
        case "|": return wrapInt(x | y, C);
        case "^": return wrapInt(x ^ y, C);
      }
    } else {
      switch (op) {
        case "+": return wrapInt(x + y, C);
        case "-": return wrapInt(x - y, C);
        case "*": return C.u ? Math.imul(x, y) >>> 0 : Math.imul(x, y);
        case "/": if (y === 0) throw this.err("0で割り算をしました"); return wrapInt(Math.trunc(x / y), C);
        case "%": if (y === 0) throw this.err("0で割った余りを求めようとしました"); return wrapInt(x % y, C);
        case "&": return C.u ? (x & y) >>> 0 : x & y;
        case "|": return C.u ? (x | y) >>> 0 : x | y;
        case "^": return C.u ? (x ^ y) >>> 0 : x ^ y;
      }
    }
    throw this.err(`演算子 ${op} は使えません`);
  };

  P.shiftOp = function (op, a, ta, b) {
    if (ta.k !== "int") throw this.err(`小数には ${op} は使えません`);
    const Lt = promote(ta);
    const x = wrapInt(a, Lt);
    const cnt = Number(b);
    this.T = Lt;
    if (Lt.size === 8) {
      const s = BigInt(cnt & 63);
      return wrapInt(op === "<<" ? x << s : x >> s, Lt);
    }
    const s = cnt & 31;
    if (op === "<<") return Lt.u ? (x << s) >>> 0 : x << s;
    return Lt.u ? x >>> s : x >> s;
  };

  P.ptrOp = function (op, a, ta, b, tb) {
    const pa = ta.k === "ptr", pb = tb.k === "ptr";
    if (op === "+" || op === "-") {
      if (pa && pb) {
        if (op === "+") throw this.err("ポインタどうしは足せません");
        this.T = T.int;
        return Math.trunc((a - b) / (ta.to.size || 1)) | 0;
      }
      if (pa) {
        if (tb.k !== "int") throw this.err("ポインタに足す・引く値は整数にしてください");
        this.T = ta;
        return a + (op === "+" ? 1 : -1) * Number(b) * ta.to.size;
      }
      if (op === "-") throw this.err("整数からポインタは引けません");
      if (ta.k !== "int") throw this.err("ポインタに足す値は整数にしてください");
      this.T = tb;
      return b + Number(a) * tb.to.size;
    }
    if (CMP.has(op)) {
      const x = Number(a), y = Number(b);
      this.T = T.int;
      switch (op) {
        case "<": return x < y ? 1 : 0;
        case ">": return x > y ? 1 : 0;
        case "<=": return x <= y ? 1 : 0;
        case ">=": return x >= y ? 1 : 0;
        case "==": return x === y ? 1 : 0;
        default: return x !== y ? 1 : 0;
      }
    }
    throw this.err(`ポインタには ${op} は使えません`);
  };

  /* ---------- 関数呼び出し ---------- */
  P.evCall = function (n) {
    const name = n.fn.name;
    const args = new Array(n.args.length);
    const types = new Array(n.args.length);
    for (let i = 0; i < n.args.length; i++) {
      args[i] = this.ev(n.args[i]);
      types[i] = this.decay(this.T);
    }
    this.line = n.line;
    const f = this.funcs.get(name);
    if (f) return this.callUser(f, args, types);
    const b = L.builtins[name];
    if (b) {
      const r = b.fn(this, args, types);
      this.T = RET[b.ret];
      return r;
    }
    throw this.err(`関数 ${name} が見つかりません（定義がない、または未対応の標準関数です）`);
  };

  P.callUser = function (f, args, types) {
    if (f.variadic) throw this.err(`可変個引数の関数（${f.name}）は未対応です`);
    if (args.length < f.params.length) throw this.err(`関数 ${f.name} に渡す引数が足りません（${f.params.length}個必要です）`);
    if (args.length > f.params.length) throw this.err(`関数 ${f.name} に渡す引数が多すぎます（${f.params.length}個です）`);
    if (++this.depth > MAX_DEPTH) {
      this.depth--;
      throw this.err("再帰呼び出しが深すぎます（スタックオーバーフロー）");
    }
    const savedScopes = this.scopes, savedSp = this.sp, savedLine = this.line;
    const scope = new Map();
    this.scopes = [this.globalScope, scope];
    let res;
    try {
      for (let i = 0; i < f.params.length; i++) {
        const p = f.params[i];
        const pt = this.paramType(p);
        const addr = this.allocStack(pt.size, this.alignOf(pt));
        this.store(addr, pt, conv(args[i], types[i], pt));
        if (p.name) scope.set(p.name, { addr, type: pt });
      }
      res = this.execBlock(f.body, false);
    } finally {
      this.scopes = savedScopes;
      this.sp = savedSp;
      this.depth--;
    }
    this.line = savedLine;
    const rt = this.retType(f);
    this.T = rt;
    if (rt.k === "void") return 0;
    if (res && res.ret && res.t) return conv(res.r, res.t, rt);
    return rt.size === 8 && rt.k === "int" ? 0n : 0;
  };

  /* ---------- 文 ---------- */
  P.execBlock = function (n, push) {
    if (push !== false) this.scopes.push(new Map());
    const sp = this.sp;
    let r;
    const items = n.items;
    for (let i = 0; i < items.length; i++) {
      r = this.exec(items[i]);
      if (r !== undefined) break;
    }
    if (push !== false) this.scopes.pop();
    this.sp = sp;
    return r;
  };

  P.exec = function (n) {
    if ((++this.steps & 4095) === 0) this.tick();
    this.line = n.line;
    // 再帰が深くなってもスタックを使い切らないよう、この関数は小さく保つ
    switch (n.k) {
      case "expr": this.ev(n.e); return undefined;
      case "return": {
        if (!n.e) return { ret: true, r: undefined, t: null };
        const v = this.ev(n.e);
        return { ret: true, r: v, t: this.decay(this.T) };
      }
      case "if":
        if (this.ev(n.cond) != 0) return this.exec(n.then);
        return n.els ? this.exec(n.els) : undefined;
      case "block": return this.execBlock(n, true);
      case "decl": this.execDecl(n); return undefined;
      case "for": return this.execFor(n);
      case "while": return this.execWhile(n);
      case "dowhile": return this.execDoWhile(n);
      case "switch": return this.execSwitch(n);
      case "break": return BRK;
      case "continue": return CNT;
      case "case": case "default": case "empty": return undefined;
    }
    throw this.err("この文は実行できません");
  };

  P.execReturn = function (n) {
    if (!n.e) return { ret: true, r: undefined, t: null };
    const v = this.ev(n.e);
    return { ret: true, r: v, t: this.decay(this.T) };
  };

  P.execWhile = function (n) {
    for (;;) {
      if ((++this.steps & 4095) === 0) this.tick();
      if (this.ev(n.cond) == 0) break;
      const r = this.exec(n.body);
      if (r === BRK) break;
      if (r !== undefined && r !== CNT) return r;
    }
    return undefined;
  };

  P.execDoWhile = function (n) {
    for (;;) {
      if ((++this.steps & 4095) === 0) this.tick();
      const r = this.exec(n.body);
      if (r === BRK) break;
      if (r !== undefined && r !== CNT) return r;
      if (this.ev(n.cond) == 0) break;
    }
    return undefined;
  };

  P.execFor = function (n) {
    this.scopes.push(new Map());
    const sp = this.sp;
    let res;
    if (n.init) {
      if (n.init.k === "decl") this.execDecl(n.init);
      else this.ev(n.init);
    }
    for (;;) {
      if ((++this.steps & 4095) === 0) this.tick();
      if (n.cond && this.ev(n.cond) == 0) break;
      const r = this.exec(n.body);
      if (r === BRK) break;
      if (r !== undefined && r !== CNT) { res = r; break; }
      if (n.step) this.ev(n.step);
    }
    this.scopes.pop();
    this.sp = sp;
    return res;
  };

  P.execSwitch = function (n) {
    const v = Number(this.ev(n.e));
    const items = n.body.items;
    this.scopes.push(new Map());
    const sp = this.sp;
    let start = -1, def = -1, res;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (it.k === "case") {
        if (Number(this.ev(it.e)) === v) { start = i; break; }
      } else if (it.k === "default") def = i;
    }
    if (start < 0) start = def;
    if (start >= 0) {
      for (let i = start; i < items.length; i++) {
        const r = this.exec(items[i]);
        if (r === BRK) break;
        if (r !== undefined) { res = r; break; }
      }
    }
    this.scopes.pop();
    this.sp = sp;
    return res;
  };

  /* ---------- 公開関数 ---------- */
  function run(source, opts) {
    opts = opts || {};
    let items;
    try {
      const tk = tokenize(source, opts.lineOffset || 0);
      items = parse(tk.tokens);
    } catch (e) {
      if (e instanceof CError) {
        return { output: "", exitCode: null, error: { message: e.cMessage, line: e.line }, phase: "compile" };
      }
      throw e;
    }
    const result = new Interp(items, opts).run();
    result.phase = "run";
    return result;
  }

  g.CInterp.run = run;
})(globalThis);
