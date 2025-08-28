use std::collections::BTreeMap;
use std::future::Future;
use std::ops::{Deref, DerefMut};
use std::pin::Pin;

use serde::{Serialize, de::DeserializeOwned};
use serde_json::Value;

mod parser;

#[derive(Clone)]
pub struct DialectInterpreter<U: Send> {
    functions: BTreeMap<
        String,
        fn(
            &mut DialectInterpreter<U>,
            Value,
        ) -> Pin<Box<dyn Future<Output = anyhow::Result<Value>> + '_>>,
    >,
    userdata: U,
}

impl<U: Send> DialectInterpreter<U> {
    pub fn new(userdata: U) -> Self {
        Self {
            functions: BTreeMap::new(),
            userdata,
        }
    }

    pub fn user_data(&self) -> &U {
        &self.userdata
    }

    pub fn add_function<F>(&mut self)
    where
        F: DialectFunction<U>,
    {
        let type_name = std::any::type_name::<F>();
        // Extract just the struct name from the full path (e.g., "module::Uppercase" -> "uppercase")
        let struct_name = type_name.split("::").last().unwrap_or(type_name);
        let type_name_lower = struct_name.to_ascii_lowercase();
        self.functions
            .insert(type_name_lower, |interpreter, value| {
                Box::pin(async move { interpreter.execute::<F>(value).await })
            });
    }

    pub fn evaluate(
        &mut self,
        value: Value,
    ) -> Pin<Box<dyn Future<Output = anyhow::Result<Value>> + '_>> {
        Box::pin(async move {
            match value {
                Value::Null | Value::Bool(_) | Value::Number(_) | Value::String(_) => Ok(value),
                Value::Array(values) => {
                    let mut results = Vec::new();
                    for v in values {
                        results.push(self.evaluate(v).await?);
                    }
                    Ok(Value::Array(results))
                }
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

                    let evaluated_arg = self.evaluate_arg(fn_arg).await?;

                    match self.functions.get(&fn_name) {
                        Some(func) => func(self, evaluated_arg).await,
                        None => {
                            anyhow::bail!("[invalid dialect program] unknown function: {fn_name}")
                        }
                    }
                }
            }
        })
    }

    /// Evaluate a function argument, e.g., the A in a call like `{"functionName": A}`.
    /// This performs a "structural map" of the outer level, so `{"f1": E}` becomes
    /// `{"f1": E_eval}`, where `E_eval` is the evaluated form of `E`, etc.
    async fn evaluate_arg(&mut self, arg: Value) -> anyhow::Result<Value> {
        match arg {
            Value::Object(map) => {
                let mut result_map = serde_json::Map::new();
                for (name, value) in map {
                    let evaluated_value = self.evaluate(value).await?;
                    result_map.insert(name, evaluated_value);
                }
                Ok(Value::Object(result_map))
            }
            Value::Array(a) => {
                let mut result_array = Vec::new();
                for value in a {
                    let evaluated_value = self.evaluate(value).await?;
                    result_array.push(evaluated_value);
                }
                Ok(Value::Array(result_array))
            }

            // Atomic values just pass through
            Value::String(s) => Ok(Value::String(s)),
            Value::Number(n) => Ok(Value::Number(n)),
            Value::Bool(b) => Ok(Value::Bool(b)),
            Value::Null => Ok(Value::Null),
        }
    }

    async fn execute<F>(&mut self, value: Value) -> anyhow::Result<Value>
    where
        F: DialectFunction<U>,
    {
        let value_obj = match value {
            // For a call like `{"funcName": {"f1": E1, "f2": E2}}`,
            // we now have a struct `{"f1": E1_eval, "f2": E2_eval}`.
            //
            // We will "deserialize" this into an instance of the
            // struct that `DialectFunction` is defined on.
            Value::Object(_) => value,

            // Otherwise, for a call like `{"funcName": E}`,
            // we now have a value `E_eval`. Some functions
            // allow that `E_eval` to be converted to `{"f1": E_eval}`.
            _ => match F::DEFAULT_FIELD_NAME {
                Some(name) => serde_json::json!({ name : value }),
                None => anyhow::bail!("expected a json object `{{...}}`"),
            },
        };
        let input: F = serde_json::from_value(value_obj)?;
        let output: F::Output = input.execute(self).await?;
        Ok(serde_json::to_value(output)?)
    }
}

impl<U: Send> Deref for DialectInterpreter<U> {
    type Target = U;

    fn deref(&self) -> &Self::Target {
        &self.userdata
    }
}

impl<U: Send> DerefMut for DialectInterpreter<U> {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.userdata
    }
}

/// Implemented by Dialect functions. This is meant to be implemented
/// on a struct that also implements `Deserialize` and which
/// defines the arguments to the function:
///
/// ```rust,ignore
/// #[derive(Deserialize)]
/// pub struct TheFunction {
///    name: String
/// }
/// ```
///
/// The struct name becomes the function name
/// (note: Dialect is case-insensitive when it comes to function names).
/// The argument names are defined by the struct.
///
/// To invoke your function, the Dialect interpreter will
///
/// 1. determine a JSON object for your arguments
/// 2. deserialize that into the `Self` type to create an instance of `Self`
/// 3. invoke [`DialectFunction::execute`][].
///
/// # Default field names
///
/// Normally, functions must be invoked with explicit arguments,
/// like `{"lower": {"text": "Foo"}}`, and invoking them with
/// plain values like `{"lower": "Foo"}` is an error.
/// If you provide a `DEFAULT_FIELD_NAME` (e.g., `Some("text")`),
/// then a non-object argument is converted into
/// an object with a single field with the given name
/// (e.g., `{"text": "Foo"}`).
// ANCHOR: dialect_function_trait
pub trait DialectFunction<U: Send>: DeserializeOwned + Send {
    type Output: Serialize + Send;

    const DEFAULT_FIELD_NAME: Option<&'static str>;

    async fn execute(self, interpreter: &mut DialectInterpreter<U>)
    -> anyhow::Result<Self::Output>;
}
// ANCHOR_END: dialect_function_trait

/// Macro to implement DialectFunction for value types that evaluate to themselves
#[macro_export]
macro_rules! dialect_value {
    ($ty:ty) => {
        impl<U: Send> $crate::dialect::DialectFunction<U> for $ty {
            type Output = $ty;

            const DEFAULT_FIELD_NAME: Option<&'static str> = None;

            async fn execute(
                self,
                _interpreter: &mut $crate::dialect::DialectInterpreter<U>,
            ) -> anyhow::Result<Self::Output> {
                Ok(self)
            }
        }
    };
}
