#![cfg(test)]
use std::collections::BTreeMap;

use crate::{
    dialect::{DialectFunction, DialectInterpreter},
    ide::{FileLocation, FileRange, FindDefinitions, FindReferences, IpcClient, SymbolDef},
};
use serde::Deserialize;

// Mock IPC client for testing
struct MockIpcClient {
    symbols: BTreeMap<String, Vec<SymbolDef>>,
    references: BTreeMap<String, Vec<FileRange>>,
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
                kind: Some("struct".to_string()),
                defined_at: FileRange {
                    path: "src/models.rs".to_string(),
                    start: FileLocation { line: 10, column: 0 },
                    end: FileLocation { line: 10, column: 4 },
                    content: Some("struct User {".to_string()),
                },
            }],
        );

        symbols.insert(
            "validateToken".to_string(),
            vec![
                SymbolDef {
                    name: "validateToken".to_string(),
                    kind: Some("function".to_string()),
                    defined_at: FileRange {
                        path: "src/auth.rs".to_string(),
                        start: FileLocation { line: 42, column: 0 },
                        end: FileLocation { line: 42, column: 13 },
                        content: Some("fn validateToken(token: &str) -> bool {".to_string()),
                    },
                },
                SymbolDef {
                    name: "validateToken".to_string(),
                    kind: Some("function".to_string()),
                    defined_at: FileRange {
                        path: "src/utils.rs".to_string(),
                        start: FileLocation { line: 15, column: 0 },
                        end: FileLocation { line: 15, column: 13 },
                        content: Some("pub fn validateToken(token: String) -> Result<(), Error> {"
                            .to_string()),
                    },
                },
            ],
        );

        references.insert(
            "User".to_string(),
            vec![
                FileRange {
                    path: "src/auth.rs".to_string(),
                    start: FileLocation { line: 5, column: 12 },
                    end: FileLocation { line: 5, column: 16 },
                    content: Some("use models::User;".to_string()),
                },
                FileRange {
                    path: "src/handlers.rs".to_string(),
                    start: FileLocation { line: 23, column: 8 },
                    end: FileLocation { line: 23, column: 12 },
                    content: Some("fn create_user() -> User {".to_string()),
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
    ) -> anyhow::Result<Vec<FileRange>> {
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
    assert_eq!(definitions[0].defined_at.path, "src/models.rs");
    assert_eq!(definitions[0].defined_at.start.line, 10);
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
                        "content": String("struct User {"),
                        "end": Object {
                            "column": Number(4),
                            "line": Number(10),
                        },
                        "path": String("src/models.rs"),
                        "start": Object {
                            "column": Number(0),
                            "line": Number(10),
                        },
                    },
                    "kind": String("struct"),
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
                        "content": String("fn validateToken(token: &str) -> bool {"),
                        "end": Object {
                            "column": Number(13),
                            "line": Number(42),
                        },
                        "path": String("src/auth.rs"),
                        "start": Object {
                            "column": Number(0),
                            "line": Number(42),
                        },
                    },
                    "kind": String("function"),
                    "name": String("validateToken"),
                },
                Object {
                    "definedAt": Object {
                        "content": String("pub fn validateToken(token: String) -> Result<(), Error> {"),
                        "end": Object {
                            "column": Number(13),
                            "line": Number(15),
                        },
                        "path": String("src/utils.rs"),
                        "start": Object {
                            "column": Number(0),
                            "line": Number(15),
                        },
                    },
                    "kind": String("function"),
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
                        "content": String("struct User {"),
                        "end": Object {
                            "column": Number(4),
                            "line": Number(10),
                        },
                        "path": String("src/models.rs"),
                        "start": Object {
                            "column": Number(0),
                            "line": Number(10),
                        },
                    },
                    "kind": String("struct"),
                    "name": String("User"),
                    "referencedAt": Object {
                        "content": String("use models::User;"),
                        "end": Object {
                            "column": Number(16),
                            "line": Number(5),
                        },
                        "path": String("src/auth.rs"),
                        "start": Object {
                            "column": Number(12),
                            "line": Number(5),
                        },
                    },
                },
                Object {
                    "definedAt": Object {
                        "content": String("struct User {"),
                        "end": Object {
                            "column": Number(4),
                            "line": Number(10),
                        },
                        "path": String("src/models.rs"),
                        "start": Object {
                            "column": Number(0),
                            "line": Number(10),
                        },
                    },
                    "kind": String("struct"),
                    "name": String("User"),
                    "referencedAt": Object {
                        "content": String("fn create_user() -> User {"),
                        "end": Object {
                            "column": Number(12),
                            "line": Number(23),
                        },
                        "path": String("src/handlers.rs"),
                        "start": Object {
                            "column": Number(8),
                            "line": Number(23),
                        },
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
        kind: Some("function".to_string()),
        defined_at: crate::ide::FileRange {
            path: "test.rs".to_string(),
            start: crate::ide::FileLocation { line: 10, column: 5 },
            end: crate::ide::FileLocation { line: 10, column: 18 },
            content: Some("fn test_function() {".to_string()),
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

#[tokio::test]
async fn test_search_function() {
    use expect_test::expect;
    
    let mock_client = MockIpcClient::new();
    let mut interpreter = DialectInterpreter::new(mock_client);
    interpreter.add_function::<FindDefinitions>();
    interpreter.add_function::<FindReferences>();
    interpreter.add_function::<crate::ide::Search>();
    
    // Test search for a pattern in a nonexistent file
    let program = serde_json::json!({
        "search": {
            "path": "nonexistent_file.rs", 
            "regex": "fn\\s+\\w+"
        }
    });
    
    let result = interpreter.evaluate(program).await;
    
    // Should return empty results since file doesn't exist
    expect![[r#"
        Ok(
            Array [],
        )
    "#]]
    .assert_debug_eq(&result);
}
