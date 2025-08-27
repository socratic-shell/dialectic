import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { DaemonClient } from './extension';
import { SyntheticPRProvider } from './syntheticPRProvider';
import { WalkthroughWebviewProvider } from './walkthroughWebview';

/**
 * Central message bus for extension components
 * Reduces tight coupling by providing shared access to all major components
 */
export class Bus {
    public context: vscode.ExtensionContext;
    public outputChannel: vscode.OutputChannel;
    private _daemonClient: DaemonClient | undefined;
    private _syntheticPRProvider: SyntheticPRProvider | undefined;
    private _walkthroughProvider: WalkthroughWebviewProvider | undefined;

    constructor(context: vscode.ExtensionContext, outputChannel: vscode.OutputChannel) {
        this.context = context;
        this.outputChannel = outputChannel;
    }

    // Register components as they're created
    setDaemonClient(client: DaemonClient) {
        this._daemonClient = client;
    }

    setSyntheticPRProvider(provider: SyntheticPRProvider) {
        this._syntheticPRProvider = provider;
    }

    setWalkthroughProvider(provider: WalkthroughWebviewProvider) {
        this._walkthroughProvider = provider;
    }

    // Accessors with assertions
    get daemonClient(): DaemonClient {
        if (!this._daemonClient) {
            throw new Error('DaemonClient not initialized on Bus');
        }
        return this._daemonClient;
    }

    get syntheticPRProvider(): SyntheticPRProvider {
        if (!this._syntheticPRProvider) {
            throw new Error('SyntheticPRProvider not initialized on Bus');
        }
        return this._syntheticPRProvider;
    }

    get walkthroughProvider(): WalkthroughWebviewProvider {
        if (!this._walkthroughProvider) {
            throw new Error('WalkthroughWebviewProvider not initialized on Bus');
        }
        return this._walkthroughProvider;
    }

    // Convenience methods for common operations
    async sendReferenceToActiveShell(referenceId: string, referenceData: any): Promise<void> {
        return this.daemonClient.sendReferenceToActiveShell(referenceId, referenceData);
    }

    /**
     * Send reference data to active terminal with consolidated logic
     * Handles terminal finding, reference creation, and XML generation
     */
    async sendToActiveTerminal(referenceData: any, includeNewline: boolean = true): Promise<void> {
        // Find active terminal using existing heuristics
        const terminals = vscode.window.terminals;
        if (terminals.length === 0) {
            vscode.window.showWarningMessage('No terminals found. Please open a terminal with an active AI assistant.');
            return;
        }

        // Get active terminals with MCP servers from registry
        const activeTerminals = this.getActiveTerminals();
        this.log(`Active MCP server terminals: [${Array.from(activeTerminals).join(', ')}]`);

        if (activeTerminals.size === 0) {
            vscode.window.showWarningMessage('No terminals with active MCP servers found. Please ensure you have a terminal with an active AI assistant (like Q chat or Claude CLI) running.');
            return;
        }

        // Filter terminals to only those with active MCP servers
        const terminalChecks = await Promise.all(
            terminals.map(async (terminal) => {
                const shellPID = await terminal.processId;
                const isAiEnabled = shellPID && activeTerminals.has(shellPID);
                return { terminal, shellPID, isAiEnabled };
            })
        );

        const aiEnabledTerminals = terminalChecks
            .filter(check => check.isAiEnabled)
            .map(check => ({ terminal: check.terminal, shellPID: check.shellPID }));

        if (aiEnabledTerminals.length === 0) {
            vscode.window.showWarningMessage('No AI-enabled terminals found. Please ensure you have a terminal with an active MCP server running.');
            return;
        }

        let selectedTerminal;

        // Simple case - exactly one AI-enabled terminal
        if (aiEnabledTerminals.length === 1) {
            selectedTerminal = aiEnabledTerminals[0];
        } else {
            // Multiple terminals - show picker for ambiguity resolution
            const terminalItems = aiEnabledTerminals.map(({ terminal, shellPID }) => ({
                label: terminal.name,
                description: `PID: ${shellPID}`,
                terminal,
                shellPID
            }));

            const selected = await vscode.window.showQuickPick(terminalItems, {
                placeHolder: 'Select terminal to send reference to'
            });

            if (!selected) {
                return; // User cancelled
            }

            selectedTerminal = { terminal: selected.terminal, shellPID: selected.shellPID };
        }

        // Generate fresh UUID for reference
        const referenceId = crypto.randomUUID();

        // Send reference data to MCP server for selected terminal
        if (selectedTerminal.shellPID) {
            await this.sendReferenceToActiveShell(referenceId, referenceData);
        }

        // Generate <ssref id="..."/> XML (using current format)
        const xmlMessage = `<ssref id="${referenceId}"/>` + (includeNewline ? '\n\n' : '');

        // Send XML to terminal
        selectedTerminal.terminal.sendText(xmlMessage, false); // false = don't execute, just insert text
        selectedTerminal.terminal.show(); // Bring terminal into focus

        this.log(`Reference ${referenceId} sent to terminal ${selectedTerminal.terminal.name} (PID: ${selectedTerminal.shellPID})`);
    }

    /**
     * Send plain text message to active terminal (no reference creation)
     * For simple text messages that don't need MCP reference storage
     */
    async sendTextToActiveTerminal(message: string): Promise<void> {
        // Find active terminal using same logic as sendToActiveTerminal
        const terminals = vscode.window.terminals;
        if (terminals.length === 0) {
            vscode.window.showWarningMessage('No terminals found. Please open a terminal with an active AI assistant.');
            return;
        }

        const activeTerminals = this.getActiveTerminals();
        if (activeTerminals.size === 0) {
            vscode.window.showWarningMessage('No terminals with active MCP servers found. Please ensure you have a terminal with an active AI assistant (like Q chat or Claude CLI) running.');
            return;
        }

        // Filter to AI-enabled terminals
        const terminalChecks = await Promise.all(
            terminals.map(async (terminal) => {
                const shellPID = await terminal.processId;
                const isAiEnabled = shellPID && activeTerminals.has(shellPID);
                return { terminal, shellPID, isAiEnabled };
            })
        );

        const aiEnabledTerminals = terminalChecks
            .filter(check => check.isAiEnabled)
            .map(check => ({ terminal: check.terminal, shellPID: check.shellPID }));

        if (aiEnabledTerminals.length === 0) {
            vscode.window.showWarningMessage('No AI-enabled terminals found. Please ensure you have a terminal with an active MCP server running.');
            return;
        }

        let selectedTerminal;

        if (aiEnabledTerminals.length === 1) {
            selectedTerminal = aiEnabledTerminals[0];
        } else {
            // Show picker for multiple terminals
            const terminalItems = aiEnabledTerminals.map(({ terminal, shellPID }) => ({
                label: terminal.name,
                description: `PID: ${shellPID}`,
                terminal,
                shellPID
            }));

            const selected = await vscode.window.showQuickPick(terminalItems, {
                placeHolder: 'Select terminal to send message to'
            });

            if (!selected) {
                return; // User cancelled
            }

            selectedTerminal = { terminal: selected.terminal, shellPID: selected.shellPID };
        }

        // Send text directly to terminal
        selectedTerminal.terminal.sendText(message, false); // false = don't execute, just insert text
        selectedTerminal.terminal.show(); // Bring terminal into focus

        this.log(`Text message sent to terminal ${selectedTerminal.terminal.name} (PID: ${selectedTerminal.shellPID})`);
    }

    getActiveTerminals(): Set<number> {
        return this.daemonClient.getActiveTerminals();
    }

    log(message: string) {
        this.outputChannel.appendLine(message);
    }
}
