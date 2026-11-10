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
 *   x-format   switch | select | range | button | radios | table | accordion |
 *              password | date | time | datetime-local | email | uri | color | file
 *   x-inline   true lays radios / checkboxes out on one line and puts the button
 *              next to the input (a button without x-inline replaces the input)
 *   x-enum     option labels: array parallel to enum, or { "value": "Label" }
 *   x-label    label of an x-format:button
 *   x-api-addr POST target of an x-format:button (JSON body = form values)
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

  function humanize(s) {
    s = String(s || '').replace(/[_-]+/g, ' ');
    return s.charAt(0).toUpperCase() + s.slice(1);
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

  function titleOf(p, name) { return p.title || humanize(name); }

  /* --------------------------------------------------- 2. shared html pieces */

  /* enum + x-enum -> [{ v: value, l: label }] ; also serves boolean true/false
     and array items (items.enum). Used by select, radios, checkboxes, table. */
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

  /* one button builder: api buttons, table "add row", table "remove" */
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
      name: a.key ? null : path,
      'data-type': t,
      'data-key': a.key || null,
      'data-item': a.item || null,
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

  /* one select builder: string enum, number enum, boolean, table cells */
  function selectHTML(path, p, a) {
    a = a || {};
    var t = typeOf(p), opts = options(p);
    var current = a.value !== undefined ? a.value : p['default'];
    var html = '<select' + attr({
      id: a.key ? null : idOf(path),
      name: a.key ? null : path,
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

  /* one option per <label>, laid out inline when x-inline is true.
     Shared by radios (single value) and checkboxes (array value). */
  function optionGroup(p, type, path, a, isArrayGroup) {
    var opts = options(p), current = p['default'];
    var defaults = isArr(current) ? current : [];
    var itemType = typeOf(p.items || {});
    var html = '';
    for (var i = 0; i < opts.length; i++) {
      html += '<label>' + inputHTML(type, path, p, isArrayGroup ? {
        id: false, type: 'array', item: itemType,
        value: opts[i].v, checked: has(defaults, opts[i].v)
      } : {
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
    radios: function (p, path, ctx, a) { return optionGroup(p, 'radio', path, a, false); },
    checkboxes: function (p, path, ctx, a) { return optionGroup(p, 'checkbox', path, a, true); }
  };

  W['switch'] = function (p, path, ctx, a) {
    return inputHTML('checkbox', path, p, { role: 'switch', checked: a && a.checked });
  };

  /* api address: field level wins, the root schema is the default */
  function apiAddr(p, ctx) {
    return p['x-api-addr'] || (ctx && ctx.api) || '';
  }

  /* a button posts { "<property name>": <value> } */
  function apiButton(p, path, ctx) {
    return button(p['x-label'] || 'Submit', {
      'data-api': apiAddr(p, ctx),
      'data-key': path.split('.').pop(),
      'data-value': (p['x-inline'] === true || p['default'] === undefined)
        ? null : String(p['default']),
      'data-type': typeOf(p)
    });
  }

  /* buttons widget: one button per enum value, inline when x-inline */
  W.buttons = function (p, path, ctx) {
    var opts = options(p), key = path.split('.').pop(), type = typeOf(p), html = '';
    for (var i = 0; i < opts.length; i++) {
      html += button(opts[i].l, {
        'data-api': apiAddr(p, ctx),
        'data-key': key,
        'data-value': String(opts[i].v),
        'data-type': type
      });
    }
    return '<fieldset' + attr({ 'data-inline': p['x-inline'] === true }) + '>' +
      html + '<output></output></fieldset>';
  };

  /* button widget: replaces the control, or sits next to it when x-inline */
  W.button = function (p, path, ctx, a) {
    var btn = apiButton(p, path, ctx);
    if (p['x-inline'] === true) {
      return '<div data-inline-group>' + defaultControl(p, path, ctx, a) +
        btn + '<output></output></div>';
    }
    return '<div>' + btn + '<output></output></div>';
  };

  /* array + x-format: table */
  W.table = function (p, path, ctx) {
    var item = p.items || {}, cols = [];
    each(item.properties || {}, function (key) { cols.push(key); });

    var head = '', blank = '', i;
    for (i = 0; i < cols.length; i++) {
      head += '<th>' + esc(titleOf(item.properties[cols[i]], cols[i])) + '</th>';
      blank += '<td>' + control(item.properties[cols[i]], path, ctx, { key: cols[i] }) + '</td>';
    }
    blank += '<td>' + button('\u00d7', { 'data-del': 1, 'aria-label': 'Remove' }) + '</td>';
    ctx.tables[path] = '<tr>' + blank + '</tr>';

    var rows = '', list = p['default'];
    if (isArr(list)) {
      for (i = 0; i < list.length; i++) {
        rows += '<tr>';
        for (var j = 0; j < cols.length; j++) {
          rows += '<td>' + control(item.properties[cols[j]], path, ctx, {
            key: cols[j],
            value: list[i][cols[j]]
          }) + '</td>';
        }
        rows += '<td>' + button('\u00d7', { 'data-del': 1, 'aria-label': 'Remove' }) + '</td></tr>';
      }
    }

    return '<div><table data-table="' + esc(path) + '">' +
        '<thead><tr>' + head + '<th></th></tr></thead>' +
        '<tbody>' + rows + '</tbody>' +
      '</table>' + button('Add row', { 'data-add': path }) + '</div>';
  };

  /* --------------------------------------------- 4. dispatch + containers */

  /* type based widget, shared by control() and the inline button */
  function defaultControl(p, path, ctx, a) {
    var t = typeOf(p);
    if (t === 'boolean') return W.checkbox(p, path, ctx, a);
    if (t === 'array') return W.checkboxes(p, path, ctx, a);
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

  function rowHTML(p, name, path, req, ctx, noLabel) {
    /* a table needs the full row width, so it gets its own stacked layout */
    var table = p['x-format'] === 'table' ? ' data-table-row' : '';
    return '<row' + table + '><label>' + (noLabel ? '' : esc(titleOf(p, name))) + '</label>' +
      control(p, path, ctx, { required: req }) + '</row>';
  }

  /* object -> fieldset+legend */
  function objectHTML(p, name, path, ctx) {
    return '<fieldset><legend>' + esc(titleOf(p, name)) + '</legend>' +
      fields(p, path, ctx) + '</fieldset>';
  }

  /* one property rendered as an accordion panel (details+summary) */
  function panelHTML(p, name, path, req, ctx, group, open) {
    var body = typeOf(p) === 'object'
      ? fields(p, path, ctx)
      : rowHTML(p, name, path, req, ctx, true);
    return '<details' + (open ? ' open' : '') + attr({ name: group }) + '>' +
      '<summary>' + esc(titleOf(p, name)) + '</summary>' + body + '</details>';
  }

  /* properties + if/then/else of one object schema.
     x-format: accordion on this object turns its properties into panels. */
  function fields(p, path, ctx) {
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
      if (!accordion) {
        html += typeOf(sub) === 'object'
          ? objectHTML(sub, name, subPath, ctx)
          : rowHTML(sub, name, subPath, req, ctx);
      } else {
        html += panelHTML(sub, name, subPath, req, ctx, group, first);
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

  function push(obj, path, value) {
    var list = get(obj, path);
    if (!isArr(list)) { list = []; set(obj, path, list); }
    list.push(value);
  }

  function collect(form) {
    var out = {}, i, j, k;

    var fields = qa('input, select, textarea', form);
    for (i = 0; i < fields.length; i++) {
      var el = fields[i], name = el.name, type = el.getAttribute('data-type');
      if (!name || el.disabled || el.type === 'file') continue;
      if (el.type === 'checkbox' || el.type === 'radio') {
        if (type === 'array') {
          if (el.checked) push(out, name, cast(el.value, el.getAttribute('data-item')));
        } else if (el.type === 'radio') {
          if (el.checked) set(out, name, cast(el.value, type));
        } else {
          set(out, name, el.checked);
        }
        continue;
      }
      if (el.value === '') continue;
      set(out, name, cast(el.value, type));
    }

    var tables = qa('[data-table]', form);
    for (i = 0; i < tables.length; i++) {
      var body = tables[i].getElementsByTagName('tbody')[0], items = [];
      for (j = 0; body && j < body.rows.length; j++) {
        var cells = body.rows[j].querySelectorAll('[data-key]'), row = {};
        for (k = 0; k < cells.length; k++) {
          row[cells[k].getAttribute('data-key')] =
            cast(cells[k].value, cells[k].getAttribute('data-type'));
        }
        items.push(row);
      }
      set(out, tables[i].getAttribute('data-table'), items);
    }
    return out;
  }

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
    var values = collect(form);
    for (i = 0; i < ctx.conds.length; i++) {
      var cond = ctx.conds[i];
      var ok = match(get(values, cond.path), cond.test);
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

  function send(form, ctx, btn) {
    var url = btn.getAttribute('data-api');
    var out = btn.parentNode.querySelector('output');
    var body = buttonBody(btn);
    var done = function (text) {
      btn.disabled = false;
      if (out) out.textContent = text;
    };
    btn.disabled = true;
    if (ctx.request) { ctx.request(url, body, done); return; }
    var xhr = new win.XMLHttpRequest();
    xhr.open('POST', url, true);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.onreadystatechange = function () {
      if (xhr.readyState !== 4) return;
      done(xhr.status >= 200 && xhr.status < 300 ? xhr.responseText : 'HTTP ' + xhr.status);
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

      var add = el.getAttribute('data-add');
      if (add) {
        var table = q('[data-table="' + add + '"]', form);
        if (table) table.getElementsByTagName('tbody')[0].insertAdjacentHTML('beforeend', ctx.tables[add]);
        return;
      }

      if (el.getAttribute('data-del') !== null) {
        var tr = el;
        while (tr && tr.tagName !== 'TR') tr = tr.parentNode;
        if (tr && tr.parentNode) tr.parentNode.removeChild(tr);
      }
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
    'row{display:grid;grid-template-columns:1fr 2fr;column-gap:16px;margin-bottom:8px;align-items:center}',
    'row>label,row>input,row>select,row>div{min-width:0;box-sizing:border-box}',
    'row>label{display:grid;grid-auto-flow:column;justify-content:end;align-items:center}',
    /* wide tables scroll inside their cell instead of squeezing every column */
    'row>div{overflow-x:auto}',
    'row table{min-width:max-content}',
    'row th,row td{white-space:nowrap}',
    'row[data-table-row]{display:block}',
    'row[data-table-row]>label{display:block;text-align:left;margin-bottom:4px}',
    /* x-inline: control and button on one line */
    '[data-inline-group]{display:flex;align-items:center;gap:8px}',
    '[data-inline-group]>input,[data-inline-group]>select{flex:1 1 auto;min-width:0}',
    '[data-inline-group]>button[data-api]{flex:0 0 auto;width:auto}',
    '[data-inline-group]>output{flex:0 0 auto;font-size:.85rem}',
    'fieldset[data-inline]{display:flex;flex-wrap:wrap;gap:.5em 1.25em}',
    'row table button[type=button],row button[data-add]{' +
      'width:auto;padding:.25rem .6rem;font-size:.9rem}',
    'fieldset legend{font-weight:600}',
    /* header: sticky, same content column as main */
    'body>header{position:sticky;top:0;z-index:9;height:56px;display:grid;' +
      'grid-template-columns:1fr auto 1fr;align-items:center;padding:0 6px;' +
      'background:var(--pico-background-color,#fff);' +
      'border-bottom:1px solid var(--pico-muted-border-color,#ddd)}',
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
    'html[data-t=dark] .moon{display:block}',
    'html[data-t=dark] .sun{display:none}',
    /* dropdown menu, anchored to the header's left edge */
    'nav{position:absolute;top:100%;left:0;z-index:9;display:none;' +
      'background:var(--pico-background-color,#fff);' +
      'border:1px solid var(--pico-muted-border-color,#ddd);border-top:0;' +
      'border-radius:0 0 10px 0;overflow:hidden}',
    'nav.open{display:block}',
    'nav button{display:block;width:100%;padding:12px 32px;border:0;background:none;' +
      'color:inherit;font:inherit;text-align:left;cursor:pointer}',
    'nav button:hover{background:var(--pico-secondary-background,#f0f0f0)}'
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

    q('#cjf-theme', header).onclick = function () {
      var html = doc.documentElement;
      if (html.getAttribute('data-t') === 'dark') {
        html.removeAttribute('data-t');
        html.setAttribute('data-theme', 'light');
      } else {
        html.setAttribute('data-t', 'dark');
        html.setAttribute('data-theme', 'dark');
      }
    };
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
      var ctx = { watch: [], conds: [], tables: {}, request: options.request || null, uid: i, api: api };
      ctxs.push(ctx);
      html += '<form id="cjf-form-' + i + '" data-title="' + esc(list[i].title) + '"' +
        (i === 0 ? '' : ' style="display:none"') + '>' +
        (typeOf(list[i].schema) === 'object' ? fields(list[i].schema, '', ctx) : '') +
        '<row><label></label><input type="reset" value="Default"></row>' +
        '<row><label></label><input type="submit" value="Submit"></row>' +
        '<pre hidden></pre>' +
      '</form>';
    }
    root.innerHTML = html;

    var forms = qa('form', root);
    for (i = 0; i < forms.length; i++) {
      bind(forms[i], ctxs[i], q('pre', forms[i]), options);
      refresh(forms[i], ctxs[i]);
    }
    return forms.length === 1 ? forms[0] : forms;
  }

  win.CJF = { render: render, collect: collect, version: '0.3.0' };
})(window, document);
