import * as vscode from 'vscode';
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

    getActiveTerminals(): Set<number> {
        return this.daemonClient.getActiveTerminals();
    }

    log(message: string) {
        this.outputChannel.appendLine(message);
    }
}
