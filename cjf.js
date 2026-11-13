/*!
 * cjf.js v0.2 - classless JSON Form
 * JSON Schema 2020-12 -> native HTML5 widgets. Browser only, zero dependency, ES5.
 *
 *   CJF.render(target, schema[, options])  -> <form> | <form>[]   options: { onSubmit, request }
 *     root object -> one form and one menu entry
 *     root array  -> one form per prefixItems entry (legacy array "items" works too)
 *   CJF.collect(form)                      -> plain object
 *
 * Widget selection follows mapping.md. UI hints (unknown to validators, safe):
 *   title      row label; the key itself is only used in the submitted data
 *   x-format   switch | select | range | button | radios | accordion |
 *              password | date | time | datetime-local | email | uri | color | file
 *              (button: one action button, label x-enum[0], value default)
 *   x-layout   form layout: aligned (default) | stacked | aligned-A-B
 *   x-inline   true lays radios / buttons out on one line
 *   x-enum     option labels: array parallel to enum, or { "value": "Label" }
 *   x-api-addr POST target of x-format:button, once on the root schema
 *   x-hidden   true drops the key from the submitted values; its children move up
 *   x-disabled, x-placeholder
 *   x-template / x-watch   computed read-only field
 *
 * The "format" keyword is NOT read here: it is a validation keyword, checked in
 * the backend. Use x-format to pick a widget; format: "email" alone still
 * renders a plain text input.
 */
(function (win, doc) {
  'use strict';

  /* ------------------------------------------------------------- 1. helpers */

  function q(sel, root) { return (root || doc).querySelector(sel); }
  function qa(sel, root) { return (root || doc).querySelectorAll(sel); }

  function each(obj, fn) {
    for (var key in obj) { if (obj.hasOwnProperty(key)) fn(key, obj[key]); }
  }

  function isArr(v) { return Object.prototype.toString.call(v) === '[object Array]'; }
  function isObj(v) { return !!v && typeof v === 'object' && !isArr(v); }

  function has(list, v) {
    for (var i = 0; list && i < list.length; i++) { if (list[i] === v) return true; }
    return false;
  }

  function esc(v) {
    return (v === null || v === undefined ? '' : String(v))
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /* { a: 1, b: true, c: false, d: null } -> ' a="1" b' */
  function attr(map) {
    var out = '';
    each(map, function (key, value) {
      if (value === undefined || value === null || value === false || value === '') return;
      out += value === true ? ' ' + key : ' ' + key + '="' + esc(value) + '"';
    });
    return out;
  }

  function idOf(path) { return 'cjf-' + path.replace(/[^A-Za-z0-9]+/g, '-'); }

  function typeOf(p) {
    if (p.type) return p.type;
    if (p.properties) return 'object';
    if (p.items) return 'array';
    if (p.enum) {
      var v = p.enum[0];
      if (typeof v === 'number') return v % 1 === 0 ? 'integer' : 'number';
      if (typeof v === 'boolean') return 'boolean';
    }
    return 'string';
  }

  function parts(path) {
    var out = [], re = /([^.[\]]+)|\[([0-9]+)\]/g, m;
    while ((m = re.exec(String(path)))) {
      out.push(m[2] === undefined ? m[1] : parseInt(m[2], 10));
    }
    return out;
  }

  function get(obj, path) {
    var ps = parts(path), o = obj;
    for (var i = 0; i < ps.length; i++) {
      if (o === null || o === undefined) return undefined;
      o = o[ps[i]];
    }
    return o;
  }

  function set(obj, path, value) {
    var ps = parts(path), o = obj;
    for (var i = 0; i < ps.length - 1; i++) {
      var key = ps[i];
      if (!o[key] || typeof o[key] !== 'object') {
        o[key] = typeof ps[i + 1] === 'number' ? [] : {};
      }
      o = o[key];
    }
    if (ps.length) o[ps[ps.length - 1]] = value;
  }

  function cast(value, type) {
    if (type === 'boolean') return value === true || value === 'true';
    if (type === 'number' || type === 'integer') return value === '' ? undefined : Number(value);
    return value;
  }

  /* field labels are always the property name (schema "title" is only used
     for whole forms: menu entries and the document title) */
  /* "title" is the row label; the property key is only used in the submitted data */
  function labelOf(p) { return p['title'] || ''; }

  /* --------------------------------------------------- 2. shared html pieces */

  /* enum + x-enum -> [{ v: value, l: label }] ; also serves boolean true/false
     and array items (items.enum). Used by select and radios. */
  function options(p) {
    var item = p.items || {};
    var list = p.enum || item.enum;
    var labels = p['x-enum'] || item['x-enum'];
    if (!list) {
      /* boolean: false first, so x-enum[0] labels false and x-enum[1] labels true */
      if (typeOf(p) === 'boolean') list = [false, true];
      else return [];
    }
    var out = [];
    for (var i = 0; i < list.length; i++) {
      out.push({ v: list[i], l: label(labels, list[i], i) });
    }
    return out;
  }

  function label(labels, value, index) {
    if (!labels) return String(value);
    var l = isArr(labels) ? labels[index] : labels[value];
    return l === undefined ? String(value) : l;
  }

  /* one button builder: api buttons and action buttons */
  function button(text, map) {
    return '<button type="button"' + attr(map) + '>' + esc(text) + '</button>';
  }

  /* one input builder: text/number/range/color/file/date/time/email/url/
     checkbox/radio, incl. every native validation attribute */
  function inputHTML(type, path, p, a) {
    a = a || {};
    var t = a.type || typeOf(p);
    var boxed = type === 'checkbox' || type === 'radio';
    var map = {
      type: type,
      id: a.id === false ? null : idOf(path),
      name: path,
      'data-type': t,
      'data-key': a.key || null,
      /* a lone checkbox/switch can't express "required" (false is a value) */
      required: type === 'radio' || !boxed ? a.required : null,
      readonly: !boxed && p.readOnly,
      disabled: p['x-disabled'] || a.disabled,
      min: p.minimum,
      max: p.maximum,
      step: type === 'number' || type === 'range'
        ? (p.multipleOf || (t === 'integer' ? 1 : 'any')) : null,
      minlength: p.minLength,
      maxlength: p.maxLength,
      pattern: p.pattern,
      placeholder: p['x-placeholder'] || p.placeholder,
      title: p.description,
      role: a.role
    };
    if (boxed) {
      map.checked = a.checked !== undefined ? a.checked : p['default'] === true;
      if (a.value !== undefined) map.value = String(a.value);
    } else {
      map.value = String(a.value !== undefined ? a.value
        : (p['default'] === undefined ? '' : p['default']));
    }
    return '<input' + attr(map) + '>';
  }

  /* one select builder: string enum, number enum, boolean */
  function selectHTML(path, p, a) {
    a = a || {};
    var t = typeOf(p), opts = options(p);
    var current = a.value !== undefined ? a.value : p['default'];
    var html = '<select' + attr({
      id: idOf(path),
      name: path,
      'data-key': a.key || null,
      'data-type': t,
      required: a.required,
      disabled: p['x-disabled']
    }) + '>';
    if (!a.key && current === undefined) html += '<option value=""></option>';
    for (var i = 0; i < opts.length; i++) {
      html += '<option' + attr({
        value: String(opts[i].v),
        selected: String(opts[i].v) === String(current)
      }) + '>' + esc(opts[i].l) + '</option>';
    }
    return html + '</select>';
  }

  /* --------------------------------------------------------- 3. widgets (W) */

  function typed(type) {
    return function (p, path, ctx, a) { return inputHTML(type, path, p, a); };
  }

  /* one option per <label>, laid out inline when x-inline is true (radios) */
  function optionGroup(p, type, path, a) {
    var opts = options(p), current = p['default'];
    var html = '';
    for (var i = 0; i < opts.length; i++) {
      html += '<label>' + inputHTML(type, path, p, {
        id: false, value: opts[i].v,
        checked: String(opts[i].v) === String(current),
        required: a && a.required && i === 0
      }) + esc(opts[i].l) + '</label>';
    }
    return '<fieldset' + attr({ 'data-inline': p['x-inline'] === true }) + '>' + html + '</fieldset>';
  }

  var W = {
    text: typed('text'),
    password: typed('password'),
    number: typed('number'),
    range: typed('range'),
    color: typed('color'),
    file: typed('file'),
    date: typed('date'),
    time: typed('time'),
    'datetime-local': typed('datetime-local'),
    email: typed('email'),
    uri: typed('url'),
    checkbox: typed('checkbox'),
    select: function (p, path, ctx, a) { return selectHTML(path, p, a); },
    radios: function (p, path, ctx, a) { return optionGroup(p, 'radio', path, a); }
  };

  W['switch'] = function (p, path, ctx, a) {
    return inputHTML('checkbox', path, p, { role: 'switch', checked: a && a.checked });
  };

  /* api address: field level wins, the root schema is the default */
  function apiAddr(p, ctx) {
    return p['x-api-addr'] || (ctx && ctx.api) || '';
  }

  /* button widget: one action button; it posts { "<key>": <value> } */
  W.button = function (p, path, ctx, a) {
    a = a || {};
    var key = a.key !== undefined ? a.key : path.split('.').pop();
    var label = a.title || (p['x-enum'] && p['x-enum'][0]) || p['title'] || 'Submit';
    var value = a.value !== undefined ? a.value
      : (p['default'] !== undefined ? p['default'] : (p.enum ? p.enum[0] : 1));
    return button(label, {
      'data-api': apiAddr(p, ctx),
      'data-key': key,
      'data-value': String(value),
      'data-type': typeOf(p)
    });
  };

  /* {{path}} from a plain data object (used by x-title) */
  function template(str, data) {
    if (!str) return '';
    return String(str).replace(/\{\{\s*([\w.-]+)\s*\}\}/g, function (all, key) {
      var v = data ? get(data, key) : undefined;
      return v === undefined || v === null ? '' : String(v);
    });
  }

  /* array -> one row per default entry; x-title renders each row title.
     x-inline: true keeps the items on one line (checkbox list, button row).
     default: [{ "ir1": 0 }, { "ir2": 0 }, ...]  (key = row name, value = initial value) */
  W.group = function (p, path, ctx, a) {
    var item = p.items || {}, entry = null;
    var list = isArr(p['default']) ? p['default'] : [];
    var tpl = item['x-title'] || p['x-title'] || '';
    var inline = p['x-inline'] === true;
    /* nested: sits inside a row that already carries the label and the key */
    var nested = a && a.key !== undefined;
    var html = '', cells = '';
    for (var i = 0; i < list.length; i++) {
      entry = list[i];
      var name = '', value;
      if (isObj(entry)) {
        var keys = [];
        each(entry, function (k) { keys.push(k); });
        if (keys.length === 1) { name = keys[0]; value = entry[name]; }
        else { name = entry.name || String(i + 1); value = entry.value; }
      } else {
        name = String(i + 1);
        value = entry;
      }
      var data = { name: name, value: value, index: i };
      var title = template(tpl, data) || name;
      var sub = path ? path + '[' + i + ']' : '[' + i + ']';
      var opts = { key: nested ? a.key : name, value: value, checked: value === true, title: title };
      var ctl = control(item, sub, ctx, opts);
      if (inline) {
        cells += item['x-format'] === 'button' ? ctl : '<label>' + ctl + esc(title) + '</label>';
      } else if (typeOf(item) === 'object') {
        html += objectHTML(item, name, sub, ctx, title, value);
      } else {
        html += '<row><label>' + esc(title) + '</label>' + ctl + '</row>';
      }
    }
    if (inline) {
      var fs = '<fieldset data-inline>' + cells + '</fieldset>';
      return nested ? fs : '<row><label>' + esc(p['title'] || '') + '</label>' + fs + '</row>';
    }
    return html;
  };

  /* --------------------------------------------- 4. dispatch + containers */

  /* type based widget, shared by control() and the inline button */
  function defaultControl(p, path, ctx, a) {
    var t = typeOf(p);
    if (t === 'boolean') return W.checkbox(p, path, ctx, a);
    if (t === 'array') return W.group(p, path, ctx, a);
    if (t === 'number' || t === 'integer') {
      return (p.minimum !== undefined && p.maximum !== undefined)
        ? W.range(p, path, ctx, a) : W.number(p, path, ctx, a);
    }
    return W.text(p, path, ctx, a);
  }

  function control(p, path, ctx, a) {
    if (p['x-template']) return computed(p, path, ctx);
    var xf = p['x-format'];
    if (xf && W[xf]) return W[xf](p, path, ctx, a);
    return defaultControl(p, path, ctx, a);
  }

  function computed(p, path, ctx) {
    ctx.watch.push({ path: path, tpl: String(p['x-template']), map: p['x-watch'] || {} });
    return inputHTML('text', path, p, { type: 'string' });
  }

  function rowHTML(p, name, path, req, ctx, noLabel, title, value) {
    var a = { required: req };
    if (value !== undefined) a.value = value;
    return '<row><label>' + (noLabel ? '' : esc(title === undefined ? labelOf(p) : title)) + '</label>' +
      control(p, path, ctx, a) + '</row>';
  }

  /* one property: object -> fieldset, repeated array -> many rows, else one row */
  function blockHTML(p, name, path, req, ctx, value) {
    if (typeOf(p) === 'object') return objectHTML(p, name, path, ctx, undefined, value);
    if (typeOf(p) === 'array' && !(p['x-format'] && W[p['x-format']])) return W.group(p, path, ctx);
    return rowHTML(p, name, path, req, ctx, false, undefined, value);
  }

  /* object -> fieldset (+legend only when it has a title) */
  function objectHTML(p, name, path, ctx, title, value) {
    var label = title === undefined ? p['title'] : title;
    var legend = label ? '<legend>' + esc(label) + '</legend>' : '';
    return '<fieldset>' + legend + fields(p, path, ctx, value) + '</fieldset>';
  }

  /* one property rendered as an accordion panel (details+summary) */
  function panelHTML(p, name, path, req, ctx, group, open, value) {
    var body = typeOf(p) === 'object'
      ? fields(p, path, ctx, value)
      : typeOf(p) === 'array' && !(p['x-format'] && W[p['x-format']])
        ? W.group(p, path, ctx)
        : rowHTML(p, name, path, req, ctx, true);
    return '<details' + (open ? ' open' : '') + attr({ name: group }) + '>' +
      '<summary>' + esc(labelOf(p)) + '</summary>' + body + '</details>';
  }

  /* properties + if/then/else of one object schema.
     x-format: accordion on this object turns its properties into panels. */
  function fields(p, path, ctx, vals) {
    var accordion = p['x-format'] === 'accordion';
    /* one group per form, so panels of different forms stay independent */
    var group = 'cjf-accordion-' + (ctx.uid || 0) + '-' + (path || 'root');
    var first = true;
    var html = '';

    each(p.properties || {}, function (name, sub) {
      /* type "null" is not rendered for now */
      if (typeOf(sub) === 'null') return;
      var subPath = path ? path + '.' + name : name;
      var req = has(p.required, name);
      if (sub['x-hidden'] === true) ctx.hidden.push(subPath);
      var val = vals && isObj(vals) && vals[name] !== undefined ? vals[name] : undefined;
      if (!accordion) {
        html += blockHTML(sub, name, subPath, req, ctx, val);
      } else {
        html += panelHTML(sub, name, subPath, req, ctx, group, first, val);
        first = false;
      }
    });

    if (p['if'] && (p['then'] || p['else'])) {
      html += '<div' + attr({ 'data-if': path, 'data-then': true }) + '>' +
        (p['then'] ? fields(p['then'], path, ctx) : '') + '</div>';
      html += '<div' + attr({ 'data-if': path, 'data-else': true }) + '>' +
        (p['else'] ? fields(p['else'], path, ctx) : '') + '</div>';
      ctx.conds.push({ path: path, test: p['if'] });
    }
    return html;
  }

  /* ------------------------------------------------ 5. values + behaviour */

  function val(path, root) {
    var el = q('[name="' + path + '"]', root);
    return el ? el.value : '';
  }

  /* x-hidden drops the key itself; its children attach to the parent key */
  function promote(name, hidden) {
    for (var again = true; again;) {
      again = false;
      for (var i = 0; i < hidden.length; i++) {
        var key = hidden[i];
        if (!key) continue;
        if (name === key) return null;
        if (name.indexOf(key + '.') === 0) {
          var parent = key.slice(0, key.lastIndexOf('.'));
          name = (parent ? parent + '.' : '') + name.slice(key.length + 1);
          again = true;
          break;
        }
      }
    }
    return name;
  }

  /* raw: internal reads (conditions, templates) keep the schema paths */
  function values(form, raw) {
    var out = {}, i, j, k;
    var hidden = raw ? [] : (form.getAttribute('data-hidden') || '').split(' ');

    var fields = qa('input, select, textarea', form);
    for (i = 0; i < fields.length; i++) {
      var el = fields[i], name = el.name, type = el.getAttribute('data-type');
      if (!name || el.disabled || el.type === 'file') continue;
      if (!raw) { name = promote(name, hidden); if (!name) continue; }
      if (el.type === 'checkbox' || el.type === 'radio') {
        if (el.type === 'radio') {
          if (el.checked) set(out, name, cast(el.value, type));
        } else {
          set(out, name, el.checked);
        }
        continue;
      }
      set(out, name, cast(el.value, type));
    }

    return out;
  }

  /* public: what the form submits (x-hidden keys are dropped) */
  function collect(form) { return values(form, false); }

  /* minimal JSON Schema test, enough for if/then/else */
  function match(value, s) {
    if (!s || typeof s !== 'object') return true;
    var i;
    if (s['const'] !== undefined) return value === s['const'];
    if (s.enum) return has(s.enum, value);
    if (s.type && !isType(value, s.type)) return false;
    if (s.properties && isObj(value)) {
      var keys = s.properties;
      for (var key in keys) {
        if (keys.hasOwnProperty(key) && value[key] !== undefined && !match(value[key], keys[key])) return false;
      }
    }
    if (s.required) {
      for (i = 0; i < s.required.length; i++) {
        if (!value || value[s.required[i]] === undefined) return false;
      }
    }
    if (s.minimum !== undefined && !(value >= s.minimum)) return false;
    if (s.maximum !== undefined && !(value <= s.maximum)) return false;
    if (s.minLength !== undefined && !(value && value.length >= s.minLength)) return false;
    if (s.maxLength !== undefined && !(value && value.length <= s.maxLength)) return false;
    if (s.pattern && !new RegExp(s.pattern).test(value)) return false;
    return true;
  }

  function isType(value, type) {
    if (type === 'null') return value === null;
    if (type === 'array') return isArr(value);
    if (type === 'object') return isObj(value);
    if (type === 'integer') return typeof value === 'number' && value % 1 === 0;
    return typeof value === type;
  }

  function show(el, visible) {
    if (!el) return;
    if (visible) el.removeAttribute('hidden');
    else el.setAttribute('hidden', '');
    var list = qa('input, select, textarea', el);
    for (var i = 0; i < list.length; i++) list[i].disabled = !visible;
  }

  function refresh(form, ctx) {
    var i;

    for (i = 0; i < ctx.watch.length; i++) {
      var w = ctx.watch[i], el = q('[name="' + w.path + '"]', form);
      if (!el) continue;
      el.value = w.tpl.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, function (all, key) {
        return w.map[key] ? val(w.map[key], form) : all;
      });
    }

    if (!ctx.conds.length) return;
    var data = values(form, true);
    for (i = 0; i < ctx.conds.length; i++) {
      var cond = ctx.conds[i];
      var ok = match(get(data, cond.path), cond.test);
      var thenEl = q('[data-if="' + cond.path + '"][data-then]', form);
      var elseEl = q('[data-if="' + cond.path + '"][data-else]', form);
      if (thenEl) show(thenEl, ok);
      if (elseEl) show(elseEl, !ok);
    }
  }

  /* a button posts only its own pair: { "<property name>": <value> } */
  function buttonBody(btn) {
    var raw = btn.getAttribute('data-value');
    var value;
    if (raw === null) {
      var input = btn.parentNode.querySelector('input, select, textarea');
      value = input ? cast(input.value, btn.getAttribute('data-type')) : true;
    } else {
      value = cast(raw, btn.getAttribute('data-type'));
    }
    var body = {};
    body[btn.getAttribute('data-key') || 'value'] = value;
    return JSON.stringify(body);
  }

  /* POST the button pair; the response is not rendered (see the network tab) */
  function send(form, ctx, btn) {
    var url = btn.getAttribute('data-api');
    var body = buttonBody(btn);
    var done = function () { btn.disabled = false; };
    btn.disabled = true;
    if (ctx.request) { ctx.request(url, body, done); return; }
    var xhr = new win.XMLHttpRequest();
    xhr.open('POST', url, true);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.onreadystatechange = function () {
      if (xhr.readyState === 4) done();
    };
    xhr.send(body);
  }

  function bind(form, ctx, pre, options) {
    form.addEventListener('submit', function (evt) {
      var values = collect(form);
      if (evt && evt.preventDefault) evt.preventDefault();
      pre.removeAttribute('hidden');
      pre.textContent = JSON.stringify(values, null, 2);
      if (options && options.onSubmit) options.onSubmit(values, form);
    }, false);

    form.addEventListener('click', function (evt) {
      var el = evt.target;
      if (!el.getAttribute) return;

      var api = el.getAttribute('data-api');
      if (api) { send(form, ctx, el); return; }
    }, false);

    form.addEventListener('input', function () { refresh(form, ctx); }, false);
    form.addEventListener('change', function () { refresh(form, ctx); }, false);
    form.addEventListener('reset', function () {
      win.setTimeout(function () { refresh(form, ctx); }, 0);
    }, false);

    /* exclusive accordion: opening one panel closes the others of its group.
       "toggle" does not bubble, hence the capture listener; this also covers
       browsers without support for the details[name] attribute. */
    form.addEventListener('toggle', function (evt) {
      var el = evt.target;
      if (!el || el.tagName !== 'DETAILS' || !el.open) return;
      var name = el.getAttribute('name');
      if (!name) return;
      var group = qa('details[name="' + name + '"]', form);
      for (var i = 0; i < group.length; i++) {
        if (group[i] !== el) group[i].open = false;
      }
    }, true);
  }

  /* ------------------------------------------------- 6. page chrome + style */

  var ICON_MENU = '<svg viewBox="0 0 24 24"><path d="M3 6h18M3 12h18M3 18h18"/></svg>';
  var ICON_SUN = '<svg class="sun" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/>' +
    '<path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2' +
    'M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
  var ICON_MOON = '<svg class="moon" viewBox="0 0 24 24"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';

  /* moved here from index.html <style> + header.html <style> */
  var CSS = [
    /* page layout: header / main / footer share one content column */
    'body>main,body>header,body>footer{box-sizing:border-box;width:100%;max-width:none;margin:0 auto;padding:0 16px}',
    '@media (min-width:576px){body>main,body>header,body>footer{width:min(100% - 32px,540px)}}',
    '@media (min-width:768px){body>main,body>header,body>footer{width:min(100% - 48px,720px)}}',
    '@media (min-width:1024px){body>main,body>header,body>footer{width:min(50%,2048px)}}',
    /* one property per row */
    'row{display:grid;grid-template-columns:var(--cjf-cols,1fr 2fr);column-gap:16px;margin:4px 0 4px;align-items:center}',
    /* form actions live outside the rows, so they span the whole form */
    '[data-actions]{display:flex;flex-direction:column;gap:.5rem;margin:.5rem 0}',
    '[data-actions]>input{width:100%}',
    'row>label,row>input,row>select,row>div{min-width:0;box-sizing:border-box}',
    'row>label{display:grid;grid-auto-flow:column;justify-content:end;align-items:center}',
    'row>div{overflow-x:auto}',
    'form[data-layout=stacked] row{display:block}',
    'form[data-layout=stacked] row>label{display:block;text-align:left;margin-bottom:4px}',
    'fieldset[data-inline]{display:flex;flex-wrap:wrap;gap:.5em 1.25em}',
    'fieldset legend{font-weight:600}',
    /* header: sticky, same content column as main */
    'body>header{position:sticky;top:0;z-index:9;height:56px;display:grid;' +
      'grid-template-columns:1fr auto 1fr;align-items:center;padding:0 6px;' +
      'background:var(--pico-background-color,Canvas);' +
      'border-bottom:1px solid var(--pico-muted-border-color,GrayText)}',
    'body>main{padding-top:12px}',
    '#cjf-menu{justify-self:start}',
    '#cjf-title{justify-self:center;font-weight:600;white-space:nowrap;' +
      'overflow:hidden;text-overflow:ellipsis}',
    '#cjf-theme{justify-self:end}',
    '.ico{display:flex;align-items:center;justify-content:center;width:auto;' +
      'padding:8px;border:0;background:none;color:inherit;cursor:pointer}',
    '.ico svg{width:24px;height:24px;stroke:currentColor;stroke-width:2;fill:none;' +
      'stroke-linecap:round;stroke-linejoin:round}',
    /* day / night icons */
    '.moon{display:none}',
    'html[data-t=dark] .moon,html[data-theme=dark] .moon{display:block}',
    'html[data-t=dark] .sun,html[data-theme=dark] .sun{display:none}',
    /* dropdown menu, anchored to the header's left edge */
    'nav{position:absolute;top:100%;left:0;z-index:9;display:none;' +
      'background:var(--pico-background-color,Canvas);' +
      'border:1px solid var(--pico-muted-border-color,GrayText);border-top:0;' +
      'border-radius:0 0 10px 0;overflow:hidden}',
    'nav.open{display:block}',
    'nav button{display:block;width:100%;padding:12px 32px;border:0;background:none;' +
      'color:inherit;font:inherit;text-align:left;cursor:pointer}',
    'nav button:hover{background:var(--pico-secondary-background,ButtonFace)}'
  ].join('\n');

  function injectStyle() {
    if (q('#cjf-style')) return;
    var style = doc.createElement('style');
    style.id = 'cjf-style';
    style.appendChild(doc.createTextNode(CSS));
    (doc.head || doc.documentElement).appendChild(style);
  }

  /* show one form by its id, hide the others, and put its title in the header */
  function showForm(root, id) {
    var forms = qa('form', root), title = '';
    for (var i = 0; i < forms.length; i++) {
      var on = forms[i].id === id;
      forms[i].style.display = on ? '' : 'none';
      if (on) title = forms[i].getAttribute('data-title') || '';
    }
    var el = q('#cjf-title');
    if (el) el.textContent = title;
  }

  function chrome(root, list) {
    var parent = root.parentNode || doc.body;
    var old = q('#cjf-header');
    if (old && old.parentNode) old.parentNode.removeChild(old);
    old = q('#cjf-nav');
    if (old && old.parentNode) old.parentNode.removeChild(old);

    var header = doc.createElement('header');
    header.id = 'cjf-header';
    header.innerHTML =
      '<button class="ico" id="cjf-menu" aria-label="menu">' + ICON_MENU + '</button>' +
      '<span id="cjf-title">' + esc(list[0].title || '') + '</span>' +
      '<button class="ico" id="cjf-theme" aria-label="theme">' + ICON_SUN + ICON_MOON + '</button>';

    var nav = doc.createElement('nav');
    nav.id = 'cjf-nav';
    var items = '';
    for (var i = 0; i < list.length; i++) {
      items += '<button data-id="cjf-form-' + i + '">' + esc(list[i].title) + '</button>';
    }
    nav.innerHTML = items;

    /* nav lives inside the header so it lines up with the header's left edge */
    header.appendChild(nav);
    parent.insertBefore(header, root);

    q('#cjf-menu', header).onclick = function () {
      nav.className = nav.className === 'open' ? '' : 'open';
    };

    nav.onclick = function (evt) {
      var btn = evt.target;
      var id = btn.getAttribute ? btn.getAttribute('data-id') : null;
      if (!id) return;
      showForm(root, id);
      nav.className = '';
    };

    var rootEl = doc.documentElement;
    var media = win.matchMedia ? win.matchMedia('(prefers-color-scheme: dark)') : null;
    var isDark = function () {
      /* an explicit theme wins, then our own attribute, then the OS preference */
      var theme = rootEl.getAttribute('data-theme');
      if (theme) return theme === 'dark';
      if (rootEl.getAttribute('data-t') === 'dark') return true;
      return !!(media && media.matches);
    };
    /* show the right icon before the first click (the theme may follow the OS) */
    if (!rootEl.getAttribute('data-theme') && !rootEl.getAttribute('data-t') && media && media.matches) {
      rootEl.setAttribute('data-t', 'dark');
    }
    q('#cjf-theme', header).onclick = function () {
      var next = isDark() ? 'light' : 'dark';
      rootEl.setAttribute('data-theme', next);
      if (next === 'dark') rootEl.setAttribute('data-t', 'dark');
      else rootEl.removeAttribute('data-t');
    };
  }

  /* form layout: x-layout = aligned (default) | stacked | aligned-A-B */
  function formLayout(p) {
    var xf = p['x-layout'] || '';
    var m = /^aligned-(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)$/.exec(xf);
    if (xf === 'stacked') return { layout: 'stacked', cols: '' };
    if (m) return { layout: 'aligned', cols: m[1] + 'fr ' + m[2] + 'fr' };
    return { layout: 'aligned', cols: '' };
  }

  /* root object -> one form; root array -> one form per item schema */
  function formList(schema) {
    var list = [], i;
    if (typeOf(schema) === 'array') {
      var items = schema.prefixItems || (isArr(schema.items) ? schema.items : null) ||
        [schema.items || {}];
      for (i = 0; i < items.length; i++) {
        list.push({ title: items[i].title || 'Form ' + (i + 1), schema: items[i] });
      }
    } else {
      list.push({ title: schema.title || 'Form', schema: schema });
    }
    return list;
  }

  /* --------------------------------------------------------------- 7. api */

  /* form level action buttons: x-buttons: [{ type: "reset" | "submit", label }] */
  /* form level action buttons: x-buttons: [{ type: "reset" | "submit", label }].
     They are not rows: the action block spans the whole form width. */
  function actionsHTML(p) {
    var list = p['x-buttons'];
    if (!isArr(list)) return '';
    var html = '';
    for (var i = 0; i < list.length; i++) {
      var item = list[i] || {};
      var type = item.type === 'reset' ? 'reset' : 'submit';
      html += '<input type="' + type + '" value="' +
        esc(item.label || (type === 'reset' ? 'Default' : 'Submit')) + '">';
    }
    return '<div data-actions>' + html + '</div>';
  }


  function render(target, schema, options) {
    var root = typeof target === 'string' ? q(target) : target;
    if (!root) throw new Error('cjf: target not found');
    options = options || {};

    var list = formList(schema);
    injectStyle();
    chrome(root, list);

    if (schema.title) doc.title = schema.title;

    var html = '';
    var api = schema['x-api-addr'] || '';
    var ctxs = [], i;
    for (i = 0; i < list.length; i++) {
      var ctx = { watch: [], conds: [], hidden: [], request: options.request || null, uid: i, api: api };
      ctxs.push(ctx);
      var L = formLayout(list[i].schema);
      var st = [];
      if (i !== 0) st.push('display:none');
      if (L.cols) st.push('--cjf-cols:' + L.cols);
      html += '<form id="cjf-form-' + i + '" data-title="' + esc(list[i].title) + '"' +
        ' data-layout="' + L.layout + '"' +
        (st.length ? ' style="' + st.join(';') + '"' : '') + '>' +
        (typeOf(list[i].schema) === 'object' ? fields(list[i].schema, '', ctx) : '') +
        actionsHTML(list[i].schema) +
        '<pre hidden></pre>' +
      '</form>';
    }
    root.innerHTML = html;

    var forms = qa('form', root);
    for (i = 0; i < forms.length; i++) {
      if (ctxs[i].hidden.length) forms[i].setAttribute('data-hidden', ctxs[i].hidden.join(' '));
      bind(forms[i], ctxs[i], q('pre', forms[i]), options);
      refresh(forms[i], ctxs[i]);
    }
    return forms.length === 1 ? forms[0] : forms;
  }

  win.CJF = { render: render, collect: collect, version: '0.3.0' };
})(window, document);
