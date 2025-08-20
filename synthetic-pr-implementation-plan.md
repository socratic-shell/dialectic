# Synthetic PR Implementation Plan

## Overview

Transform Dialectic into an LLM-powered synthetic pull request system that creates familiar PR review workflows for AI-generated code changes, working entirely with local Git state.

## Core Workflow

1. **LLM Code Generation**: AI assistant makes file changes during conversation
2. **Review Request**: LLM calls `request_review()` MCP tool with commit range and description
3. **Synthetic PR Creation**: Rust server generates PR-like review from Git diffs + AI comments
4. **Familiar Review Interface**: VSCode displays PR using CommentController API with approve/request changes
5. **Feedback Loop**: User interactions return to LLM via `update_review()` tool for iteration

## Architecture Validation

**VSCode Git Extension API Research Findings:**
- ❌ No `diffBetween(commit1, commit2)` method for arbitrary commit ranges
- ❌ No structured file change data with statistics (+15 -3)  
- ❌ No native commit range parsing (HEAD~2..HEAD)
- ❌ No multi-file PR review interface
- ✅ Good for single file diffs, basic repo operations, UI integration

**Production Extension Reality:**
All major extensions (GitHub PR, GitLens, GitLab) use **hybrid approach** - VSCode APIs for UI integration, custom Git operations for complex diff generation.

**Validated Architecture Decision:**
Our Rust git2 + TypeScript UI approach aligns with production patterns. Rust handles the complex Git operations that VSCode's API cannot provide, while TypeScript leverages VSCode's excellent UI infrastructure.

## Architecture Split

### Rust MCP Server (Cross-IDE Logic)
- **Git Operations**: Use `git2` library for diff generation, commit range parsing
- **AI Comment Parsing**: Extract 💡 explanations, ❓ questions, TODO/FIXME from code files
- **PR State Management**: Store review metadata in `.socratic-shell-review.json`
- **MCP Tools**: Implement `request_review()` and `update_review()` with blocking feedback pattern
- **Cross-IDE Data**: Generate structured review data any IDE can consume

### TypeScript Extension (VSCode-Specific UI)
- **CommentController**: Create comment threads at specific file locations
- **TreeDataProvider**: PR navigation sidebar showing files changed, review status
- **WebView Panels**: Detailed PR interface with approve/request changes buttons
- **VSCode Diff Integration**: Use `vscode.diff` command and `toGitUri()` for single-file diffs
- **User Interaction Handling**: Capture review actions, send feedback to Rust server
- **Basic Git Extension API**: Repository discovery, file content retrieval, simple operations

## Key Data Structures

```rust
struct ReviewState {
    review_id: String,
    title: String,
    description: serde_json::Value,  // Opaque JSON for maximum LLM flexibility
    commit_range: String,           // "HEAD", "HEAD~2", "abc123..def456"
    status: ReviewStatus,           // Pending, ChangesRequested, Approved, Merged
    files_changed: Vec<FileChange>,
    comment_threads: Vec<CommentThread>,
    created_at: DateTime<Utc>,
}

struct CommentThread {
    thread_id: String,
    file_path: String,
    line_number: u32,
    comment_type: CommentType,      // Explanation, Question, Todo, Fixme
    content: String,
    responses: Vec<UserResponse>,
}
```

## MCP Tool Interface

### request_review
```json
{
  "commit_range": "HEAD~2",
  "title": "Add authentication system", 
  "description": {
    "summary": "Implemented JWT-based auth with middleware",
    "changes": ["Added JWT validation", "Created auth middleware", "Updated user model"],
    "reasoning": "Chose JWT over sessions for stateless API design"
  }
}
```

**Response**: Review ID, files changed, comment threads for IDE to render

### update_review  
```json
{
  "review_id": "pr-abc123",
  "action": "wait_for_feedback"
}
```

**Response**: Blocks until user provides feedback, returns structured user actions

## AI Comment Types

- **💡 Explanations**: "Using JWT instead of sessions for stateless design"
- **❓ Questions**: "Should we add rate limiting here?"  
- **TODO**: Standard TODO comments for future work
- **FIXME**: Issues that need addressing

## Implementation Phases

### Phase 1: Core Rust Server
- [ ] **Set up git2 integration** - Add git2 dependency, implement Repository wrapper
- [ ] **Commit range parsing** - Parse HEAD~2, abc123..def456, branch names to git2 Oid objects  
- [ ] **Diff generation with file stats** - Use git2 to generate structured diffs with +/- counts
- [ ] **AI comment parsing** - Regex-based extraction of 💡❓TODO/FIXME from source files
- [ ] **Review state management** - JSON serialization to `.socratic-shell-review.json`
- [ ] **Basic MCP tools** - `request_review()` and `update_review()` with blocking pattern

### Phase 2: VSCode Integration  
- [ ] Create CommentController for review interface
- [ ] Implement TreeDataProvider for PR navigation
- [ ] Build user interaction handlers (approve/request changes)
- [ ] Connect MCP client to Rust server

### Phase 3: Advanced Features
- [ ] WebView panels for detailed PR interface
- [ ] Support for review iterations and comment threads
- [ ] Integration with existing Dialectic review system
- [ ] Cross-IDE compatibility testing

## Phase 1 Rust Implementation Sketch

### Cargo.toml Dependencies
```toml
[dependencies]
git2 = "0.18"
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"
tokio = { version = "1.0", features = ["full"] }
uuid = { version = "1.0", features = ["v4"] }
regex = "1.0"
chrono = { version = "0.4", features = ["serde"] }
```

### Core Git Operations Module
```rust
use git2::{Repository, Oid, DiffOptions, DiffFormat};

pub struct GitService {
    repo: Repository,
}

impl GitService {
    pub fn new(repo_path: &str) -> Result<Self, git2::Error> {
        let repo = Repository::open(repo_path)?;
        Ok(Self { repo })
    }
    
    pub fn parse_commit_range(&self, range: &str) -> Result<(Oid, Oid), git2::Error> {
        match range {
            "HEAD" => {
                let head = self.repo.head()?.target().unwrap();
                Ok((head, head)) // Will compare with working tree
            }
            range if range.starts_with("HEAD~") => {
                let n: usize = range[5..].parse().unwrap_or(1);
                let head = self.repo.head()?.target().unwrap();
                let commit = self.repo.find_commit(head)?;
                let ancestor = commit.parent(n - 1)?.id();
                Ok((ancestor, head))
            }
            range if range.contains("..") => {
                let parts: Vec<&str> = range.split("..").collect();
                let base_oid = self.repo.revparse_single(parts[0])?.id();
                let head_oid = self.repo.revparse_single(parts[1])?.id();
                Ok((base_oid, head_oid))
            }
            _ => {
                // Single commit reference
                let oid = self.repo.revparse_single(range)?.id();
                let commit = self.repo.find_commit(oid)?;
                let parent_oid = commit.parent(0)?.id();
                Ok((parent_oid, oid))
            }
        }
    }
    
    pub fn generate_diff(&self, base_oid: Oid, head_oid: Oid) -> Result<Vec<FileChange>, git2::Error> {
        let base_tree = self.repo.find_commit(base_oid)?.tree()?;
        let head_tree = self.repo.find_commit(head_oid)?.tree()?;
        
        let mut diff_opts = DiffOptions::new();
        diff_opts.include_untracked(true);
        
        let diff = self.repo.diff_tree_to_tree(Some(&base_tree), Some(&head_tree), Some(&mut diff_opts))?;
        
        let mut file_changes = Vec::new();
        
        diff.foreach(
            &mut |delta, _progress| {
                if let Some(new_file) = delta.new_file().path() {
                    file_changes.push(FileChange {
                        path: new_file.to_string_lossy().to_string(),
                        status: match delta.status() {
                            git2::Delta::Added => ChangeStatus::Added,
                            git2::Delta::Deleted => ChangeStatus::Deleted,
                            git2::Delta::Modified => ChangeStatus::Modified,
                            _ => ChangeStatus::Modified,
                        },
                        additions: 0, // Will be filled by line-level diff
                        deletions: 0,
                    });
                }
                true
            },
            None,
            None,
            None,
        )?;
        
        // Get line-level stats
        for file_change in &mut file_changes {
            let stats = self.get_file_stats(&diff, &file_change.path)?;
            file_change.additions = stats.0;
            file_change.deletions = stats.1;
        }
        
        Ok(file_changes)
    }
}
```

### AI Comment Parser Module
```rust
use regex::Regex;

pub struct CommentParser {
    lightbulb_regex: Regex,
    question_regex: Regex,
    todo_regex: Regex,
    fixme_regex: Regex,
}

impl CommentParser {
    pub fn new() -> Self {
        Self {
            lightbulb_regex: Regex::new(r"//\s*💡\s*(.+)").unwrap(),
            question_regex: Regex::new(r"//\s*❓\s*(.+)").unwrap(),
            todo_regex: Regex::new(r"//\s*TODO:\s*(.+)").unwrap(),
            fixme_regex: Regex::new(r"//\s*FIXME:\s*(.+)").unwrap(),
        }
    }
    
    pub fn parse_file(&self, file_path: &str) -> Result<Vec<CommentThread>, std::io::Error> {
        let content = std::fs::read_to_string(file_path)?;
        let mut threads = Vec::new();
        
        for (line_num, line) in content.lines().enumerate() {
            if let Some(comment) = self.extract_comment(line) {
                threads.push(CommentThread {
                    thread_id: uuid::Uuid::new_v4().to_string(),
                    file_path: file_path.to_string(),
                    line_number: line_num as u32 + 1,
                    comment_type: comment.comment_type,
                    content: comment.content,
                    responses: vec![],
                });
            }
        }
        
        Ok(threads)
    }
    
    fn extract_comment(&self, line: &str) -> Option<ParsedComment> {
        if let Some(caps) = self.lightbulb_regex.captures(line) {
            Some(ParsedComment {
                comment_type: CommentType::Explanation,
                content: caps[1].trim().to_string(),
            })
        } else if let Some(caps) = self.question_regex.captures(line) {
            Some(ParsedComment {
                comment_type: CommentType::Question,
                content: caps[1].trim().to_string(),
            })
        } else if let Some(caps) = self.todo_regex.captures(line) {
            Some(ParsedComment {
                comment_type: CommentType::Todo,
                content: caps[1].trim().to_string(),
            })
        } else if let Some(caps) = self.fixme_regex.captures(line) {
            Some(ParsedComment {
                comment_type: CommentType::Fixme,
                content: caps[1].trim().to_string(),
            })
        } else {
            None
        }
    }
}
```

### MCP Tool Implementation
```rust
use serde_json::Value;

pub async fn request_review(params: Value) -> Result<Value, Box<dyn std::error::Error>> {
    let commit_range = params["commit_range"].as_str().unwrap_or("HEAD");
    let title = params["title"].as_str().unwrap_or("Code Review");
    let description = params["description"].clone();
    
    // Initialize services
    let git_service = GitService::new(".")?;
    let comment_parser = CommentParser::new();
    
    // Parse commit range and generate diff
    let (base_oid, head_oid) = git_service.parse_commit_range(commit_range)?;
    let file_changes = git_service.generate_diff(base_oid, head_oid)?;
    
    // Parse AI comments from changed files
    let mut comment_threads = Vec::new();
    for file_change in &file_changes {
        if file_change.status != ChangeStatus::Deleted {
            let threads = comment_parser.parse_file(&file_change.path)?;
            comment_threads.extend(threads);
        }
    }
    
    // Create review state
    let review = ReviewState {
        review_id: uuid::Uuid::new_v4().to_string(),
        title: title.to_string(),
        description,
        commit_range: commit_range.to_string(),
        status: ReviewStatus::Pending,
        files_changed: file_changes,
        comment_threads,
        created_at: chrono::Utc::now(),
        updated_at: chrono::Utc::now(),
    };
    
    // Save to .socratic-shell-review.json
    save_review_state(&review)?;
    
    // Return response for VSCode extension
    Ok(serde_json::json!({
        "review_id": review.review_id,
        "files_changed": review.files_changed,
        "comment_threads": review.comment_threads,
        "status": "success"
    }))
}

pub async fn update_review(params: Value) -> Result<Value, Box<dyn std::error::Error>> {
    let review_id = params["review_id"].as_str().unwrap();
    let action = params["action"].as_str().unwrap();
    
    match action {
        "wait_for_feedback" => {
            // Block until VSCode extension provides user feedback
            let feedback = wait_for_user_feedback(review_id).await?;
            Ok(feedback)
        }
        "add_comment" => {
            // Add new comment thread to existing review
            add_comment_thread(review_id, &params["comment"])?;
            Ok(serde_json::json!({"status": "comment_added"}))
        }
        _ => Err("Unknown action".into())
    }
}

fn save_review_state(review: &ReviewState) -> Result<(), std::io::Error> {
    let json = serde_json::to_string_pretty(review)?;
    std::fs::write(".socratic-shell-review.json", json)?;
    Ok(())
}
```

## Cross-IDE Vision

The Rust server becomes a universal "review engine" that any IDE can consume:

- **Neovim**: Lua plugin displays comments as virtual text
- **IntelliJ**: Kotlin plugin integrates with annotation system
- **Emacs**: Elisp package shows comments in margins
- **VSCode**: Full PR interface with CommentController

Each IDE gets a thin adapter extension that translates MCP protocol to IDE-specific APIs.

## Technical Benefits

- **Familiar Workflow**: Leverages existing PR review mental models
- **Local Operation**: No remote Git repositories required
- **Cross-Platform**: Rust server works on any platform
- **IDE Agnostic**: Same review engine for multiple editors
- **Self-Documenting**: AI explanations attached to specific code lines
- **Iterative**: Natural request/response cycle for code refinement

## Next Steps

1. Research VSCode PR Provider APIs ✅
2. Create tracking issue for project ✅  
3. Begin Phase 1 implementation with basic Rust server
4. Prototype MCP tool interface
5. Build minimal VSCode extension for testing
