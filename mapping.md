# Mapping json-schema to HTML5 widget

- only support minimum keywords
- using native HTML5 directive, no class
- only validate `format` in backend, the frontend ignores it

| keyword | value   | x-format          | Form elements | description |
|---------|---------|-------------------|---------------|-------------|
| type    | boolean |                   | input["checkbox"] | Renders a single checkbox for boolean values. |
| type    | boolean |  switch           | input[type="checkbox"][role="switch"] | Renders a single toggle switch button for boolean value. |
| type    | boolean |  select           | select | Renders a select dropdown with true/false options (false first). Labels customizable via `x-enum`. |
| type    | number  |                   | input[type="number"] | A standard numeric input field that appears when no specific widget is requested. |
| type    | number  |  range            | input["range"] | Renders a range slider when `x-format` specified or `minimum` and `maximum` are defined. |
| type    | number  |                   | select | Displays a dropdown select box populated from the `enum` array. Ideal for predefined numeric options. |
| type    | number  |  button           | button | Post the value in json format to the `x-api-addr` which indicate the api uri relative address. |
| type    | array   |                   | input["checkbox"] | Displays array values as checkboxes. Ideal for arrays of unique string, number, or integer values (`uniqueItems: true`). |
| type    | array   | checkboxes-inline | input["checkbox"] (inline) | Horizontal layout version of the checkboxes widget for more compact displays. |
| type    | array   | table             | table | Renders array items in a tabular format. Items must be `type: object`. |
| type    | object  |                   | fieldset+legend | The standard widget that renders a fieldset. |
| type    | object  | accordion         | details+summary | Puts `x-format: "accordion"` on the container object: each of its properties becomes one collapsible panel. Panels of a group share a `name`, so opening one closes the others; the first panel starts open. |
| type    | string  |                   | input["text"] | The standard text input that appears for string types without specific requirements. |
| type    | string  |  date             | input[type="date"] | Native date picker. |
| type    | string  |  time             | input[type="time"] | Native time picker. |
| type    | string  |  date-time        | input[type="datetime-local"] | Native date + time picker. |
| type    | string  |  email            | input[type="email"] | Native e-mail input with built-in validation. |
| type    | string  |  uri              | input[type="url"] | Native URL input. |
| type    | string  |  color            | input[type="color"] | Native color picker. `color` is not a JSON Schema format, so `x-format` is the only way. |
| type    | string  |  file             | input[type="file"] | Native file picker. Browsers never expose the selected path, so the value is not collected. |
| type    | string  | radios            | input["radio"] | Renders as many radio inputs as values in the `enum` constraint. Labels customizable via `x-enum`. |
| type    | string  | radios-inline     | input["radio"] (inline) | Horizontal layout version of the radio widget for more compact displays. |
| type    | string  |                   | select | Renders a select dropdown with options from the `enum` constraint. Labels customizable via `x-enum`. |
| type    | string  |  button           | button | Post the value in json format to the `x-api-addr` which indicate the api uri relative address. |
| type    | null    |                   | output | The standard widget for null types without specific requirements. Renders an empty placeholder, not an interactive element. |
| if / then / else | (condition) | | (dynamic branch switching) | Uses the `if` keyword to test a condition against the current value. When matched, `then` applies; otherwise `else` applies. Jedison builds one widget per branch and swaps which one is shown as watched fields change. |

## Notes

- `x-format` accepts the widget names of the table above (`switch`, `select`,
  `range`, `button`, `radios`, `radios-inline`, `checkboxes-inline`, `table`,
  `accordion`, `date`, `time`, `date-time`, `email`, `uri`, `color`, `file`).
- A `number`/`string` schema that has an `enum` is rendered as `select` even
  without `x-format`; a `boolean` has no `enum`, hence needs `x-format: "select"`.
- `boolean` never gets the `required` attribute: `false` is a valid value and
  HTML would force the box to be checked.
- Array checkboxes keep the type of `items.type`, so a checked `integer` option
  is collected as a number.
- `accordion` belongs to the container: put `x-format: "accordion"` on the
  object whose members should become panels. The object itself is not a panel,
  and each panel contains its member without a repeated label.

## Multiple forms

- root schema `object` -> one form and one menu entry.
- root schema `array`  -> one form per `prefixItems` entry (legacy array `items`
  also works), so the menu lists one entry per form.
- every form gets `id="cjf-form-<index>"`; the menu shows one form and hides the
  others by that id. `CJF.render` returns the `<form>` for an object root, or an
  array of forms for an array root.
- `x-format: "accordion"` groups are per form, so panels of different forms do
  not collapse each other.

## Page chrome

`CJF.render` injects its own `<style>`, a sticky `<header>` and a `<nav>` menu
inside that header:

- the root schema `title` becomes `document.title` (the browser tab title);
- the title of the current form is shown in the middle of the header and follows
  the menu selection;
- `header`, `main` and `footer` share one content column.

The host page only needs `<main>` plus the schema; no `<h2>`/`<h3>` heading is
generated, because both titles already live in the tab and in the header.

## Auxiliary keywords

| keyword | applies to | meaning |
|---------|------------|---------|
| `x-enum` | `enum`, `items.enum`, `boolean` | Option labels: array parallel to `enum`, or `{ "value": "Label" }`. For `boolean` select, `x-enum[0]` labels `false` and `x-enum[1]` labels `true`. |
| `x-label` | `x-format: "button"` | Text of the button. |
| `x-api-addr` | `x-format: "button"` | Relative API address; on click the form values are POSTed as JSON and the response is written next to the button. |
| `x-disabled` | any leaf field | Adds the `disabled` attribute. |
| `x-placeholder` | text-like inputs | Adds the `placeholder` attribute (plain `placeholder` also works). |
| `x-template` | `string` | Computed read-only value, e.g. `"{{city}}, {{state}}"`. |
| `x-watch` | with `x-template` | Map of template key to data path, e.g. `{ "city": "location.city" }`. |

