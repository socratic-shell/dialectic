import * as vscode from 'vscode';
import { parseDialecticUrl, DialecticUrl } from './dialecticUrl';

/**
 * Open a file location specified by a dialectic URL
 * Simplified version that handles basic file opening and line navigation
 */
export async function openDialecticUrl(dialecticUrl: string, outputChannel: vscode.OutputChannel, baseUri?: vscode.Uri): Promise<void> {
    outputChannel.appendLine(`Opening dialectic URL: ${dialecticUrl}`);
    
    const parsed = parseDialecticUrl(dialecticUrl);
    if (!parsed) {
        outputChannel.appendLine(`Failed to parse dialectic URL: ${dialecticUrl}`);
        vscode.window.showErrorMessage(`Invalid dialectic URL: ${dialecticUrl}`);
        return;
    }

    outputChannel.appendLine(`Parsed URL: ${JSON.stringify(parsed)}`);

    // Resolve file path relative to base URI if provided
    let filePath = parsed.path;
    if (baseUri && !filePath.startsWith('/')) {
        filePath = vscode.Uri.joinPath(baseUri, parsed.path).fsPath;
    }

    try {
        // Check if file exists
        const fileUri = vscode.Uri.file(filePath);
        await vscode.workspace.fs.stat(fileUri);
        
        // Open the document
        const document = await vscode.workspace.openTextDocument(fileUri);
        
        // Calculate target position
        let targetLine = 1;
        let targetColumn = 1;
        
        if (parsed.line) {
            targetLine = parsed.line.startLine;
            targetColumn = parsed.line.startColumn || 1;
        }
        
        // Convert to 0-based for VSCode API
        const line = Math.max(0, targetLine - 1);
        const column = Math.max(0, targetColumn - 1);
        const position = new vscode.Position(line, column);
        const selection = new vscode.Range(position, position);
        
        // Open and navigate to position
        await vscode.window.showTextDocument(document, {
            selection,
            viewColumn: vscode.ViewColumn.One,
            preview: false
        });
        
        outputChannel.appendLine(`Navigated to line ${targetLine}, column ${targetColumn}`);
        
        // TODO: Add regex search support in future commits
        if (parsed.regex) {
            outputChannel.appendLine(`Regex search not yet implemented: ${parsed.regex}`);
        }
        
    } catch (error) {
        outputChannel.appendLine(`Error opening file: ${error}`);
        vscode.window.showErrorMessage(`Could not open file: ${filePath}`);
    }
}
