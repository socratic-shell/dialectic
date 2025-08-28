# Walkthrough Format Specification

*This chapter defines the markdown+XML format for code walkthroughs.*

## Example Walkthrough

Here's a complete walkthrough showing the authentication system changes:

```markdown
# Authentication System Updates

We've refactored the token validation system to improve performance and security.

## System architecture

The new validation architecture works as follows:

<mermaid>
flowchart TD
    A[Client Request] --> B{Token Valid?}
    B -->|Check Expiration First| C[Validate Expiration]
    C -->|Expired| D[Return 401]
    C -->|Valid| E[Validate Signature]
    E -->|Invalid| D
    E -->|Valid| F[Process Request]
</mermaid>

## Key Changes

The main improvement is in how we handle token expiration:

<comment location="findDefinition(`validateToken`)" icon="lightbulb">
This function now checks expiration before signature validation. This avoids expensive 
cryptographic operations on tokens that are already expired.
</comment>

We also updated the login flow to use shorter-lived tokens by default:

<comment location="search(`src/auth.rs`, `async fn login`)">
The default token lifetime is now 1 hour instead of 24 hours. Users can still 
request longer-lived tokens through the `remember_me` parameter.
</comment>

## What Changed

Here are all the files that were modified:

<gitdiff range="HEAD~2..HEAD" />

## Next Steps

<action button="Test the changes">
Run the authentication test suite to verify the changes work correctly.
</action>

<action button="Update documentation">
The API documentation needs to reflect the new default token lifetime.
</action>
```

This walkthrough combines regular markdown with specialized XML elements: `<mermaid>`, `<comment>`, `<gitdiff>`, and `<action>`.

## XML Elements

### Mermaid

Render mermaid graphs and diagrams to visualize architecture, flows, or relationships:

```xml
<mermaid>
flowchart TD
    A[Start] --> B{Decision}
    B -->|Yes| C[Action 1]
    B -->|No| D[Action 2]
</mermaid>
```

**Use when:** Explaining system architecture, data flow, or complex relationships that benefit from visual representation.

### Comments

Place contextual comments at specific code locations to highlight important details, decisions, or areas needing attention:

```xml
<comment location="DIALECT_EXPRESSION" icon="question">
Markdown content explaining this code location.
Can include **formatting** and [links](https://example.com).
</comment>
```

**Attributes:**
- `location` (required) - Dialect expression that resolves to code location(s). Common examples:
  - `findDefinition("validateToken")` -- definition of a function/class/variable
  - `findReferences("User")` -- all references to a symbol
  - `search("src/auth.rs", "impl.*Token")` -- regex search in specific file
  - `search("src", "fn login", ".rs")` -- search directory for pattern in .rs files
  - `lines("src/auth.rs", 42, 45)` -- specific line range (use sparingly, prefer search)
- `icon` (optional) - VSCode codicon name (e.g., `question`, `lightbulb`, `warning`)

**Content:** Markdown text explaining the code, highlighting decisions, or noting areas for review.

**Use when:** 
- Explaining complex logic or algorithms
- Highlighting important design decisions
- Pointing out potential issues or areas for improvement
- Providing context that isn't obvious from the code

### Git Diffs

Embed git diffs showing code changes:

```xml
<gitdiff range="HEAD~2..HEAD" />
<gitdiff range="abc123" exclude-unstaged exclude-staged />
```

**Attributes:**
- `range` (required) - Git commit range or single commit
- `exclude-unstaged` (optional) - Exclude unstaged changes when range includes HEAD
- `exclude-staged` (optional) - Exclude staged changes when range includes HEAD

**Content:** Self-closing element that renders as interactive diff tree

**Use when:** Showing what files changed and providing context for the modifications. Keep ranges focused (1-3 commits typically) to avoid overwhelming users.

### Actions

Provide interactive buttons for user actions:

```xml
<action button="Fix the validation logic">
How should I handle expired tokens differently?
</action>
```

**Attributes:**
- `button` (required) - Text displayed on the button

**Content:** Message sent to AI assistant when button is clicked

**Use when:** 
- Suggesting next steps or follow-up tasks
- Offering to help with related work
- Providing quick access to common questions
- **Not for:** Simple navigation (use comments with links instead)

## Dialect Location Expressions

Dialect expressions in `location` attributes target specific code locations. Here are the main functions:

### Symbol-based targeting
```xml
<!-- Find where a symbol is defined -->
<comment location="findDefinition(`MyClass`)">

<!-- Find all references to a symbol -->
<comment location="findReferences(`validateToken`)">
```

### Search-based targeting
```xml
<!-- Search specific file for pattern -->
<comment location="search(`src/auth.rs`, `async fn`)">

<!-- Search directory for pattern in specific file types -->
<comment location="search(`src`, `struct.*User`, `.rs`)">

<!-- Search all files in directory -->
<comment location="search(`tests`, `#\[test\]`)">
```

### Line-based targeting
```xml
<!-- Target specific line range (use sparingly) -->
<comment location="lines(`src/main.rs`, 10, 15)">
```

**Best practices:**
- Prefer `search()` over `lines()` - more resilient to code changes
- Use specific patterns in search to avoid too many matches
- Test expressions to ensure they find the intended locations
- If multiple matches, users will get a disambiguation dialog

## Content Guidelines

### Effective Comments
**Good comments:**
- Explain *why* something was implemented this way
- Highlight non-obvious design decisions
- Point out potential gotchas or edge cases
- Provide context that helps understand the broader system

**Avoid:**
- Simply describing what the code does (code should be self-documenting)
- Repeating information obvious from variable/function names
- Generic praise ("This is good code")

### Walkthrough Structure
**Recommended flow:**
1. **Introduction** - Brief overview of what changed and why
2. **Architecture/Overview** - Mermaid diagrams for complex changes
3. **Key Changes** - Comments on the most important modifications
4. **Supporting Changes** - Git diffs and additional context
5. **Next Steps** - Actions for follow-up work

### When to Use Each Element
- **Mermaid:** Complex systems, data flows, state machines
- **Comments:** Specific code explanations, design decisions, review points
- **Git diffs:** Showing scope of changes, file-level context
- **Actions:** Next steps, follow-up questions, related tasks
