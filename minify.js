#!/usr/bin/env node
/*!
 * minify.js - zero dependency minifier for cjf.js
 *
 *   node minify.js [src] [out]        default: cjf.js -> cjf.min.js
 *   node minify.js --no-rename        only strip comments / whitespace
 *
 * What it does
 *   1. tokenizes the source (strings, regex, templates and comments handled)
 *   2. drops every comment
 *   3. renames local functions / variables to 1-2 letters
 *   4. removes all whitespace that is not needed between two tokens
 *   5. extra: true -> !0, false -> !1, undefined -> void 0,
 *      drops ";" before "}" and at the very end
 *   6. prints original / minified / gzip sizes and smoke-runs the output
 *
 * Identifier safety: only names *declared* inside the file (var, function
 * parameters, function names) are renamed. Property access (a.b), object keys
 * ({ b: 1 }) and string / regex / template literals are left untouched.
 */
'use strict';

var fs = require('fs');
var path = require('path');
var zlib = require('zlib');
var vm = require('vm');

var ROOT = __dirname;
var args = process.argv.slice(2).filter(function (a) { return a.indexOf('--') !== 0; });
var RENAME = process.argv.indexOf('--no-rename') < 0;
var SRC = path.resolve(args[0] || path.join(ROOT, 'cjf.js'));
var OUT = path.resolve(args[1] || SRC.replace(/\.js$/, '.min.js'));

/* ------------------------------------------------------------------ 1. lexer */

var KEYWORDS = ('break case catch class const continue debugger default delete do else export ' +
  'extends finally for function if import in instanceof let new return super switch this throw ' +
  'try typeof var void while with yield true false null undefined').split(' ');

var MULTI = ['>>>=', '===', '!==', '>>>', '<<=', '>>=', '**=', '=>', '==', '!=', '<=', '>=',
  '&&', '||', '++', '--', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<', '>>', '**'];

/* tokens after which a "/" starts a regex, not a division */
var REGEX_AFTER_PUNCT = '([{,;=:?!&|+-*%<>^~';
var REGEX_AFTER_WORD = { 'return': 1, 'typeof': 1, 'instanceof': 1, 'in': 1, 'of': 1, 'new': 1,
  'delete': 1, 'void': 1, 'case': 1, 'do': 1, 'else': 1, 'yield': 1 };

function tokenize(src) {
  var out = [], i = 0, n = src.length, last = null, start;
  function push(type, value) {
    var tok = { t: type, v: value };
    out.push(tok);
    last = tok;
  }
  function word(c) { return /[A-Za-z0-9_$]/.test(c); }
  while (i < n) {
    var c = src[i];
    start = i;
    if (/\s/.test(c)) { i++; continue; }

    if (c === '/' && src[i + 1] === '/') {
      while (i < n && src[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i = Math.min(i + 2, n);
      continue;
    }
    if (c === '"' || c === "'") {
      i++;
      while (i < n) {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === c) { i++; break; }
        i++;
      }
      push('str', src.slice(start, i));
      continue;
    }
    if (c === '`') {
      i++;
      var depth = 0;
      while (i < n) {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === '$' && src[i + 1] === '{') { depth++; i += 2; continue; }
        if (src[i] === '}' && depth) { depth--; i++; continue; }
        if (src[i] === '`' && !depth) { i++; break; }
        i++;
      }
      push('tpl', src.slice(start, i));
      continue;
    }
    if (/[A-Za-z_$]/.test(c)) {
      i++;
      while (i < n && word(src[i])) i++;
      push('id', src.slice(start, i));
      continue;
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] || ''))) {
      i++;
      while (i < n && /[0-9A-Za-z_.]/.test(src[i])) i++;
      push('num', src.slice(start, i));
      continue;
    }
    if (c === '/') {
      var ok = !last ||
        (last.t === 'p' && REGEX_AFTER_PUNCT.indexOf(last.v) >= 0) ||
        (last.t === 'id' && REGEX_AFTER_WORD[last.v]);
      if (ok) {
        i++;
        var cls = false;
        while (i < n) {
          var ch = src[i];
          if (ch === '\\') { i += 2; continue; }
          if (ch === '[') cls = true;
          else if (ch === ']') cls = false;
          else if (ch === '/' && !cls) { i++; break; }
          i++;
        }
        while (i < n && /[a-z]/.test(src[i])) i++;
        push('re', src.slice(start, i));
        continue;
      }
    }
    var op = null;
    for (var k = 0; k < MULTI.length; k++) {
      if (src.substr(i, MULTI[k].length) === MULTI[k]) { op = MULTI[k]; break; }
    }
    if (op) { i += op.length; push('p', op); continue; }
    i++;
    push('p', c);
  }
  return out;
}

/* ------------------------------------------------------- 2. declared names */

function declaredNames(tokens) {
  var set = {}, i, t;

  function skipParens(j) {                       /* j points at "(" */
    var depth = 0;
    for (; j < tokens.length; j++) {
      if (tokens[j].v === '(') depth++;
      else if (tokens[j].v === ')' && --depth === 0) return j;
    }
    return j;
  }

  for (i = 0; i < tokens.length; i++) {
    t = tokens[i];

    if (t.t === 'id' && t.v === 'function') {
      var j = i + 1;
      if (tokens[j] && tokens[j].t === 'id') { set[tokens[j].v] = 1; j++; }
      if (tokens[j] && tokens[j].v === '(') {
        var end = skipParens(j), depth = 0, expect = false;
        for (var k = j; k <= end; k++) {
          var tk = tokens[k];
          if (tk.v === '(') { depth++; expect = depth === 1; continue; }
          if (tk.v === ')') { depth--; continue; }
          if (tk.v === ',') { if (depth === 1) expect = true; continue; }
          if (expect && tk.t === 'id') { set[tk.v] = 1; expect = false; }
        }
      }
      continue;
    }

    if (t.t === 'id' && t.v === 'var') {
      var depth2 = 0, expect2 = true;
      for (var m = i + 1; m < tokens.length; m++) {
        var v = tokens[m].v;
        if (v === '(' || v === '[' || v === '{') { depth2++; continue; }
        if (v === ')' || v === ']' || v === '}') { if (!depth2) break; depth2--; continue; }
        if (depth2) continue;
        if (v === ';') break;
        if (v === ',') { expect2 = true; continue; }
        if (expect2 && tokens[m].t === 'id') { set[v] = 1; expect2 = false; }
      }
    }
  }
  return set;
}

/* --------------------------------------------------------------- 3. rename */

function shortNames(count, avoid) {
  var letters = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
  var out = [], i, j;
  for (i = 0; i < letters.length && out.length < count; i++) out.push(letters[i]);
  for (i = 0; i < letters.length && out.length < count; i++) {
    for (j = 0; j < letters.length && out.length < count; j++) out.push(letters[i] + letters[j]);
  }
  return out.filter(function (s) { return !avoid[s]; });
}

function makeMap(tokens, declared, avoid) {
  /* the hottest names get the shortest names */
  var freq = {}, i;
  for (i = 0; i < tokens.length; i++) {
    var t = tokens[i];
    if (t.t === 'id' && declared[t.v]) freq[t.v] = (freq[t.v] || 0) + 1;
  }
  var names = Object.keys(declared).sort(function (a, b) {
    return (freq[b] || 0) - (freq[a] || 0) || (a < b ? -1 : 1);
  });
  var pool = shortNames(names.length, avoid);
  if (pool.length < names.length) throw new Error('minify: no short names left');
  var map = {};
  for (i = 0; i < names.length; i++) map[names[i]] = pool[i];
  return map;
}

/* ---------------------------------------------------------------- 4. emit  */

function minify(src, rename) {
  var tokens = tokenize(src);
  var map = {}, avoid = {}, i, t;

  if (rename) {
    var declared = declaredNames(tokens);
    for (i = 0; i < KEYWORDS.length; i++) avoid[KEYWORDS[i]] = 1;
    /* never reuse a name that is still visible in the file */
    for (i = 0; i < tokens.length; i++) {
      t = tokens[i];
      if (t.t !== 'id') continue;
      if (declared[t.v]) continue;
      avoid[t.v] = 1;
    }
    map = makeMap(tokens, declared, avoid);
  }

  var out = '', prev = null;
  function needSpace(a, b) {
    var ca = a.v.charAt(a.v.length - 1), cb = b.v.charAt(0);
    if (/[A-Za-z0-9_$]/.test(ca) && /[A-Za-z0-9_$]/.test(cb)) return true;
    if ((ca === '+' && cb === '+') || (ca === '-' && cb === '-')) return true;
    if (ca === '/' && (cb === '/' || cb === '*')) return true;
    return false;
  }

  for (i = 0; i < tokens.length; i++) {
    t = tokens[i];
    var text = t.v;
    var next = tokens[i + 1];
    var prevText = i ? tokens[i - 1].v : '';
    var prevTok = i ? tokens[i - 1] : null;

    if (t.t === 'id') {
      var isProp = prevTok && prevTok.v === '.';
      var isKey = next && next.v === ':' && (prevText === '{' || prevText === ',');
      if (!isProp && !isKey && map[t.v]) text = map[t.v];
      else if (!isProp && !isKey && t.v === 'true') text = '!0';
      else if (!isProp && !isKey && t.v === 'false') text = '!1';
      else if (!isProp && !isKey && t.v === 'undefined') text = 'void 0';
    }

    /* ";" right before "}" and at the end of the file is redundant */
    if (t.v === ';' && (!next || next.v === '}')) continue;

    if (prev && needSpace({ v: out.slice(-1) }, { v: text.charAt(0) })) out += ' ';
    out += text;
    prev = { v: text };
  }
  return out;
}

/* ---------------------------------------------------------------- 5. main  */

var src = fs.readFileSync(SRC, 'utf8');
var min = minify(src, RENAME);
fs.writeFileSync(OUT, min);

/* smoke run: the output must still expose CJF */
var sandbox = { console: console, JSON: JSON, Object: Object, Array: Array, String: String,
  Number: Number, RegExp: RegExp, Date: Date, Math: Math, parseInt: parseInt, isNaN: isNaN };
sandbox.document = {
  querySelector: function () { return null; },
  querySelectorAll: function () { return []; },
  createElement: function () { return { appendChild: function () {}, setAttribute: function () {} }; },
  head: { appendChild: function () {} },
  documentElement: { appendChild: function () {} },
  addEventListener: function () {}
};
sandbox.window = { document: sandbox.document, matchMedia: null, XMLHttpRequest: function () {} };
try {
  vm.runInNewContext(min, sandbox);
} catch (e) {
  console.error('minified output does not run:', e.message);
  process.exit(1);
}
if (!sandbox.window.CJF || typeof sandbox.window.CJF.render !== 'function') {
  console.error('minified output lost the CJF API');
  process.exit(1);
}

var gzip = zlib.gzipSync(Buffer.from(min)).length;
console.log('source   ' + src.length + ' B -> ' + OUT);
console.log('minified ' + min.length + ' B (' + (100 * min.length / src.length).toFixed(1) + '%)');
console.log('gzip     ' + gzip + ' B (' + (100 * gzip / Buffer.byteLength(src)).toFixed(1) + '% of source bytes)');
console.log('renamed  ' + (RENAME ? 'yes' : 'no') + ' | length ' + min.length);
