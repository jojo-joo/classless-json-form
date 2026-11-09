# Classless-json-form
renders forms in frontend and validates schema in backend, with zero dependencies, minimal size, multiple themes.

## Features
- obey to json-schema [Draft 2020-12](https://json-schema.org/draft/2020-12)
- a minimum implementation of json-schema, see [directive](directive.md) and relationship between JSON Schema and form elements.
- the smallest footprint
- zero dependency
- multiple themes with classless css.

## Why classless
if using classs based css to generate the forms, compatiability is an issue, for each popular H5 framework using there own style and private class names. MCU developer knows few about the H5 frameworks. and the size of most popluar H5 framw work is very large (eg bootstrap, tailwind, vue, react...)
classless css framework can resolve the issue above:
- standard and native H5 elements, dozens of classless css we can choose
- smaller and faster
- no need to study any 

