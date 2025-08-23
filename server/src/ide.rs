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

/// Search for regex patterns in files, respecting gitignore rules.
///
/// Examples:
/// - `{"search": {"path": "src/auth.rs", "regex": "fn\\s+\\w+"}}` - Find functions in specific file
/// - `{"search": {"path": "src/", "regex": "TODO|FIXME", "extension": ".rs"}}` - Find todos in Rust files
/// - `{"search": {"path": ".", "regex": "struct User\\b", "extension": "rs"}}` - Find User struct in Rust files
#[derive(Deserialize)]
pub struct Search {
    pub path: String,
    pub regex: String,
    pub extension: Option<String>,
}

impl<U: IpcClient> DialectFunction<U> for Search {
    type Output = Vec<FileRange>;

    const DEFAULT_FIELD_NAME: Option<&'static str> = None;

    async fn execute(
        self,
        _interpreter: &mut DialectInterpreter<U>,
    ) -> anyhow::Result<Self::Output> {
        use ignore::Walk;
        use regex::Regex;
        use std::path::Path;

        let regex = Regex::new(&self.regex)?;
        let mut results = Vec::new();
        let search_path = Path::new(&self.path);

        // Normalize extension (add dot if missing)
        let extension_filter = self.extension.as_ref().map(|ext| {
            if ext.starts_with('.') {
                ext.clone()
            } else {
                format!(".{}", ext)
            }
        });

        // If it's a specific file, search just that file
        if search_path.is_file() {
            results.extend(process_file(&self.path, &extension_filter, &regex));
        } else if search_path.is_dir() {
            // Directory search with gitignore support
            for result in Walk::new(&self.path) {
                let entry = result?;
                if entry.file_type().map_or(false, |ft| ft.is_file()) {
                    let path_str = entry.path().to_string_lossy().to_string();
                    results.extend(process_file(&path_str, &extension_filter, &regex));
                }
            }
        }
        // If path doesn't exist, just return empty results

        Ok(results)
    }
}

/// Generate git diffs for commit ranges, respecting exclude options.
///
/// Examples:
/// - `{"gitdiff": {"range": "HEAD^.."}}` - Changes in last commit
/// - `{"gitdiff": {"range": "HEAD~3..HEAD~1"}}` - Changes between specific commits  
/// - `{"gitdiff": {"range": "HEAD", "exclude_unstaged": true}}` - Only staged changes
#[derive(Deserialize)]
pub struct GitDiff {
    pub range: String,

    #[expect(dead_code)]
    pub exclude_unstaged: Option<bool>,

    #[expect(dead_code)]
    pub exclude_staged: Option<bool>,
}

impl<U: IpcClient> DialectFunction<U> for GitDiff {
    type Output = Vec<crate::synthetic_pr::FileChange>;

    const DEFAULT_FIELD_NAME: Option<&'static str> = None;

    async fn execute(
        self,
        _interpreter: &mut DialectInterpreter<U>,
    ) -> anyhow::Result<Self::Output> {
        use crate::synthetic_pr::git_service::GitService;

        // Use current directory as repo path (could be made configurable)
        let git_service = GitService::new(".")?;
        let (base_oid, head_oid) = git_service.parse_commit_range(&self.range)?;
        let file_changes = git_service.generate_diff(base_oid, head_oid)?;

        // TODO: Apply exclude filters for staged/unstaged changes
        // For now, return all changes
        Ok(file_changes)
    }
}

/// Create a comment at a specific location with optional icon and content.
///
/// Normalizes different location types (FileRange, SymbolDef, SymbolRef) into FileRange.
///
/// Examples:
/// - `{"comment": {"location": {"path": "src/main.rs", "start": {"line": 10, "column": 1}, "end": {"line": 10, "column": 20}}, "content": ["This needs refactoring"]}}`
/// - `{"comment": {"location": {"search": {"path": "src/", "regex": "fn main"}}, "icon": "warning", "content": ["Entry point"]}}`
#[derive(Deserialize)]
pub struct Comment {
    /// Location for the comment.
    pub location: ResolvedLocation,

    /// Optional icon.
    pub icon: Option<String>,

    /// Optional content.
    ///
    /// FIXME: These should be content elements.
    pub content: Vec<String>,
}

/// We accept either symbols or file ranges.
#[derive(Deserialize)]
#[serde(untagged)]
pub enum ResolvedLocation {
    FileRange(FileRange),
    SearchResults(Vec<FileRange>),
    SymbolDefs(Vec<SymbolDef>),
}

/// The fully normalized struct that we send over IPC.
#[derive(Serialize)]
pub struct ResolvedComment {
    pub locations: Vec<FileRange>,
    pub icon: Option<String>,
    pub content: Vec<String>,
}

impl<U: IpcClient> DialectFunction<U> for Comment {
    type Output = ResolvedComment;

    const DEFAULT_FIELD_NAME: Option<&'static str> = None;

    async fn execute(
        self,
        _interpreter: &mut DialectInterpreter<U>,
    ) -> anyhow::Result<Self::Output> {
        // Normalize different location types to a Vec<FileRange>
        let locations = match self.location {
            ResolvedLocation::FileRange(range) => vec![range],
            ResolvedLocation::SymbolDefs(def) => def.iter().map(|d| d.defined_at.clone()).collect(),
            ResolvedLocation::SearchResults(results) => results,
        };

        if locations.is_empty() {
            return Err(anyhow::anyhow!("Location resolved to empty search results"));
        }

        Ok(ResolvedComment {
            locations,
            icon: self.icon,
            content: self.content,
        })
    }
}

fn search_file_content(file_path: &str, content: &str, regex: &regex::Regex) -> Vec<FileRange> {
    let mut results = Vec::new();
    for (line_num, line) in content.lines().enumerate() {
        if let Some(mat) = regex.find(line) {
            results.push(FileRange {
                path: file_path.to_string(),
                start: FileLocation {
                    line: (line_num + 1) as u32,
                    column: (mat.start() + 1) as u32,
                },
                end: FileLocation {
                    line: (line_num + 1) as u32,
                    column: (mat.end() + 1) as u32,
                },
                content: Some(line.to_string()),
            });
        }
    }
    results
}

fn matches_extension(file_path: &str, extension_filter: &Option<String>) -> bool {
    match extension_filter {
        Some(ext) => file_path.ends_with(ext),
        None => true,
    }
}

fn process_file(
    file_path: &str,
    extension_filter: &Option<String>,
    regex: &regex::Regex,
) -> Vec<FileRange> {
    if matches_extension(file_path, extension_filter) {
        if let Ok(content) = std::fs::read_to_string(file_path) {
            return search_file_content(file_path, &content, regex);
        }
    }
    Vec::new()
}

/// Create an interactive action button for walkthroughs.
///
/// Examples:
/// - `{"action": {"button": "Run Tests"}}`
/// - `{"action": {"button": "Generate", "tell_agent": "Generate user authentication boilerplate"}}`
#[derive(Deserialize)]
pub struct Action {
    /// Button text
    pub button: String,
    
    /// Optional text to send to agent when clicked
    pub tell_agent: Option<String>,
}

#[derive(Serialize)]
pub struct ResolvedAction {
    pub button: String,
    pub tell_agent: Option<String>,
}

impl<U: IpcClient> DialectFunction<U> for Action {
    type Output = ResolvedAction;

    const DEFAULT_FIELD_NAME: Option<&'static str> = None;

    async fn execute(
        self,
        _interpreter: &mut DialectInterpreter<U>,
    ) -> anyhow::Result<Self::Output> {
        // Action is already resolved, just pass through
        Ok(ResolvedAction {
            button: self.button,
            tell_agent: self.tell_agent,
        })
    }
}

/// Resolved walkthrough types for IPC communication with VSCode extension

#[derive(Serialize)]
pub struct ResolvedWalkthrough {
    pub introduction: Option<Vec<ResolvedWalkthroughElement>>,
    pub highlights: Option<Vec<ResolvedWalkthroughElement>>,
    pub changes: Option<Vec<ResolvedWalkthroughElement>>,
    pub actions: Option<Vec<ResolvedWalkthroughElement>>,
}

#[derive(Serialize)]
#[serde(untagged)]
pub enum ResolvedWalkthroughElement {
    /// Plain markdown text
    Markdown(String),
    /// Comment placed at specific locations
    Comment(ResolvedComment),
    /// Git diff display
    GitDiff(Vec<crate::synthetic_pr::FileChange>),
    /// Action button
    Action(ResolvedAction),
}
