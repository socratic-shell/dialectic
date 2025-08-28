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

## Overview

Walkthroughs use a hybrid format combining markdown content with embedded XML elements for interactive features. The format consists of:

- **Markdown content** - Standard markdown for documentation text
- **XML elements** - Structured elements for comments, diffs, and actions
- **Dialect expressions** - Code location targeting within XML attributes

## XML Elements

### Comments

Place contextual comments at specific code locations:

```xml
<comment location="DIALECT_EXPRESSION" icon="question">
Markdown content explaining this code location.
Can include **formatting** and [links](https://example.com).
</comment>
```

**Attributes:**
- `location` (required) - Dialect expression that resolves to code location(s)
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

## Dialect Location Expressions

The `location` attribute in `<comment>` elements accepts Dialect expressions that resolve to code locations:

### Current Capabilities

**Search-based locations:**
```xml
<comment location="search('src/auth.rs', 'fn validate_token')">
<comment location="search('src/', 'struct User')">
```

**Symbol-based locations:**
```xml
<comment location="findDefinition('TokenValidator')">
<comment location="findReferences('validate_token')">
```

**Exact positions:**
```xml
<comment location="range('src/auth.rs', 42)">
<comment location="range('src/auth.rs', 42, 15)">
```

### Future Enhancements

**Chained method calls** (see [issue #34](https://github.com/socratic-shell/dialectic/issues/34)):
```xml
<comment location="findDefinition(`User`).methods().named(`validate`)">
<comment location="search(`*.rs`, `TODO:`).limit(5).inFile(`auth`)">
```

## Processing Pipeline

1. **Parse markdown** - Extract XML elements while preserving surrounding content
2. **Execute Dialect** - Resolve `location` attributes to specific file positions
3. **Generate resolved walkthrough** - Convert to internal `ResolvedWalkthrough` format
4. **Render in VSCode** - Display markdown content with interactive elements

## Location Resolution

When a Dialect expression in a `location` attribute resolves to:

- **Single location** - Comment placed automatically
- **Multiple locations** - User prompted to choose via QuickPick dialog
- **No locations** - Error displayed, comment not placed
- **Invalid expression** - Dialect execution error shown

## Ambiguous Location Handling

For comments with multiple possible locations:

1. **Initial click** - Shows disambiguation dialog with file:line options
2. **User selects** - Comment placed at chosen location, sidebar updates to show selection
3. **Re-click** - Shows relocation dialog with current location marked as "(current)"
4. **Different selection** - Comment moved to new location

## Migration from JSON Format

The new format replaces the previous JSON structure:

**Old (JSON Dialect program):**
```json
{
  "introduction": ["Markdown content"],
  "highlights": [
    {
      "comment": {
        "content": ["Comment text"],
        "location": {"search": {"path": "file.rs", "regex": "pattern"}}
      }
    }
  ],
  "changes": [
    {"gitdiff": {"commit_range": "HEAD~1..HEAD"}}
  ],
  "actions": [
    {"action": {"button": "Text", "tell_agent": "Message"}}
  ]
}
```

**New (Markdown+XML):**
```markdown
# Title

Markdown content

<comment location="search('file.rs', 'pattern')">
Comment text
</comment>

<gitdiff range="HEAD~1..HEAD" />

<action button="Text">Message</action>
```

## Implementation Notes

### Parsing Strategy
- Use regex or XML parser to extract elements from markdown
- Preserve line numbers for error reporting
- Handle nested markdown within XML element content

### Security Considerations
- Sanitize Dialect expressions before execution
- Validate XML structure and attributes
- Escape user content in generated HTML

### Error Handling
- Invalid Dialect expressions show user-friendly errors
- Malformed XML elements are treated as plain text
- Missing required attributes generate warnings

### Performance
- Cache Dialect execution results for repeated locations
- Lazy-load git diff content for large ranges
- Debounce location resolution for rapid changes

## Future Extensions

### Additional Elements
```xml
<mermaid>
graph TD; A-->B; B-->C;
</mermaid>

<code language="rust">
fn example() {
    println!("Embedded code example");
}
</code>

<image src="diagram.png" alt="Architecture diagram" />
```

### Conditional Content
```xml
<comment location="findDefinition(`DEBUG_MODE`)" if="config.debug">
This debug code should be removed before production.
</comment>
```

This format supports interactive code walkthroughs with embedded comments, diffs, and actions.
