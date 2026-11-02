/*!
 * cjf.js - classless JSON Form (minimal skeleton)
 * JSON Schema 2020-12 -> plain HTML form.  Browser only, zero dependencies, ES5.
 *
 *   CJF.render(target, schema[, options])  -> <form>     // target: element or selector
 *   CJF.collect(form)                      -> plain object
 *
 * UI hints (all optional, ignored by JSON Schema validators):
 *   x-widget   "color" | "switch" | "table"
 *   x-options  widget options, e.g. { "flatpickr": {} }   (skeleton: kept, not used)
 *   x-template "{{city}}, {{state}}"                       computed read-only field
 *   x-watch    { "city": "location.city", ... }            data paths feeding the template
 */
(function (win, doc) {
  'use strict';

  /* ------------------------------------------------------------------ helpers */

  function q(sel, root) { return (root || doc).querySelector(sel); }
  function qa(sel, root) { return (root || doc).querySelectorAll(sel); }

  function each(obj, fn) {
    for (var key in obj) {
      if (obj.hasOwnProperty(key)) fn(key, obj[key]);
    }
  }

  function isArr(v) { return Object.prototype.toString.call(v) === '[object Array]'; }
  function isObj(v) { return !!v && typeof v === 'object' && !isArr(v); }

  function has(list, v) {
    for (var i = 0; list && i < list.length; i++) {
      if (list[i] === v) return true;
    }
    return false;
  }

  function esc(v) {
    return (v === null || v === undefined ? '' : String(v))
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function humanize(s) {
    s = String(s).replace(/[_-]+/g, ' ');
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  function idOf(path) { return 'cjf-' + path.replace(/[^A-Za-z0-9]+/g, '-'); }
  function widget(prop) { return prop['x-widget'] || prop.format || ''; }

  /* computed fields and blank table rows, reset on every render (one form/page) */
  var WATCH = [];
  var TABLE = {};

  /* ------------------------------------------------------------------ widgets */

  var FORMAT = { 'date': 'date', 'time': 'time', 'date-time': 'datetime-local',
    'email': 'email', 'uri': 'url', 'hostname': 'text', 'tel': 'tel' };

  function input(path, prop, req) {
    var type = widget(prop) === 'color' ? 'color' :
      (prop.type === 'integer' || prop.type === 'number' ? 'number' : (FORMAT[prop.format] || 'text'));
    var html = '<input type="' + type + '" id="' + idOf(path) + '" name="' + esc(path) + '"' +
      ' data-type="' + esc(prop.type) + '"';
    if (req) html += ' required';
    if (prop.minLength) html += ' minlength="' + prop.minLength + '"';
    if (prop.maxLength) html += ' maxlength="' + prop.maxLength + '"';
    if (prop.pattern) html += ' pattern="' + esc(prop.pattern) + '"';
    if (prop.minimum !== undefined) html += ' min="' + prop.minimum + '"';
    if (prop.maximum !== undefined) html += ' max="' + prop.maximum + '"';
    if (prop.type === 'integer' || prop.type === 'number') {
      html += ' step="' + (prop.multipleOf || (prop.type === 'integer' ? 1 : 'any')) + '"';
    }
    html += ' value="' + esc(prop['default']) + '"';
    if (prop.description) html += ' title="' + esc(prop.description) + '"';
    return html + '>';
  }

  function checkbox(path, prop) {
    /* a boolean is one checkbox; "required" is not enforceable the HTML way */
    return '<input type="checkbox" role="switch" id="' + idOf(path) + '" name="' + esc(path) + '"' +
      ' data-type="boolean"' + (prop['default'] === true ? ' checked' : '') + '>';
  }

  function select(path, prop, req, key) {
    var html = '<select id="' + (key ? '' : idOf(path)) + '"' +
      (key ? ' data-key="' + esc(key) + '"' : ' name="' + esc(path) + '"') +
      ' data-type="' + esc(prop.type || 'string') + '"' + (req ? ' required' : '') + '>';
    if (!key && prop['default'] === undefined) html += '<option value=""></option>';
    for (var i = 0; i < prop.enum.length; i++) {
      var v = prop.enum[i];
      html += '<option' + (key ? '' : ' value="' + esc(v) + '"') +
        (prop['default'] === v ? ' selected' : '') + '>' + esc(v) + '</option>';
    }
    return html + '</select>';
  }

  function computed(path, prop) {
    WATCH.push({ path: path, tpl: String(prop['x-template']), map: prop['x-watch'] || {} });
    return '<input type="text" id="' + idOf(path) + '" name="' + esc(path) + '" data-type="string"' +
      ' readonly' + (prop.description ? ' title="' + esc(prop.description) + '"' : '') + '>';
  }

  function tableCell(key, prop, value) {
    if (prop.enum) {
      var html = '<select data-key="' + esc(key) + '">';
      if (value === undefined) html += '<option value=""></option>';
      for (var i = 0; i < prop.enum.length; i++) {
        html += '<option' + (prop.enum[i] === value ? ' selected' : '') + '>' + esc(prop.enum[i]) + '</option>';
      }
      return html + '</select>';
    }
    return '<input type="' + (prop.type === 'integer' || prop.type === 'number' ? 'number' : 'text') +
      '" data-key="' + esc(key) + '" data-type="' + esc(prop.type || 'string') +
      '" value="' + esc(value) + '">';
  }

  function table(path, prop, label) {
    var item = prop.items || {};
    var cols = [];
    each(item.properties || {}, function (key) { cols.push(key); });

    var head = '', blank = '';
    for (var i = 0; i < cols.length; i++) {
      var p = item.properties[cols[i]];
      head += '<th>' + esc(p.title || humanize(cols[i])) + '</th>';
      blank += '<td>' + tableCell(cols[i], p) + '</td>';
    }
    blank += '<td><button type="button" data-del="1" aria-label="Remove">&times;</button></td>';
    TABLE[path] = '<tr>' + blank + '</tr>';

    var rows = '', def = prop['default'];
    if (isArr(def)) {
      for (i = 0; i < def.length; i++) {
        rows += '<tr>';
        for (var j = 0; j < cols.length; j++) {
          rows += '<td>' + tableCell(cols[j], item.properties[cols[j]], def[i][cols[j]]) + '</td>';
        }
        rows += '<td><button type="button" data-del="1" aria-label="Remove">&times;</button></td></tr>';
      }
    }

    return '<row><label>' + esc(label) + '</label><div>' +
      '<table data-table="' + esc(path) + '">' +
        '<thead><tr>' + head + '<th></th></tr></thead>' +
        '<tbody>' + rows + '</tbody>' +
      '</table>' +
      '<button type="button" data-add="' + esc(path) + '">Add row</button>' +
      '</div></row>';
  }

  function row(path, prop, req, label) {
    var w = widget(prop), ctl;
    if (w === 'table') return table(path, prop, label);
    if (prop['x-template']) ctl = computed(path, prop);
    else if (w === 'switch' || prop.type === 'boolean') ctl = checkbox(path, prop);
    else if (prop.enum) ctl = select(path, prop, req);
    else ctl = input(path, prop, req);
    return '<row><label for="' + idOf(path) + '">' + esc(label) + '</label>' + ctl + '</row>';
  }

  /* walk the schema; nested objects are flattened, labels keep the parent title */
  function walk(props, reqList, base, prefix, rows) {
    each(props || {}, function (name, prop) {
      var path = base ? base + '.' + name : name;
      var label = prop.title || humanize(name);
      if (isObj(prop.properties)) {
        walk(prop.properties, prop.required, path, label + ': ', rows);
      } else if (prop.type === 'array' && widget(prop) !== 'table') {
        /* skeleton: only "table" arrays are rendered */
      } else {
        rows.push(row(path, prop, has(reqList, name), prefix + label));
      }
    });
  }

  /* ------------------------------------------------------------------ values */

  function set(obj, path, value) {
    var parts = [], re = /([^.[\]]+)|\[([0-9]+)\]/g, m;
    while ((m = re.exec(String(path)))) {
      parts.push(m[2] === undefined ? m[1] : parseInt(m[2], 10));
    }
    var o = obj;
    for (var i = 0; i < parts.length - 1; i++) {
      var key = parts[i], next = parts[i + 1];
      if (!o[key] || typeof o[key] !== 'object') o[key] = typeof next === 'number' ? [] : {};
      o = o[key];
    }
    if (parts.length) o[parts[parts.length - 1]] = value;
  }

  function val(path, root) {
    var el = q('[name="' + path + '"]', root);
    return el ? el.value : '';
  }

  function refresh(root) {
    for (var i = 0; i < WATCH.length; i++) {
      var w = WATCH[i], el = q('[name="' + w.path + '"]', root);
      if (!el) continue;
      el.value = w.tpl.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, function (all, key) {
        return w.map[key] ? val(w.map[key], root) : all;
      });
    }
  }

  function collect(form) {
    var out = {}, i, j, el, type;

    var fields = qa('[name]', form);
    for (i = 0; i < fields.length; i++) {
      el = fields[i];
      if (el.type === 'submit' || el.type === 'reset' || el.type === 'button') continue;
      type = el.getAttribute('data-type');
      if (type === 'boolean') { set(out, el.name, el.checked); continue; }
      if (el.value === '') continue;
      set(out, el.name, type === 'number' || type === 'integer' ? Number(el.value) : el.value);
    }

    var tables = qa('[data-table]', form);
    for (i = 0; i < tables.length; i++) {
      var body = tables[i].getElementsByTagName('tbody')[0], items = [];
      for (j = 0; body && j < body.rows.length; j++) {
        var cells = body.rows[j].querySelectorAll('[data-key]'), obj = {};
        for (var k = 0; k < cells.length; k++) {
          var cell = cells[k], cellType = cell.getAttribute('data-type');
          obj[cell.getAttribute('data-key')] =
            cellType === 'number' || cellType === 'integer' ? Number(cell.value) : cell.value;
        }
        items.push(obj);
      }
      set(out, tables[i].getAttribute('data-table'), items);
    }
    return out;
  }

  /* ------------------------------------------------------------------ render */

  function render(target, schema, options) {
    var root = typeof target === 'string' ? q(target) : target;
    if (!root) throw new Error('cjf: target not found');

    WATCH.length = 0;
    TABLE = {};

    var rows = [];
    walk(schema.properties, schema.required, '', '', rows);

    root.innerHTML = '<h2>' + esc(schema.title || 'Form') + '</h2>' +
      '<form class="pure-form pure-form-aligned">' + rows.join('') +
        '<row><label></label><input type="reset" value="Default"></row>' +
        '<row><label></label><input type="submit" value="Submit"></row>' +
      '</form>' +
      '<pre style="display:none"></pre>';

    var form = q('form', root), pre = q('pre', root);
    if (!form) throw new Error('cjf: form not rendered');

    form.addEventListener('submit', function (evt) {
      var values = collect(form);
      if (evt && evt.preventDefault) evt.preventDefault();
      pre.style.display = '';
      pre.innerHTML = esc(JSON.stringify(values, null, 2));
      if (options && options.onSubmit) options.onSubmit(values, form);
    }, false);

    form.addEventListener('click', function (evt) {
      var el = evt.target, path = el.getAttribute && el.getAttribute('data-add');
      if (path) {
        q('[data-table="' + path + '"]', form)
          .getElementsByTagName('tbody')[0]
          .insertAdjacentHTML('beforeend', TABLE[path]);
        return;
      }
      if (el.getAttribute && el.getAttribute('data-del') !== null) {
        var tr = el;
        while (tr && tr.tagName !== 'TR') tr = tr.parentNode;
        if (tr && tr.parentNode) tr.parentNode.removeChild(tr);
      }
    }, false);

    form.addEventListener('input', function () { refresh(form); }, false);
    form.addEventListener('change', function () { refresh(form); }, false);
    form.addEventListener('reset', function () {
      win.setTimeout(function () { refresh(form); }, 0);
    }, false);

    refresh(form);
    return form;
  }

  win.CJF = { render: render, collect: collect, version: '0.1.0' };
})(window, document);
