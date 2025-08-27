import * as vscode from 'vscode';

/**
 * Central message bus for extension components
 * Reduces tight coupling by providing shared access to all major components
 */
export class Bus {
    private static instance: Bus;
    
    public context!: vscode.ExtensionContext;
    public outputChannel!: vscode.OutputChannel;
    public daemonClient!: any; // Will be DaemonClient once created
    public syntheticPRProvider!: any; // Will be SyntheticPRProvider once created
    public walkthroughProvider!: any; // Will be WalkthroughWebviewProvider once created

    private constructor() {}

    static getInstance(): Bus {
        if (!Bus.instance) {
            Bus.instance = new Bus();
        }
        return Bus.instance;
    }

    // Initialize with core components
    init(context: vscode.ExtensionContext, outputChannel: vscode.OutputChannel) {
        this.context = context;
        this.outputChannel = outputChannel;
    }

    // Register components as they're created
    setDaemonClient(client: any) {
        this.daemonClient = client;
    }

    setSyntheticPRProvider(provider: any) {
        this.syntheticPRProvider = provider;
    }

    setWalkthroughProvider(provider: any) {
        this.walkthroughProvider = provider;
    }

    // Convenience methods for common operations
    async sendReferenceToActiveShell(referenceId: string, referenceData: any): Promise<void> {
        if (!this.daemonClient) {
            throw new Error('DaemonClient not available on bus');
        }
        return this.daemonClient.sendReferenceToActiveShell(referenceId, referenceData);
    }

    getActiveTerminals(): Set<number> {
        if (!this.daemonClient) {
            return new Set();
        }
        return this.daemonClient.getActiveTerminals();
    }

    log(message: string) {
        this.outputChannel.appendLine(message);
    }
}
