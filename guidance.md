# AI Assistant Guidelines for Dialectic

## When to Present Reviews

Call `present_review` after making significant code changes when:
- You've implemented a feature or made substantial modifications
- The user asks for a review or explanation of changes
- You've completed a logical unit of work that warrants documentation

**Don't** call for minor fixes, work-in-progress changes, or every individual file modification.

## Review Structure

### Write as Code Tours
Structure reviews as guided tours through specific code locations. Lead with the code reference, then explain what's happening there and why it matters. Order sections to follow the logical flow of operations, not file order.

### Include Context and Reasoning
Explain not just what changed, but why:
- Design decisions and trade-offs made
- Alternative approaches considered  
- Known limitations or future improvements needed

### Use Consistent Structure
- **Summary** - High-level overview suitable for commit message
- **Implementation Walkthrough** - Narrative code tour
- **Design Decisions** - Rationale for key choices
- **Next Steps** - Future considerations

## Code References

**CRITICAL**: Use [`filename:line`][] format for all code references:
- [`src/auth.ts:23`][] - Points to specific line
- [`README.md:1`][] - Points to file beginning

This renders as clickable links in VSCode and aligns with rustdoc conventions.

## Update Modes
- `replace` (default) - Complete review rewrite
- `update-section` - Modify specific section (specify section header)  
- `append` - Add new content to existing review

## Sample Review

```markdown
# Add comprehensive error handling to user registration

## Summary
Enhanced user registration endpoint with proper validation, duplicate detection, 
and structured error responses for better client integration.

## Code Tour

### Input Validation [`src/routes/auth.ts:34`][]

Here we validate email format, password strength, and required fields before 
processing the registration. Invalid inputs return structured error responses 
with specific field-level feedback rather than generic "validation failed" 
messages to improve UX.

### Duplicate Detection [`src/models/user.ts:89`][]

This query checks for existing accounts before creating new users. Running this 
check before password hashing avoids unnecessary computation on duplicate attempts 
and provides better performance for the common case of legitimate registrations.

### Error Response Handling [`src/routes/auth.ts:67`][]

Database operations are wrapped in try-catch blocks with specific handling for 
constraint violations, connection issues, and unexpected failures. Each error 
type returns appropriate HTTP status codes with consistent `{error, message, details}` 
structure across all endpoints.

## Design Decisions

- **Early duplicate detection**: Checks email uniqueness before expensive bcrypt hashing
- **Structured error format**: Consistent response shape for easier client handling

## Next Steps

- Add rate limiting for registration attempts
- Implement email verification workflow
```
