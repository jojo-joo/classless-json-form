# Mapping json-schema to HTML5 widget

- only support minimum keywords
- using native HTML5 directive, no class
- only validate `format` in backend, the frontend ignores it
- `x-format` is required to pick a non-default widget: an `enum` alone does not
  turn a string/number into a `select`
- `x-inline: true` is the only "inline" switch: it lays radios out
  on one line

| keyword | value   | x-format       | Form elements | description |
|---------|---------|----------------|---------------|-------------|
| type    | boolean |                | input["checkbox"] | Renders a single checkbox for boolean values. |
| type    | boolean | switch         | input[type="checkbox"][role="switch"] | Renders a single toggle switch button for boolean value. |
| type    | boolean | select         | select | Renders a select dropdown with true/false options (false first). Labels customizable via `x-enum`. |
| type    | number  |                | input[type="number"] | A standard numeric input field that appears when no specific widget is requested. |
| type    | number  | range          | input["range"] | Renders a range slider when `x-format` specified or `minimum` and `maximum` are defined. |
| type    | number  | select         | select | Displays a dropdown select box populated from the `enum` array. `x-format` is required. |
| type    | number  | radios         | input["radio"] | Renders as many radio inputs as values in the `enum` constraint. Labels customizable via `x-enum`; `x-inline` lays them out on one line. |
| type    | number  | button         | input["button"] | One action button; clicking posts `{ "<property>": <value> }` to `x-api-addr`. Label from `x-enum[0]`, value from `default`; put it in an array with `x-inline: true` to get a row of buttons. |
| type    | object  |                | fieldset+legend | The standard widget that renders a fieldset. |
| type    | object  | accordion      | details+summary | Puts `x-format: "accordion"` on the container object: each of its properties becomes one collapsible panel. Panels of a group share a `name`, so opening one closes the others; the first panel starts open. |
| type    | string  |                | input["text"] | The standard text input that appears for string types without specific requirements. |
| title   | any     |                | label | Text shown on the left of the row (legend for objects, summary for panels). The key stays hidden and is only used in the submitted data. |
| type    | string  | password       | input[type="password"] | Native password input. |
| type    | string  | date           | input[type="date"] | Native date picker. |
| type    | string  | time           | input[type="time"] | Native time picker. |
| type    | string  | datetime-local | input[type="datetime-local"] | Native date + time picker. |
| type    | string  | email          | input[type="email"] | Native e-mail input with built-in validation. |
| type    | string  | url            | input[type="url"] | Native URL input. |
| type    | string  | color          | input[type="color"] | Native color picker. `color` is not a JSON Schema format, so `x-format` is the only way. |
| type    | string  | file           | input[type="file"] | Native file picker. Browsers never expose the selected path, so the value is not collected. |
| type    | string  | radios         | input["radio"] | Renders as many radio inputs as values in the `enum` constraint. Labels customizable via `x-enum`; `x-inline` lays them out on one line. |
| type    | string  | select         | select | Renders a select dropdown with options from the `enum` constraint. `x-format` is required. |
| type    | array   |                | one row per item | Repeats the `items` widget once per entry of `default`; the row label comes from `x-title` (e.g. `{{name}}`). A checkbox list is `items: { type: "boolean" }` with one entry per option, and `x-inline: true` puts them on one line. |

## Notes

- `type: "null"` is not rendered for now.
- field labels always use the **property name**: `title` is only read for whole
  forms (menu entry and document title), not for individual fields.
- `format` is a validation keyword: it is checked in the backend and ignored
  here. `{ "type": "string", "format": "email" }` alone still renders
  `input[type="text"]`; add `x-format` to pick the widget, e.g.
  `{ "format": "email", "x-format": "email" }`.
- `accordion` belongs to the container: put `x-format: "accordion"` on the
  object whose members should become panels. The object itself is not a panel,
  and each panel contains its member without a repeated label.
- every rendered control is submitted except action buttons (they have no name):
  empty text inputs are kept as `""`, while disabled controls (hidden if/then
  branches) are skipped.
- `x-hidden: true` drops just that key from the submitted data (the widget stays on
  screen) and lifts its children one level up.
- `x-inline` only affects `radios` and arrays; it has no
  effect on other widgets.
- Uses the `if` keyword to test a condition against the current value. When matched, `then` applies; otherwise `else` applies.

## Form actions

`Default` / `Submit` are **not** generated automatically. Declare them on the
form (the root object, or each `prefixItems` entry):

```json
"x-buttons": [
  { "type": "reset",  "label": "Default" },
  { "type": "submit", "label": "Submit" }
]
```

Without `x-buttons` the form has no submit/reset button (it can still be
submitted programmatically). `type` defaults to `submit`; the label defaults to
`Submit` / `Default`. The action block is not a row: it spans the full form
width.

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
| `x-hidden` | any key | Defaults to `false`. When `true` the key itself is left out of the submitted values, while its children are attached to the **parent** key: a hidden `wifi` object submits `wifi_ssid` next to it instead of `wifi.wifi_ssid`. |
| `x-layout` | form (root object, or each `prefixItems` item) | `aligned` (default), `stacked`, or `aligned-A-B`. `A`/`B` are CSS `<number [0,∞]>` track weights: non-negative, decimals allowed, `0` collapses the column (0–9 practical); `aligned-1-3` = `grid-template-columns: 1fr 3fr`. Invalid values fall back to `aligned` (1fr 2fr). `stacked` puts the label above the control. |
| `x-inline` | `radios`, arrays | `true` lays the options / buttons out on one line; on an array the repeated items share one row (e.g. a checkbox list). |
| `x-title` | `items` of a repeated array | Row title template; `{{name}}` is the key of the `default` entry, `{{index}}` its position (0-based). Without it the row shows the entry key. |
| `x-enum` | next to `enum` (`items.enum` for arrays), `boolean` | Option labels: array parallel to `enum`, or `{ "value": "Label" }`. For an array put it inside `items`, beside `enum`, not on the array itself. For `boolean` select, `x-enum[0]` labels `false` and `x-enum[1]` labels `true`. |
| `x-api-addr` | `x-format: "button"` | Relative API address. Put it once on the root schema; a field level value overrides it. A button POSTs only its own pair `{ "<property>": <value> }`, not the whole form, and the response is written next to the button. |
| `x-disabled` | any leaf field (incl. `button`) | Adds the `disabled` attribute. |
| `x-placeholder` | text-like inputs | Adds the `placeholder` attribute (plain `placeholder` also works). |
| `x-template` | `string` | Computed read-only value, e.g. `"{{city}}, {{state}}"`. |
| `x-watch` | with `x-template` | Map of template key to data path, e.g. `{ "city": "location.city" }`. |
