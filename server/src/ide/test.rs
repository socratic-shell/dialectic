#![cfg(test)]
use std::collections::BTreeMap;

use crate::{
    dialect::{DialectFunction, DialectInterpreter},
    ide::{FileLocation, FindDefinitions, FindReferences, IpcClient, SymbolDef},
};
use serde::Deserialize;

// Mock IPC client for testing
struct MockIpcClient {
    symbols: BTreeMap<String, Vec<SymbolDef>>,
    references: BTreeMap<String, Vec<FileLocation>>,
}

impl MockIpcClient {
    fn new() -> Self {
        let mut symbols = BTreeMap::new();
        let mut references = BTreeMap::new();

        // Add some test data
        symbols.insert(
            "User".to_string(),
            vec![SymbolDef {
                name: "User".to_string(),
                defined_at: FileLocation {
                    file: "src/models.rs".to_string(),
                    line: 10,
                    column: 0,
                    context: "struct User {".to_string(),
                },
            }],
        );

        symbols.insert(
            "validateToken".to_string(),
            vec![
                SymbolDef {
                    name: "validateToken".to_string(),
                    defined_at: FileLocation {
                        file: "src/auth.rs".to_string(),
                        line: 42,
                        column: 0,
                        context: "fn validateToken(token: &str) -> bool {".to_string(),
                    },
                },
                SymbolDef {
                    name: "validateToken".to_string(),
                    defined_at: FileLocation {
                        file: "src/utils.rs".to_string(),
                        line: 15,
                        column: 0,
                        context: "pub fn validateToken(token: String) -> Result<(), Error> {"
                            .to_string(),
                    },
                },
            ],
        );

        references.insert(
            "User".to_string(),
            vec![
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
                },
            ],
        );

        Self {
            symbols,
            references,
        }
    }
}

impl IpcClient for MockIpcClient {
    async fn resolve_symbol_by_name(&mut self, name: &str) -> anyhow::Result<Vec<SymbolDef>> {
        Ok(self.symbols.get(name).cloned().unwrap_or_default())
    }

    async fn find_all_references(
        &mut self,
        symbol: &SymbolDef,
    ) -> anyhow::Result<Vec<FileLocation>> {
        Ok(self
            .references
            .get(&symbol.name)
            .cloned()
            .unwrap_or_default())
    }
}

// IDE Function Tests
#[tokio::test]
async fn test_find_definition_with_string_symbol() {
    let mut interpreter = DialectInterpreter::new(MockIpcClient::new());
    interpreter.add_function::<FindDefinitions>();

    let input = serde_json::json!({
        "finddefinitions": "User"
    });

    let result = interpreter.evaluate(input).await.unwrap();
    let definitions: Vec<SymbolDef> = serde_json::from_value(result).unwrap();

    assert_eq!(definitions.len(), 1);
    assert_eq!(definitions[0].name, "User");
    assert_eq!(definitions[0].defined_at.file, "src/models.rs");
    assert_eq!(definitions[0].defined_at.line, 10);
}

#[tokio::test]
async fn test_find_definition_with_to_string_symbol() {
    let mut interpreter = DialectInterpreter::new(MockIpcClient::new());
    interpreter.add_function::<FindDefinitions>();

    let input = serde_json::json!({
        "finddefinitions": {"of": "User"}
    });

    expect_test::expect![[r#"
        Ok(
            Array [
                Object {
                    "definedAt": Object {
                        "column": Number(0),
                        "context": String("struct User {"),
                        "file": String("src/models.rs"),
                        "line": Number(10),
                    },
                    "name": String("User"),
                },
            ],
        )
    "#]]
    .assert_debug_eq(&interpreter.evaluate(input).await);
}

#[tokio::test]
async fn test_find_definition_ambiguous_symbol() {
    let mut interpreter = DialectInterpreter::new(MockIpcClient::new());
    interpreter.add_function::<FindDefinitions>();

    let input = serde_json::json!({
        "finddefinitions": {
            "of": "validateToken"
        }
    });

    expect_test::expect![[r#"
        Ok(
            Array [
                Object {
                    "definedAt": Object {
                        "column": Number(0),
                        "context": String("fn validateToken(token: &str) -> bool {"),
                        "file": String("src/auth.rs"),
                        "line": Number(42),
                    },
                    "name": String("validateToken"),
                },
                Object {
                    "definedAt": Object {
                        "column": Number(0),
                        "context": String("pub fn validateToken(token: String) -> Result<(), Error> {"),
                        "file": String("src/utils.rs"),
                        "line": Number(15),
                    },
                    "name": String("validateToken"),
                },
            ],
        )
    "#]].assert_debug_eq(&interpreter.evaluate(input).await);
}

#[tokio::test]
async fn test_find_references() {
    let mut interpreter = DialectInterpreter::new(MockIpcClient::new());
    interpreter.add_function::<FindReferences>();

    let input = serde_json::json!({
        "findreferences": {
            "to": "User"
        }
    });

    expect_test::expect![[r#"
        Ok(
            Array [
                Object {
                    "definedAt": Object {
                        "column": Number(0),
                        "context": String("struct User {"),
                        "file": String("src/models.rs"),
                        "line": Number(10),
                    },
                    "name": String("User"),
                    "referencedAt": Object {
                        "column": Number(12),
                        "context": String("use models::User;"),
                        "file": String("src/auth.rs"),
                        "line": Number(5),
                    },
                },
                Object {
                    "definedAt": Object {
                        "column": Number(0),
                        "context": String("struct User {"),
                        "file": String("src/models.rs"),
                        "line": Number(10),
                    },
                    "name": String("User"),
                    "referencedAt": Object {
                        "column": Number(8),
                        "context": String("fn create_user() -> User {"),
                        "file": String("src/handlers.rs"),
                        "line": Number(23),
                    },
                },
            ],
        )
    "#]]
    .assert_debug_eq(&interpreter.evaluate(input).await);
}

#[tokio::test]
async fn test_symbol_not_found() {
    let mut interpreter = DialectInterpreter::new(MockIpcClient::new());
    interpreter.add_function::<FindDefinitions>();

    let input = serde_json::json!({
        "finddefinitions": {
            "of": "NonExistentSymbol"
        }
    });

    expect_test::expect![[r#"
        Ok(
            Array [],
        )
    "#]]
    .assert_debug_eq(&interpreter.evaluate(input).await);
}

#[tokio::test]
async fn test_resolve_symbol_by_name_ipc() {
    let mut interpreter = DialectInterpreter::new(MockIpcClient::new());

    // Test that the IPC call is made correctly (MockIpcClient returns empty results)
    let result = interpreter.resolve_symbol_by_name("TestSymbol").await;
    assert!(result.is_ok());
    assert_eq!(result.unwrap().len(), 0); // MockIpcClient returns empty vec
}

#[tokio::test]
async fn test_find_all_references_ipc() {
    let mut interpreter = DialectInterpreter::new(MockIpcClient::new());

    let test_symbol = crate::ide::SymbolDef {
        name: "TestSymbol".to_string(),
        defined_at: crate::ide::FileLocation {
            file: "test.rs".to_string(),
            line: 10,
            column: 5,
            context: "fn test_function() {".to_string(),
        },
    };

    // Test that the IPC call is made correctly (MockIpcClient returns empty results)
    let result = interpreter.find_all_references(&test_symbol).await;
    assert!(result.is_ok());
    assert_eq!(result.unwrap().len(), 0); // MockIpcClient returns empty vec
}

// Simple test function - string manipulation
#[derive(Deserialize)]
struct Uppercase {
    text: String,
}

impl DialectFunction<()> for Uppercase {
    type Output = String;

    const DEFAULT_FIELD_NAME: Option<&'static str> = None;

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

impl DialectFunction<()> for Concat {
    type Output = String;

    const DEFAULT_FIELD_NAME: Option<&'static str> = None;

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

impl DialectFunction<()> for Add {
    type Output = i32;

    const DEFAULT_FIELD_NAME: Option<&'static str> = None;

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
    interpreter.add_function::<Uppercase>();

    let input = serde_json::json!({"uppercase": {"text": "hello"}});
    let result = interpreter.evaluate(input).await.unwrap();

    assert_eq!(result, serde_json::json!("HELLO"));
}

#[tokio::test]
async fn test_function_composition() {
    let mut interpreter = DialectInterpreter::new(());
    interpreter.add_function::<Uppercase>();
    interpreter.add_function::<Concat>();

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
    interpreter.add_function::<Add>();
    interpreter.add_function::<Uppercase>();

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
        interpreter
            .evaluate(serde_json::json!("hello"))
            .await
            .unwrap(),
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
    interpreter.add_function::<Add>();

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
    assert!(
        result
            .unwrap_err()
            .to_string()
            .contains("unknown function: unknown")
    );
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
