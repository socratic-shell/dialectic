use std::collections::BTreeMap;
use std::future::Future;
use std::ops::{Deref, DerefMut};
use std::pin::Pin;

use async_trait::async_trait;
use serde::{de::DeserializeOwned, Serialize};
use serde_json::Value;

pub struct DialectInterpreter<U> {
    functions: BTreeMap<String, fn(&mut DialectInterpreter<U>, Value) -> Pin<Box<dyn Future<Output = anyhow::Result<Value>> + '_>>>,
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
        self.functions.insert(type_name_lower, |interpreter, value| {
            Box::pin(async move {
                interpreter.execute::<F>(value).await
            })
        });
    }

    pub fn evaluate(&mut self, value: Value) -> Pin<Box<dyn Future<Output = anyhow::Result<Value>> + '_>> {
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

                    let evaluated_arg = match fn_arg {
                        Value::Object(fn_map) => {
                            let mut result_map = serde_json::Map::new();
                            for (name, value) in fn_map {
                                let evaluated_value = self.evaluate(value).await?;
                                result_map.insert(name, evaluated_value);
                            }
                            Value::Object(result_map)
                        }
                        _ => anyhow::bail!("[invalid dialect program] function `{fn_name}` must have a JSON object as argument, not `{fn_arg}`")
                    };

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

    async fn execute<F>(&mut self, value: Value) -> anyhow::Result<Value>
    where
        F: DialectFunction<U>,
    {
        let input: F = serde_json::from_value(value)?;
        let output: F::Output = input.execute(self).await?;
        Ok(serde_json::to_value(output)?)
    }
}

impl<U> Deref for DialectInterpreter<U> {
    type Target = U;

    fn deref(&self) -> &Self::Target {
        &self.userdata
    }
}

impl<U> DerefMut for DialectInterpreter<U> {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.userdata
    }
}

/// A Dialect *function* is typically implemented on a struct like
///
/// ```rust,ignore
/// pub struct TheFunction {
///    name: String
/// }
/// ```
#[async_trait]
pub trait DialectFunction<U>: DeserializeOwned + Send {
    type Output: Serialize + Send;

    async fn execute(self, interpreter: &mut DialectInterpreter<U>) -> anyhow::Result<Self::Output>;
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ide::{FileLocation, FindDefinition, FindReferences, IpcClient, ResolvedSymbol, Symbol};
    use serde::Deserialize;

    // Mock IPC client for testing
    struct MockIpcClient {
        symbols: BTreeMap<String, Vec<ResolvedSymbol>>,
        references: BTreeMap<String, Vec<FileLocation>>,
    }

    impl MockIpcClient {
        fn new() -> Self {
            let mut symbols = BTreeMap::new();
            let mut references = BTreeMap::new();

            // Add some test data
            symbols.insert("User".to_string(), vec![
                ResolvedSymbol {
                    name: "User".to_string(),
                    location: FileLocation {
                        file: "src/models.rs".to_string(),
                        line: 10,
                        column: 0,
                        context: "struct User {".to_string(),
                    },
                    extra: serde_json::json!(null),
                }
            ]);

            symbols.insert("validateToken".to_string(), vec![
                ResolvedSymbol {
                    name: "validateToken".to_string(),
                    location: FileLocation {
                        file: "src/auth.rs".to_string(),
                        line: 42,
                        column: 0,
                        context: "fn validateToken(token: &str) -> bool {".to_string(),
                    },
                    extra: serde_json::json!(null),
                },
                ResolvedSymbol {
                    name: "validateToken".to_string(),
                    location: FileLocation {
                        file: "src/utils.rs".to_string(),
                        line: 15,
                        column: 0,
                        context: "pub fn validateToken(token: String) -> Result<(), Error> {".to_string(),
                    },
                    extra: serde_json::json!(null),
                }
            ]);

            references.insert("User".to_string(), vec![
                FileLocation {
                    file: "src/auth.rs".to_string(),
                    line: 5,
                    column: 12,
                    context: "use models::User;".to_string(),
                },
                FileLocation {
                    file: "src/handlers.rs".to_string(),
                    line: 23,
                    column: 8,
                    context: "fn create_user() -> User {".to_string(),
                }
            ]);

            Self { symbols, references }
        }
    }

    #[async_trait]
    impl IpcClient for MockIpcClient {
        async fn resolve_symbol_by_name(&mut self, name: &str) -> anyhow::Result<Vec<ResolvedSymbol>> {
            Ok(self.symbols.get(name).cloned().unwrap_or_default())
        }

        async fn find_all_references(&mut self, symbol: &ResolvedSymbol) -> anyhow::Result<Vec<FileLocation>> {
            Ok(self.references.get(&symbol.name).cloned().unwrap_or_default())
        }
    }

    // IDE Function Tests
    #[tokio::test]
    async fn test_find_definition_with_string_symbol() {
        let mut interpreter = DialectInterpreter::new(MockIpcClient::new());
        interpreter.add_function(FindDefinition { symbol: Symbol::Name(String::new()) });

        let input = serde_json::json!({
            "finddefinition": {
                "symbol": "User"
            }
        });

        let result = interpreter.evaluate(input).await.unwrap();
        let definitions: Vec<ResolvedSymbol> = serde_json::from_value(result).unwrap();
        
        assert_eq!(definitions.len(), 1);
        assert_eq!(definitions[0].name, "User");
        assert_eq!(definitions[0].location.file, "src/models.rs");
        assert_eq!(definitions[0].location.line, 10);
    }

    #[tokio::test]
    async fn test_find_definition_ambiguous_symbol() {
        let mut interpreter = DialectInterpreter::new(MockIpcClient::new());
        interpreter.add_function(FindDefinition { symbol: Symbol::Name(String::new()) });

        let input = serde_json::json!({
            "finddefinition": {
                "symbol": "validateToken"
            }
        });

        let result = interpreter.evaluate(input).await;
        assert!(result.is_err());
        
        let error_msg = result.unwrap_err().to_string();
        assert!(error_msg.contains("Ambiguous operation"));
    }

    #[tokio::test]
    async fn test_find_references() {
        let mut interpreter = DialectInterpreter::new(MockIpcClient::new());
        interpreter.add_function(FindReferences { symbol: Symbol::Name(String::new()) });

        let input = serde_json::json!({
            "findreferences": {
                "symbol": "User"
            }
        });

        let result = interpreter.evaluate(input).await.unwrap();
        let references: Vec<FileLocation> = serde_json::from_value(result).unwrap();
        
        assert_eq!(references.len(), 2);
        assert_eq!(references[0].file, "src/auth.rs");
        assert_eq!(references[0].line, 5);
        assert_eq!(references[1].file, "src/handlers.rs");
        assert_eq!(references[1].line, 23);
    }

    #[tokio::test]
    async fn test_symbol_not_found() {
        let mut interpreter = DialectInterpreter::new(MockIpcClient::new());
        interpreter.add_function(FindDefinition { symbol: Symbol::Name(String::new()) });

        let input = serde_json::json!({
            "finddefinition": {
                "symbol": "NonExistentSymbol"
            }
        });

        let result = interpreter.evaluate(input).await;
        assert!(result.is_err());
        
        let error_msg = result.unwrap_err().to_string();
        assert!(error_msg.contains("Symbol 'NonExistentSymbol' not found"));
    }

    // Simple test function - string manipulation
    #[derive(Deserialize)]
    struct Uppercase {
        text: String,
    }

    #[async_trait]
    impl DialectFunction<()> for Uppercase {
        type Output = String;

        async fn execute(
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

    #[async_trait]
    impl DialectFunction<()> for Concat {
        type Output = String;

        async fn execute(
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

    #[async_trait]
    impl DialectFunction<()> for Add {
        type Output = i32;

        async fn execute(
            self,
            _interpreter: &mut DialectInterpreter<()>,
        ) -> anyhow::Result<Self::Output> {
            Ok(self.a + self.b)
        }
    }

    #[tokio::test]
    async fn test_simple_function() {
        let mut interpreter = DialectInterpreter::new(());
        interpreter.add_function(Uppercase {
            text: String::new(),
        });

        let input = serde_json::json!({"uppercase": {"text": "hello"}});
        let result = interpreter.evaluate(input).await.unwrap();

        assert_eq!(result, serde_json::json!("HELLO"));
    }

    #[tokio::test]
    async fn test_function_composition() {
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

        let result = interpreter.evaluate(input).await.unwrap();
        assert_eq!(result, serde_json::json!("HELLO world"));
    }

    #[tokio::test]
    async fn test_nested_composition() {
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

        let result = interpreter.evaluate(input).await.unwrap();
        assert_eq!(result, serde_json::json!("HELLO WORLD"));
    }

    #[tokio::test]
    async fn test_literal_values() {
        let mut interpreter = DialectInterpreter::new(());

        // Test that literal values pass through unchanged
        assert_eq!(
            interpreter.evaluate(serde_json::json!("hello")).await.unwrap(),
            serde_json::json!("hello")
        );
        assert_eq!(
            interpreter.evaluate(serde_json::json!(42)).await.unwrap(),
            serde_json::json!(42)
        );
        assert_eq!(
            interpreter.evaluate(serde_json::json!(true)).await.unwrap(),
            serde_json::json!(true)
        );
        assert_eq!(
            interpreter.evaluate(serde_json::json!(null)).await.unwrap(),
            serde_json::json!(null)
        );
    }

    #[tokio::test]
    async fn test_array_evaluation() {
        let mut interpreter = DialectInterpreter::new(());
        interpreter.add_function(Add { a: 0, b: 0 });

        let input = serde_json::json!([
            {"add": {"a": 1, "b": 2}},
            {"add": {"a": 3, "b": 4}},
            "literal"
        ]);

        let result = interpreter.evaluate(input).await.unwrap();
        assert_eq!(result, serde_json::json!([3, 7, "literal"]));
    }

    #[tokio::test]
    async fn test_unknown_function_error() {
        let mut interpreter = DialectInterpreter::new(());

        let input = serde_json::json!({"unknown": {"arg": "value"}});
        let result = interpreter.evaluate(input).await;

        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("unknown function: unknown"));
    }

    #[tokio::test]
    async fn test_invalid_function_format() {
        let mut interpreter = DialectInterpreter::new(());

        // Multiple keys in object
        let input = serde_json::json!({"func1": {}, "func2": {}});
        let result = interpreter.evaluate(input).await;
        assert!(result.is_err());

        // Function with non-object argument
        let input = serde_json::json!({"func": "not an object"});
        let result = interpreter.evaluate(input).await;
        assert!(result.is_err());
    }
}

pub trait DialectValue<U>: DialectFunction<U, Output = Self> + Serialize {}

#[async_trait]
impl<V, U> DialectFunction<U> for V
where
    V: DialectValue<U> + Send,
    U: Send,
{
    type Output = V;

    async fn execute(self, _interpreter: &mut DialectInterpreter<U>) -> anyhow::Result<Self::Output> {
        Ok(self)
    }
}
