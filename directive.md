# Mapping Relationship Summary

| keyword | value   | format | x-format | Form elements | description |
|---------|---------|--------|----------|---------------|-------------|
| type    | boolean |        |          | input["checkbox"] | Renders a single checkbox for boolean values. |
| type    | boolean |        |  switch  | input[type="checkbox"][role="switch"] | Renders a single toggle switch button for boolean value. |
| type    | boolean |        |  select  | select | For visual consistency, Renders a select dropdown with true/false options. Labels customizable via `x-enum`. |
| type    | number  |        |          | input[type="number"] | A standard numeric input field that appears when no specific format is requested. |
| type    | number  |        |  range   | input["range"] | Renders a range slider. Activated when `minimum` and `maximum` are defined, or `x-format: "range"` is explicitly specified. |
| type    | number  |        |  select  | select | For visual consistency, Displays a dropdown select box populated from the `enum` array. Ideal for predefined numeric options. |
| type    | number  |        |  button  | button | Post the value in json format to the `x-api-addr` which indicate the api uri relative address. |
| type    | array   || | input["checkbox"] | Displays array values as checkboxes. Ideal for arrays of unique string, number, or integer values (`uniqueItems: true`). |
| type    | array   || checkboxes-inline | input["checkbox"] (inline) | Horizontal layout version of the checkboxes editor for more compact displays. |
| type    | array   || table-object | table | Renders array items in a tabular format. Items must be `type: object`. |
| type    | object  || | fieldset (collapsible) | The standard editor that renders a fieldset containing property editors. Collapse/expand behavior configurable via `x-enableCollapseToggle`, `x-startCollapsed` etc. |
| type    | object  || accordion | div (accordion panels) | Renders object properties as collapsible Bootstrap accordion panels. |
| type    | string  || | input["text"] | The standard text input that appears for string types without specific formatting requirements. |
| type    | string  || radios | input["radio"] | Renders as many radio inputs as values in the `enum` constraint. Labels customizable via `x-enumTitles`. |
| type    | string  || radios-inline | input["radio"] (inline) | Horizontal layout version of the radio editor for more compact displays. |
| type    | string  || | select | Renders a select dropdown with options from the `enum` constraint. Labels customizable via `x-enumTitles`. |
| type    | null    || | (no input widget) | The standard editor for null types without specific formatting requirements. Typically renders a placeholder or no interactive element. |
| if / then / else | (condition) || | (dynamic branch switching) | Uses the `if` keyword to test a condition against the current value. When matched, `then` applies; otherwise `else` applies. Jedison builds one editor per branch and swaps which one is shown as watched fields change. |