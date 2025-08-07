use std::collections::BTreeMap;

use serde::{de::DeserializeOwned, Serialize};
use serde_json::Value;

pub mod ambiguity;

pub struct DialectInterpreter<U> {
    functions: BTreeMap<String, fn(&mut DialectInterpreter<U>, Value) -> anyhow::Result<Value>>,
    userdata: U,
}

impl<U> DialectInterpreter<U> {
    pub fn new(userdata: U) -> Self {
        Self {
            functions: BTreeMap::new(),
            userdata,
        }
    }

    pub fn add_function<F>(&mut self, _op: F)
    where
        F: DialectFunction<U>,
    {
        let type_name = std::any::type_name::<F>();
        // Extract just the struct name from the full path (e.g., "module::Uppercase" -> "uppercase")
        let struct_name = type_name.split("::").last().unwrap_or(type_name);
        let type_name_lower = struct_name.to_ascii_lowercase();
        self.functions.insert(type_name_lower, Self::execute::<F>);
    }

    pub fn evaluate(&mut self, value: Value) -> anyhow::Result<Value> {
        match value {
            Value::Null | Value::Bool(_) | Value::Number(_) | Value::String(_) => Ok(value),
            Value::Array(values) => Ok(Value::Array(
                values
                    .into_iter()
                    .map(|v| self.evaluate(v))
                    .collect::<Result<Vec<Value>, _>>()?,
            )),
            Value::Object(map) => {
                // We expect the `arg` to look like
                //
                // `{"func": { "arg0": json0, ..., "argN": jsonN }`
                //
                // We begin by
                //
                // (1) extracting the inner object.
                // (2) map the fields in the inner object using recursive evaluation, yielding `R = {"arg0": val0, ..}`;
                // (3) deserialize from `R` to the input type `I`
                // (4) invoke the function to get the result struct and then serialize it to JSON

                if map.len() != 1 {
                    anyhow::bail!(
                        "[invalid dialect program] object must have exactly one key: {map:#?}"
                    );
                }

                let (mut fn_name, fn_arg) = map.into_iter().next().unwrap();
                fn_name.make_ascii_lowercase();

                let evaluated_arg = match fn_arg {
                    Value::Object(fn_map) => Value::Object(
                        fn_map
                            .into_iter()
                            .map(|(name, value)| {
                                let value1 = self.evaluate(value)?;
                                Ok((name, value1))
                            })
                            .collect::<anyhow::Result<_>>()?,
                        ),
                _ => anyhow::bail!("[invalid dialect program] function `{fn_name}` must have a JSON object as argument, not `{fn_arg}`")
            };

                match self.functions.get(&fn_name) {
                    Some(func) => func(self, evaluated_arg),
                    None => {
                        anyhow::bail!("[invalid dialect program] unknown function: {fn_name}")
                    }
                }
            }
        }
    }

    fn execute<F>(&mut self, value: Value) -> anyhow::Result<Value>
    where
        F: DialectFunction<U>,
    {
        let input: F = serde_json::from_value(value)?;
        let output: F::Output = input.execute(self)?;
        Ok(serde_json::to_value(output)?)
    }
}

/// A Dialect *function* is typically implemented on a struct like
///
/// ```rust,ignore
/// pub struct TheFunction {
///    name: String
/// }
/// ```
pub trait DialectFunction<U>: DeserializeOwned {
    type Output: Serialize;

    fn execute(self, interpreter: &mut DialectInterpreter<U>) -> anyhow::Result<Self::Output>;
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::Deserialize;

    // Simple test function - string manipulation
    #[derive(Deserialize)]
    struct Uppercase {
        text: String,
    }

    impl DialectFunction<()> for Uppercase {
        type Output = String;

        fn execute(
            self,
            _interpreter: &mut DialectInterpreter<()>,
        ) -> anyhow::Result<Self::Output> {
            Ok(self.text.to_uppercase())
        }
    }

    // Test function with composition
    #[derive(Deserialize)]
    struct Concat {
        left: String,
        right: String,
    }

    impl DialectFunction<()> for Concat {
        type Output = String;

        fn execute(
            self,
            _interpreter: &mut DialectInterpreter<()>,
        ) -> anyhow::Result<Self::Output> {
            Ok(format!("{}{}", self.left, self.right))
        }
    }

    // Test function that returns a number
    #[derive(Deserialize)]
    struct Add {
        a: i32,
        b: i32,
    }

    impl DialectFunction<()> for Add {
        type Output = i32;

        fn execute(
            self,
            _interpreter: &mut DialectInterpreter<()>,
        ) -> anyhow::Result<Self::Output> {
            Ok(self.a + self.b)
        }
    }

    #[test]
    fn test_simple_function() {
        let mut interpreter = DialectInterpreter::new(());
        interpreter.add_function(Uppercase {
            text: String::new(),
        });

        let input = serde_json::json!({"uppercase": {"text": "hello"}});
        let result = interpreter.evaluate(input).unwrap();

        assert_eq!(result, serde_json::json!("HELLO"));
    }

    #[test]
    fn test_function_composition() {
        let mut interpreter = DialectInterpreter::new(());
        interpreter.add_function(Uppercase {
            text: String::new(),
        });
        interpreter.add_function(Concat {
            left: String::new(),
            right: String::new(),
        });

        let input = serde_json::json!({
            "concat": {
                "left": {"uppercase": {"text": "hello"}},
                "right": " world"
            }
        });

        let result = interpreter.evaluate(input).unwrap();
        assert_eq!(result, serde_json::json!("HELLO world"));
    }

    #[test]
    fn test_nested_composition() {
        let mut interpreter = DialectInterpreter::new(());
        interpreter.add_function(Add { a: 0, b: 0 });
        interpreter.add_function(Uppercase {
            text: String::new(),
        });

        // Use string concatenation instead of mixing types
        let input = serde_json::json!({
            "uppercase": {
                "text": "hello world"
            }
        });

        let result = interpreter.evaluate(input).unwrap();
        assert_eq!(result, serde_json::json!("HELLO WORLD"));
    }

    #[test]
    fn test_literal_values() {
        let mut interpreter = DialectInterpreter::new(());

        // Test that literal values pass through unchanged
        assert_eq!(
            interpreter.evaluate(serde_json::json!("hello")).unwrap(),
            serde_json::json!("hello")
        );
        assert_eq!(
            interpreter.evaluate(serde_json::json!(42)).unwrap(),
            serde_json::json!(42)
        );
        assert_eq!(
            interpreter.evaluate(serde_json::json!(true)).unwrap(),
            serde_json::json!(true)
        );
        assert_eq!(
            interpreter.evaluate(serde_json::json!(null)).unwrap(),
            serde_json::json!(null)
        );
    }

    #[test]
    fn test_array_evaluation() {
        let mut interpreter = DialectInterpreter::new(());
        interpreter.add_function(Add { a: 0, b: 0 });

        let input = serde_json::json!([
            {"add": {"a": 1, "b": 2}},
            {"add": {"a": 3, "b": 4}},
            "literal"
        ]);

        let result = interpreter.evaluate(input).unwrap();
        assert_eq!(result, serde_json::json!([3, 7, "literal"]));
    }

    #[test]
    fn test_unknown_function_error() {
        let mut interpreter = DialectInterpreter::new(());

        let input = serde_json::json!({"unknown": {"arg": "value"}});
        let result = interpreter.evaluate(input);

        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("unknown function: unknown"));
    }

    #[test]
    fn test_invalid_function_format() {
        let mut interpreter = DialectInterpreter::new(());

        // Multiple keys in object
        let input = serde_json::json!({"func1": {}, "func2": {}});
        let result = interpreter.evaluate(input);
        assert!(result.is_err());

        // Function with non-object argument
        let input = serde_json::json!({"func": "not an object"});
        let result = interpreter.evaluate(input);
        assert!(result.is_err());
    }
}

pub trait DialectValue<U>: DialectFunction<U, Output = Self> + Serialize {}

impl<V, U> DialectFunction<U> for V
where
    V: DialectValue<U>,
{
    type Output = V;

    fn execute(self, _interpreter: &mut DialectInterpreter<U>) -> anyhow::Result<Self::Output> {
        Ok(self)
    }
}
