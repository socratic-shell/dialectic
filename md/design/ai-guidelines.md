# AI Assistant Guidelines

*This chapter defines how AI assistants should effectively use the Dialectic system. This content will eventually be incorporated into user installation instructions.*

## When to Present Reviews

Call `present-review` after making significant code changes when:
- You've implemented a feature or made substantial modifications
- The user asks for a review or explanation of changes
- You've completed a logical unit of work that warrants documentation

**Don't** call `present-review` for:
- Minor single-line fixes or typos
- Work-in-progress changes that aren't ready for review
- Every individual file modification during active development

## Review Structure Guidelines

### Use Narrative Style
Write reviews as guided tours through the code, not just lists of changes:

**Good**: "When a user logs in (auth.ts:23), we first validate their credentials against the database. If successful, we generate a JWT token (auth.ts:45) and store the session..."

**Poor**: "Modified auth.ts lines 23-50. Added login function. Updated token generation."

### Include Context and Reasoning
Explain not just what changed, but why:
- Design decisions and trade-offs made
- Alternative approaches considered
- Known limitations or future improvements needed

### Structure with Clear Sections
Use consistent markdown structure:
- **Summary** - High-level overview
- **Implementation Walkthrough** - Narrative code tour  
- **Design Decisions** - Rationale for key choices
- **Next Steps** - Future considerations

## Code References

Use `file:line` format for all code references:
- `src/auth.ts:23` - Points to specific line
- `README.md:1` - Points to file beginning
- Include context about what the reference shows

*TODO: Add guidelines for referencing ranges, functions, classes*

## Update Modes

### replace
Use for complete review rewrites when:
- The changes are too extensive for incremental updates
- The review structure needs significant reorganization

### update-section  
Use to modify specific parts when:
- Only certain components changed
- You want to preserve other sections unchanged
- Specify the section header to update

### append
Use to add new content when:
- Adding information about additional changes
- Including follow-up notes or discoveries

## Best Practices

*TODO: Expand with specific examples and anti-patterns*

- Keep line references current by updating them as you make further changes
- Use descriptive section headers that make navigation easy
- Balance detail with readability - explain complex logic but don't over-document obvious code
- Include rationale for non-obvious design choices

## Common Pitfalls

*TODO: Document common mistakes and how to avoid them*

## Integration with Socratic Shell

This tool works best within the collaborative patterns established by the socratic shell project:
- Use reviews to facilitate dialogue, not just report status
- Encourage questions and iteration rather than assuming first implementations are final
- Preserve the reasoning process for future reference