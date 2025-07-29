# AI Assistant Guidelines for Dialectic

## When to Offer Reviews

Ask "Should I create a review for these changes?" when you've:
- Made multiple edits for a cohesive change
- Implemented a complete user-facing feature
- Made architectural changes that affect multiple components
- Completed work the user explicitly requested

**Examples:**
- ✅ "I've added authentication with login/logout/middleware across 4 files. Should I create a review?"
- ✅ "The user registration flow is now complete. Should I create a review?"
- ❌ Don't offer reviews for single-line fixes, typo corrections, or work-in-progress changes

Let the user decide whether to proceed with the review. This keeps them in control while surfacing appropriate opportunities.

**Always include `baseUri`**: The `baseUri` parameter is required and should be set to the project directory path to ensure file references resolve properly as clickable links.

## Review Structure

Write as guided code tours using `dialectic:` scheme references that render as clickable links in VSCode. Use search-based references for resilient navigation that stays valid as code evolves.

**Reference Formats:**
- `dialectic:src/auth.ts?regex=validateToken` - Regex pattern for function/variable names
- `dialectic:src/auth.ts?line=42` - Navigate to specific line
- `dialectic:src/auth.ts?regex=handleError&line=100-200` - Regex search within line range
- [`filename:line`][] - Legacy format (auto-converted to dialectic: scheme)

**Why this format matters:** The `dialectic:` scheme creates resilient references that remain valid as code changes. Regex-based references are powerful enough to handle both simple literal matches and complex patterns.

Lead with the code location, then explain what's happening there and why it matters. Order sections to follow the logical flow of operations, not file order.

Structure: **Summary** → **Code Tour** → **Design Decisions** → **Next Steps**

## Sample Review

```markdown
# Add user input validation

## Summary  
Enhanced registration with email validation and structured error responses for better client integration.

## Areas you should check

This section includes key decisions that I made along the way or places I was unsure.
You may wish to review these or double check my logic!

* [Email validation logic](dialectic:src/auth.ts?regex=validateEmail) -- I chose to use regex validation instead of a library
* [Thread pool sizing](dialectic:src/auth.ts?regex=maxThreads) -- I opted to use a max of 3 threads for processing to not overload the CPU
* [Error response format](dialectic:src/auth.ts?regex=FileNotFound) -- I included a customized response for `FileNotFound` errors, as you requested

## Code Tour

### Input Validation [here](dialectic:src/auth.ts?regex=validateInput)
Validates email format and password strength before processing. Returns field-specific errors rather than generic "validation failed" messages to improve UX and help users understand exactly what needs to be fixed.

### Error Handling [check this](dialectic:src/auth.ts?regex=handleDatabaseError)
Database operations wrapped in try-catch with specific handling for constraint violations and connection issues. Each error type returns appropriate HTTP status codes with consistent `{error, message, details}` structure.

## Next Steps
- Add rate limiting for registration attempts
- Implement email verification workflow
```

## Update Modes
- `replace` (default) - Complete review rewrite
- `update-section` - Modify specific section (specify section header)  
- `append` - Add new content to existing review
