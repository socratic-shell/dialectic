use std::{future::Future, pin::Pin};

use serde::{Deserialize, Serialize};

use crate::dialect::{DialectFunction, DialectInterpreter};

pub mod ambiguity;
mod test;

// IPC client trait that the userdata must implement
pub trait IpcClient: Send {
    async fn resolve_symbol_by_name(&mut self, name: &str) -> anyhow::Result<Vec<SymbolDef>>;
    async fn find_all_references(&mut self, symbol: &SymbolDef) -> anyhow::Result<Vec<FileRange>>;
}

/// The "symbols" file is used as the expected argument
/// for a number of other functions. It is intentionally
/// flexible to enable LLM shorthands -- it can receive
/// a string, an array with other symbols, or an explicit
/// symbol definition. In all cases the [`Symbols::resolve`][]
/// will canonicalize to a list of [`SymbolDef`][] structures.
///
/// Note that `Symbols` is not actually a [`DialectFunction`][].
/// It is only intended for use as the value of a *function argument* 
/// -- it doesn't have a canonical function format.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum Symbols {
    Name(String),
    Array(Vec<Symbols>),
    SymbolDef(SymbolDef),
}

// Symbol implementation
impl Symbols {
    pub fn resolve<U: IpcClient>(
        &self,
        interpreter: &mut DialectInterpreter<U>,
    ) -> Pin<Box<impl Future<Output = anyhow::Result<Vec<SymbolDef>>>>> {
        Box::pin(async move {
            match self {
                Symbols::Name(name) => {
                    // Call IPC: resolve-symbol-by-name (using Deref to access userdata directly)
                    interpreter.resolve_symbol_by_name(name).await
                }

                Symbols::Array(symbols) => {
                    let mut output = vec![];
                    for s in symbols {
                        output.extend(s.resolve(interpreter).await?);
                    }
                    Ok(output)
                }

                Symbols::SymbolDef(symbol_def) => Ok(vec![symbol_def.clone()]),
            }
        })
    }
}

/// A symbol definition representing where a symbol is defined.
///
/// Corresponds loosely to LSP SymbolInformation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SymbolDef {
    /// The symbol name (e.g., "User", "validateToken")
    pub name: String,

    /// The "kind" of symbol (this is a string that the LLM hopefully knows how to interpret)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,

    /// Location where this symbol is defined
    #[serde(rename = "definedAt")]
    pub defined_at: FileRange,
}

crate::dialect_value!(SymbolDef);

/// A *reference* to a symbol -- includes the information about the symbol itself.
/// A [`SymbolRef`][] can therefore be seen as a subtype of [`SymbolDef`][].
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SymbolRef {
    /// Symbol being referenced
    #[serde(flatten)]
    pub definition: SymbolDef,

    /// Location where this symbol is referenced from
    #[serde(rename = "referencedAt")]
    pub referenced_at: FileRange,
}

crate::dialect_value!(SymbolRef);

/// Represents a range of bytes in a file (or URI, etc).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileRange {
    /// File path, relative to workspace root
    pub path: String,

    /// Start of range (always <= end)
    pub start: FileLocation,

    /// End of range (always >= start)
    pub end: FileLocation,

    /// Enclosing text (optional)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
}

crate::dialect_value!(FileRange);

/// A line/colum index.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileLocation {
    /// Line number (1-based)
    pub line: u32,

    /// Column number (1-based)
    pub column: u32,
}

crate::dialect_value!(FileLocation);

// IDE Functions
#[derive(Deserialize)]
pub struct FindDefinitions {
    of: Symbols,
}

impl<U: IpcClient> DialectFunction<U> for FindDefinitions {
    type Output = Vec<SymbolDef>;

    const DEFAULT_FIELD_NAME: Option<&'static str> = Some("of");

    async fn execute(
        self,
        interpreter: &mut DialectInterpreter<U>,
    ) -> anyhow::Result<Self::Output> {
        self.of.resolve(interpreter).await
    }
}

#[derive(Deserialize)]
pub struct FindReferences {
    pub to: Symbols,
}

impl<U: IpcClient> DialectFunction<U> for FindReferences {
    type Output = Vec<SymbolRef>;

    const DEFAULT_FIELD_NAME: Option<&'static str> = Some("to");

    async fn execute(
        self,
        interpreter: &mut DialectInterpreter<U>,
    ) -> anyhow::Result<Self::Output> {
        let definitions = self.to.resolve(interpreter).await?;
        let mut output = vec![];
        for definition in definitions {
            let locations = interpreter.find_all_references(&definition).await?;
            output.extend(locations.into_iter().map(|loc| SymbolRef {
                definition: definition.clone(),
                referenced_at: loc,
            }));
        }
        Ok(output)
    }
}
