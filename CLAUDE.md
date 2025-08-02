This is the Dialectic project, a MCP server for integrating code reviews and generation with the user's IDE.

Consult the mdbook sources in the `md` directory below to find documentation on the design goals and overall structure of the project. Keep the mdbook up-to-date at all times as you evolve the code.

@md/SUMMARY.md

We track progress in github tracking issues on the repository `socratic-shell/dialectic':

@.socratic-shell/github-tracking-issues.md

and we use AI insight comments

@.socratic-shell/ai-insights.md

## Setup

This project uses a Rust workspace with a custom setup tool. To set up the project:

```bash
# Production setup (installs to PATH)
cargo setup

# Development setup (builds in target/)
cargo setup --dev

# Setup for specific AI assistant
cargo setup --tool claude
cargo setup --tool q
cargo setup --tool both
```

The setup tool builds both the Rust MCP server and VSCode extension, then configures them for use with AI assistants.

## Tool Management

This project uses [proto](https://moonrepo.dev/proto) for managing development tools. Individual components include idiomatic tool version files (e.g., `.nvmrc` for Node.js projects) which proto can read automatically. Run `proto install` in any component directory to install the required tools.

## Checkpointing

When checkpointing:

* Update tracking issue (if any)
* Check that mdbook is up-to-date if any user-impacting or design changes have been made
    * If mdbook is not up-to-date, ask user how to proceed
* Commit changes to git
    * If there are changes unrelated to what is being checkpointed, ask user how to proceed.