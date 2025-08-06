# Frequently asked questions

## The Dialectic MCP server won't load!

Are you running from a terminal inside of your IDE? You must use a terminal from within the IDE or else the MCP server can't identify which IDE window to connect to.

## When I active "Ask Socratic Shell", how does it know which terminal to send the message to?

The extension tracks which terminal windows have active MCP servers. If there is exactly one, it will use that, but if there are multiple, it should give you a choice.

## "Ask Socratic Shell" stopped working after reloading VSCode

When you reload VSCode, the extension restarts but your AI assistants keep running. The system *should* rediscover active terminals automatically. You can check the `Output > Dialectic` window to see whether the extension has started yet. If it has, and it fails to discover active terminals, please file an issue!

