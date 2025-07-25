# Quick Start

This guide walks you through a typical Dialectic workflow.

## 1. Make Code Changes

Work with your AI assistant as usual to make code changes to your project. Enable auto-accept edits to avoid interruptions.

```
You: "Add a user authentication system"
AI: [Makes changes to multiple files]
```

## 2. Request a Review

Ask your AI assistant to present a review of the changes:

```
You: "Present a review of what you just implemented"
```

## 3. View the Review

The review appears in the Dialectic panel in VSCode's sidebar. The review is structured as a markdown document with sections explaining:

- What was implemented and why
- How the code works (narrative walkthrough)
- Key design decisions
- Code references with clickable links

## 4. Navigate the Code

Click on any file:line reference in the review to jump directly to that location in your editor. The references stay current even as you make further changes.

## 5. Continue the Conversation

Discuss the implementation with your AI assistant in the terminal as normal:

```
You: "I think the error handling in the login function could be improved"
AI: "Good point! Let me refactor that and update the review"
```

The review automatically updates to reflect the changes.

## 6. Create a Commit (Optional)

When you're satisfied with the changes, use the "Create Commit" button in the review panel. The review content becomes your commit message, preserving the reasoning and context for future reference.