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

This walkthrough combines regular markdown with specialized XML elements: ``<mermaid>`, `<comment>`, `<gitdiff>`, and `<action>`.

## XML Elements

### Mermaid

Render mermaid graphs and diagrams

```xml
<mermaid>
... mermaid content here ...
</mermaid>
```

### Comments

Place contextual comments at specific code locations:

```xml
<comment location="DIALECT_EXPRESSION" icon="question">
Markdown content explaining this code location.
Can include **formatting** and [links](https://example.com).
</comment>
```

**Attributes:**
- `location` (required) - Dialect expression that resolves to code location(s). A full explanation of Dialect is below, but common examples include:
  - `findDefinitions("name")` -- definition(s) of a symbol
  - `findReferences("name")` -- reference(s) to a symbol
  - `search("src/foo.rs", "impl.*Foo")` -- search a file for the given regular expression
  - `lines("src/foo.rs", 1, 5)` -- select lines from a given file (this is hard to get right, prefer to use search)
  - `search("src", "fn foo", ".rs")` -- search a directory for files that contain the given regex and have the given extension
- `icon` (optional) - VSCode codicon name (e.g., `question`, `lightbulb`, `warning`)

**Content:** Markdown text that will be rendered in VSCode comment threads

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
