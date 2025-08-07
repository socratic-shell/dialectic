use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::dialect::{DialectFunction, DialectInterpreter};

pub mod ambiguity;

// IDE-specific types
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum Symbol {
    Name(String),
    Resolved {
        name: String,
        file: String,
        line: u32,
        extra: Value,
    },
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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResolvedSymbol {
    /// The symbol name (e.g., "User", "validateToken")
    pub name: String,
    /// Location where this symbol is defined
    #[serde(flatten)]
    pub location: FileLocation,
    /// Additional metadata from the LSP (type info, documentation, etc.)
    pub extra: Value,
}

// IPC client trait that the userdata must implement
pub trait IpcClient {
    fn resolve_symbol_by_name(&mut self, name: &str) -> anyhow::Result<Vec<ResolvedSymbol>>;
    fn find_all_references(&mut self, symbol: &ResolvedSymbol) -> anyhow::Result<Vec<FileLocation>>;
}

// Symbol implementation
impl Symbol {
    pub fn resolve<U: IpcClient>(&self, interpreter: &mut DialectInterpreter<U>) -> anyhow::Result<ResolvedSymbol> {
        match self {
            Symbol::Name(name) => {
                // Call IPC: resolve-symbol-by-name (using Deref to access userdata directly)
                let candidates = interpreter.resolve_symbol_by_name(name)?;
                match candidates.len() {
                    0 => Err(anyhow::anyhow!("Symbol '{}' not found", name)),
                    1 => Ok(candidates.into_iter().next().unwrap()),
                    _ => {
                        // Create ambiguity error with refinement suggestions
                        let alternatives: Vec<Value> = candidates
                            .into_iter()
                            .map(|c| serde_json::to_value(Symbol::Resolved {
                                name: c.name.clone(),
                                file: c.location.file.clone(),
                                line: c.location.line,
                                extra: c.extra.clone(),
                            }))
                            .collect::<Result<Vec<_>, _>>()?;
                        
                        Err(ambiguity::AmbiguityError::new(
                            serde_json::to_value(self)?,
                            alternatives
                        ).into())
                    }
                }
            }
            Symbol::Resolved { name, file, line, extra } => {
                Ok(ResolvedSymbol {
                    name: name.clone(),
                    location: FileLocation {
                        file: file.clone(),
                        line: *line,
                        column: 0, // Column not available in resolved symbol
                        context: String::new(), // Context not available in resolved symbol
                    },
                    extra: extra.clone(),
                })
            }
        }
    }
}

// IDE Functions
#[derive(Deserialize)]
pub struct FindDefinition {
    pub symbol: Symbol,
}

impl<U: IpcClient> DialectFunction<U> for FindDefinition {
    type Output = Vec<ResolvedSymbol>;

    fn execute(self, interpreter: &mut DialectInterpreter<U>) -> anyhow::Result<Self::Output> {
        let resolved_symbol = self.symbol.resolve(interpreter)?;
        // For findDefinition, we return the resolved symbol itself (it represents the definition)
        Ok(vec![resolved_symbol])
    }
}

#[derive(Deserialize)]
pub struct FindReferences {
    pub symbol: Symbol,
}

impl<U: IpcClient> DialectFunction<U> for FindReferences {
    type Output = Vec<FileLocation>;

    fn execute(self, interpreter: &mut DialectInterpreter<U>) -> anyhow::Result<Self::Output> {
        let resolved_symbol = self.symbol.resolve(interpreter)?;
        interpreter.find_all_references(&resolved_symbol)
    }
}
