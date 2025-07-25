# Design & Implementation Overview

*This section documents the design decisions and implementation details for Dialectic. It serves as both a design document during development and a reference for future contributors.*

## Architecture Summary

Dialectic consists of two main components:

1. **VSCode Extension** - Provides the review panel UI and handles file navigation
2. **MCP Server** - Acts as a bridge between the AI assistant and the VSCode extension

The AI assistant generates review content as structured markdown and uses the MCP server to display it in the VSCode interface.

## Design Philosophy

Dialectic embodies the collaborative patterns from the [socratic shell project](https://socratic-shell.github.io/socratic-shell/). The goal is to enable genuine pair programming partnerships with AI assistants, not create another tool for giving commands to a servant.

**Collaborative Review** - Instead of accepting hunks blindly or micro-managing every change, we work together to understand what was built and why, just like reviewing a colleague's PR.

**Thoughtful Interaction** - The review format encourages narrative explanation and reasoning, not just "what changed" but "how it works" and "why these decisions were made."

**Preserved Context** - Reviews become part of your git history, retaining the collaborative thinking process for future reference and team members.

**Iterative Refinement** - Nothing is right the first time. The review process expects and supports ongoing dialogue, suggestions, and improvements rather than assuming the initial implementation is final.

## Implementation Status

This design document is a work in progress. Each chapter represents a component or aspect that needs detailed design work before implementation begins. The [Implementation Phases](./implementation-phases.md) chapter outlines our planned approach to building Dialectic incrementally.