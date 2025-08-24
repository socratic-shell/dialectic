import * as vscode from 'vscode';
import { parseDialecticUrl, DialecticUrl } from './dialecticUrl';
import { searchInFile, getBestSearchResult, formatSearchResults, needsDisambiguation } from './searchEngine';

/**
 * Open a file location specified by a dialectic URL
 * Full implementation with regex search support extracted from reviewWebview
 */
export async function openDialecticUrl(dialecticUrl: string, outputChannel: vscode.OutputChannel, baseUri?: vscode.Uri): Promise<void> {
    try {
        // Parse the dialectic URL to extract components
        const parsed = parseDialecticUrl(dialecticUrl);
        if (!parsed) {
            vscode.window.showErrorMessage(`Invalid dialectic URL: ${dialecticUrl}`);
            return;
        }

        outputChannel.appendLine(`Opening dialectic URL: ${dialecticUrl}`);
        outputChannel.appendLine(`Parsed: path=${parsed.path}, regex=${parsed.regex}, line=${JSON.stringify(parsed.line)}`);

        // Resolve file path - simplified version for shared module
        let fileUri: vscode.Uri;
        if (baseUri && !parsed.path.startsWith('/')) {
            fileUri = vscode.Uri.joinPath(baseUri, parsed.path);
        } else {
            fileUri = vscode.Uri.file(parsed.path);
        }

        // Check if file exists
        try {
            const stat = await vscode.workspace.fs.stat(fileUri);
            if (stat.type === vscode.FileType.Directory) {
                outputChannel.appendLine(`Revealing directory in Explorer: ${fileUri.fsPath}`);
                await vscode.commands.executeCommand('revealInExplorer', fileUri);
                return;
            }
        } catch (error) {
            const baseInfo = baseUri ? ` (base: ${baseUri.fsPath})` : '';
            vscode.window.showErrorMessage(`File not found: ${parsed.path}${baseInfo}`);
            return;
        }

        // Open the document
        const document = await vscode.workspace.openTextDocument(fileUri);

        let targetLine = 1;
        let targetColumn = 1;

        // Handle regex if specified
        if (parsed.regex) {
            try {
                const searchResults = await searchInFile(fileUri, {
                    regexPattern: parsed.regex,
                    lineConstraint: parsed.line
                });

                outputChannel.appendLine(`Regex search results:\n${formatSearchResults(searchResults)}`);

                if (searchResults.length === 0) {
                    vscode.window.showWarningMessage(`Regex pattern "${parsed.regex}" not found in ${parsed.path}`);
                    // Fall back to line parameter if regex fails
                    if (parsed.line) {
                        targetLine = parsed.line.startLine;
                        targetColumn = parsed.line.startColumn || 1;
                    }
                } else if (needsDisambiguation(searchResults)) {
                    // Multiple matches - show disambiguation dialog
                    try {
                        const selectedResult = await showSearchDisambiguation(searchResults, parsed.regex, document);
                        
                        if (selectedResult) {
                            targetLine = selectedResult.line;
                            targetColumn = selectedResult.column;
                        } else {
                            // User cancelled - fall back to best result
                            const bestResult = getBestSearchResult(searchResults);
                            if (bestResult) {
                                targetLine = bestResult.line;
                                targetColumn = bestResult.column;
                            }
                        }
                    } catch (error) {
                        outputChannel.appendLine(`Disambiguation error: ${error}`);
                        // Fall back to best result on error
                        const bestResult = getBestSearchResult(searchResults);
                        if (bestResult) {
                            targetLine = bestResult.line;
                            targetColumn = bestResult.column;
                        }
                    }
                } else {
                    // Single clear result or clear winner after prioritization
                    const bestResult = getBestSearchResult(searchResults);
                    if (bestResult) {
                        targetLine = bestResult.line;
                        targetColumn = bestResult.column;
                        outputChannel.appendLine(`Using best result: line ${targetLine}, column ${targetColumn}`);
                    }
                }
            } catch (error) {
                outputChannel.appendLine(`Regex search failed: ${error}`);
                vscode.window.showErrorMessage(`Regex search failed: ${error}`);
                // Fall back to line parameter if regex fails
                if (parsed.line) {
                    targetLine = parsed.line.startLine;
                    targetColumn = parsed.line.startColumn || 1;
                }
            }
        } else if (parsed.line) {
            // No regex, just use line parameter
            targetLine = parsed.line.startLine;
            targetColumn = parsed.line.startColumn || 1;
        }

        // Convert to 0-based for VSCode API and create selection
        const line = Math.max(0, targetLine - 1);
        const column = Math.max(0, targetColumn - 1);
        const selection = new vscode.Range(line, column, line, column);

        const editor = await vscode.window.showTextDocument(document, {
            selection,
            viewColumn: vscode.ViewColumn.One,
            preview: false // Ensure final navigation creates a permanent tab
        });

        outputChannel.appendLine(`Navigated to line ${targetLine}, column ${targetColumn}`);

    } catch (error) {
        outputChannel.appendLine(`Failed to open dialectic URL: ${error}`);
        vscode.window.showErrorMessage(`Failed to open ${dialecticUrl} - ${error}`);
    }
}

/**
 * Show disambiguation dialog for multiple search results
 * Simplified version without live preview for shared module
 */
async function showSearchDisambiguation(
    results: import('./searchEngine').SearchResult[], 
    searchTerm: string, 
    document: vscode.TextDocument
): Promise<import('./searchEngine').SearchResult | undefined> {
    // Create QuickPick items with context
    const items = results.map((result, index) => ({
        label: `Line ${result.line}: ${result.text.trim()}`,
        description: `Match ${index + 1} of ${results.length}`,
        detail: `Column ${result.column}`,
        result: result
    }));

    const selected = await vscode.window.showQuickPick(items, {
        placeHolder: `Multiple matches for "${searchTerm}" - select one:`
    });

    return selected?.result;
}
