# Introduction

Dialectic is a VSCode extension that bridges the gap between AI assistants and your IDE. It starts by solving the code review problem - replacing clunky terminal scrolling with GitHub-style review panels - but aims to become a comprehensive platform for AI-assisted development.

By connecting AI assistants to your IDE's Language Server Protocol (LSP), Dialectic will eventually enable sophisticated code understanding, refactoring, and navigation that goes far beyond what's possible in a terminal chat.

## The Problem

When working with AI assistants on code, most developers fall into one of two unsatisfactory patterns:

**The Micro-Manager**: Review every single edit hunk-by-hunk as it's proposed. This is tedious, breaks your flow, and makes it nearly impossible to understand the bigger picture of what's being built.

**The Auto-Accepter**: Enable auto-accept to avoid micro-management, then ask for a summary afterwards. You end up scrolling through terminal output, losing track of line numbers as you make further changes, and struggling to navigate between the review and your actual code.

Neither approach gives you what you really want: the kind of comprehensive, navigable code review you'd expect from a pull request on GitHub.

## The Dialectic Approach

Dialectic provides a dedicated review panel in VSCode where AI-generated reviews appear as structured, navigable documents. Click on code references to jump directly to the relevant lines. Continue your conversation with the AI naturally while the review stays synchronized with your evolving codebase.

The review becomes a living document that can eventually be used as a commit message, preserving the reasoning behind your changes in your git history.

## Part of a Larger Ecosystem

Dialectic is designed to work synergistically with other [socratic shell](https://socratic-shell.github.io/socratic-shell/) tools. The collaborative prompts establish the interaction patterns, Dialectic provides the review infrastructure, and [hippo](https://github.com/socratic-shell/hippo) learns from the accumulated dialogue to help improve future collaborations. Together, these tools create an AI partnership that becomes more effective over time, building on both the specific insights preserved in reviews and the meta-patterns of successful collaboration.