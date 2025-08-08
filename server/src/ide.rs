use std::{future::Future, pin::Pin};

use serde::{Deserialize, Serialize};

use crate::dialect::{DialectFunction, DialectInterpreter, DialectValue};

pub mod ambiguity;
mod test;

// IDE-specific types
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum Symbols {
    Name(String),
    Array(Vec<Symbols>),
    SymbolDef(SymbolDef),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SymbolDef {
    /// The symbol name (e.g., "User", "validateToken")
    pub name: String,
    /// Location where this symbol is defined
    #[serde(rename = "definedAt")]
    pub defined_at: FileLocation,
}

impl<U: Send> DialectValue<U> for SymbolDef {}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SymbolRef {
    #[serde(flatten)]
    pub definition: SymbolDef,

    /// Location where this symbol is defined
    #[serde(rename = "referencedAt")]
    pub referenced_at: FileLocation,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileLocation {
    /// File path relative to workspace root
    pub file: String,
    /// Line number (1-based)
    pub line: u32,
    /// Column number (0-based)
    pub column: u32,
    /// Surrounding code context for display
    pub context: String,
}

// IPC client trait that the userdata must implement
pub trait IpcClient: Send {
    async fn resolve_symbol_by_name(&mut self, name: &str) -> anyhow::Result<Vec<SymbolDef>>;
    async fn find_all_references(
        &mut self,
        symbol: &SymbolDef,
    ) -> anyhow::Result<Vec<FileLocation>>;
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
