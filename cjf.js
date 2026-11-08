/*!
 * cjf.js v0.2 - classless JSON Form
 * JSON Schema 2020-12 -> native HTML5 widgets. Browser only, zero dependency, ES5.
 *
 *   CJF.render(target, schema[, options])  -> <form>   options: { onSubmit, request }
 *   CJF.collect(form)                      -> plain object
 *
 * Widget selection follows mapping.md. UI hints (unknown to validators, safe):
 *   x-format   switch | select | range | button | radios | radios-inline |
 *              checkboxes-inline | table | accordion | color | file
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

  function choices(type, inline) {
    return function (p, path, ctx, a) {
      var opts = options(p), current = p['default'], html = '', i;
      for (i = 0; i < opts.length; i++) {
        html += '<label>' + inputHTML(type, path, p, {
          id: false,
          value: opts[i].v,
          checked: String(opts[i].v) === String(current),
          required: a && a.required && i === 0
        }) + esc(opts[i].l) + '</label>';
      }
      return '<fieldset' + attr({ 'data-inline': inline }) + '>' + html + '</fieldset>';
    };
  }

  function checkboxList(inline) {
    return function (p, path, ctx, a) {
      var item = p.items || {}, itemType = typeOf(item), opts = options(p);
      var defaults = isArr(p['default']) ? p['default'] : [], html = '';
      for (var i = 0; i < opts.length; i++) {
        html += '<label>' + inputHTML('checkbox', path, p, {
          id: false,
          type: 'array',
          item: itemType,
          value: opts[i].v,
          checked: has(defaults, opts[i].v)
        }) + esc(opts[i].l) + '</label>';
      }
      return '<fieldset' + attr({ 'data-inline': inline }) + '>' + html + '</fieldset>';
    };
  }

  var W = {
    text: typed('text'),
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
    radios: choices('radio', false),
    'radios-inline': choices('radio', true),
    checkboxes: checkboxList(false),
    'checkboxes-inline': checkboxList(true)
  };

  W['switch'] = function (p, path, ctx, a) {
    return inputHTML('checkbox', path, p, { role: 'switch', checked: a && a.checked });
  };

  /* x-format alias: "date-time" picks the same widget as format: "date-time" */
  W['date-time'] = W['datetime-local'];

  /* button widget: POST the JSON form values to x-api-addr */
  W.button = function (p, path) {
    return '<div>' + button(p['x-label'] || 'Submit', {
      'data-api': p['x-api-addr'],
      'data-path': path
    }) + '<output></output></div>';
  };

  /* null: no interactive element, only a placeholder cell */
  W['null'] = function (p, path) {
    return '<output' + attr({ 'data-null': path }) + '></output>';
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

  function control(p, path, ctx, a) {
    var xf = p['x-format'];
    if (p['x-template']) return computed(p, path, ctx);
    if (xf && W[xf]) return W[xf](p, path, ctx, a);

    var t = typeOf(p);
    if (t === 'boolean') return W.checkbox(p, path, ctx, a);
    if (t === 'array') return W.checkboxes(p, path, ctx, a);
    if (t === 'null') return W['null'](p, path, ctx, a);
    if (options(p).length) return W.select(p, path, ctx, a);
    if (t === 'number' || t === 'integer') {
      return (p.minimum !== undefined && p.maximum !== undefined)
        ? W.range(p, path, ctx, a) : W.number(p, path, ctx, a);
    }
    return W.text(p, path, ctx, a);
  }

  function computed(p, path, ctx) {
    ctx.watch.push({ path: path, tpl: String(p['x-template']), map: p['x-watch'] || {} });
    return inputHTML('text', path, p, { type: 'string' });
  }

  function rowHTML(p, name, path, req, ctx, noLabel) {
    return '<row><label>' + (noLabel ? '' : esc(titleOf(p, name))) + '</label>' +
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
    var group = 'cjf-accordion-' + (path || 'root');
    var first = true;
    var html = '';

    each(p.properties || {}, function (name, sub) {
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

    var nulls = qa('[data-null]', form);
    for (i = 0; i < nulls.length; i++) set(out, nulls[i].getAttribute('data-null'), null);

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

  function send(form, ctx, btn) {
    var url = btn.getAttribute('data-api');
    var out = btn.parentNode.querySelector('output');
    var body = JSON.stringify(collect(form));
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

  /* --------------------------------------------------------------- 6. api */

  function render(target, schema, options) {
    var root = typeof target === 'string' ? q(target) : target;
    if (!root) throw new Error('cjf: target not found');
    options = options || {};

    var ctx = { watch: [], conds: [], tables: {}, request: options.request || null };

    root.innerHTML = '<h2>' + esc(schema.title || 'Form') + '</h2>' +
      '<form>' + fields(schema, '', ctx) +
        '<row><label></label><input type="reset" value="Default"></row>' +
        '<row><label></label><input type="submit" value="Submit"></row>' +
      '</form>' +
      '<pre hidden></pre>';

    var form = q('form', root), pre = q('pre', root);
    if (!form || !pre) throw new Error('cjf: render failed');

    bind(form, ctx, pre, options);
    refresh(form, ctx);
    return form;
  }

  win.CJF = { render: render, collect: collect, version: '0.2.0' };
})(window, document);
