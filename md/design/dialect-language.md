# Dialect language

The "Dialect" language is a variation of the Lambda calculus that is used to express and compose IDE operations. It is written in JSON:
## Quick Start

Dialect programs are JSON expressions that compose IDE operations. Here are the most common patterns:

**Find where a symbol is defined:**
```json
{"findDefinitions": "MyFunction"}
```

**Find all references to a symbol:**
```json
{"findReferences": "MyClass"}
```

**Get information about a symbol:**
```json
{"getSymbolInfo": "methodName"}
```

**Basic composition - find references to all definitions:**
```json
{"findReferences": {"findDefinitions": "MyFunction"}}
```

These expressions are passed to the `ide_operation` tool, which executes them and returns structured results with file locations and symbol information.

## Grammar

```
Expr = ExprAtomic
     | `{` Name `:` `{` Name `:` Expr ... `}` `}`
     | `{` Name `:` ExprAtomic `}`

ExprAtomic = number
           | boolean
           | `null`
           | `undefined`
           | string
           | `[` Expr... `]`

Name = string

// Here: capitalized things are nonterminals.
//
// number, boolean, string are JSON terminals.
//
// `foo` indicates the text `foo`.
//
// And ... indicates a comma-separated list.
```

## Dynamic semantics

A Dialect expression `E` evaluates to a JSON value:

* If `E = [ Expr... ]` a list, then
    * evaluate `Expr...` to values `V...`
    * and `E` evaluates to `[ V... ]`
* If `E = { Name_f: { Name_a: Expr ... }}`, then
    * evaluate `Expr...` to values `V...`
    * create an object `{ Name_a: V ... }` where each argument name is paired with the value of its expression
    * lookup the function `Name_f` and call it with the given arguments
* If `E = { Name_f: ExprAtomic }`, then
    * lookup the function `Name_f` and check whether it defaults a default argument `Name_a`
    * if so, evaluate `{ Name_f: { Name_a: ExprAtomic }}` instead
* If `E = number | string | null | undefined`, evaluate to itself

The interpreter is defined in `dialect.rs`.

## Defining functions

Functions are defined in Rust by implementing the `DialectFunction` trait:

```rust
{{#include ../../server/src/dialect.rs:dialect_function_trait}}
```

The `Output` will be serialized into JSON and passed along.

Some functions evaluate to instances of themselves, these represent "values"
(as in the lambda calculus). They can implement `DialectValue` instead:

```rust
{{#include ../../server/src/dialect.rs:dialect_value_trait}}
```

