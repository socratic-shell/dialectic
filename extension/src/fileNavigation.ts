import * as vscode from 'vscode';
import { parseDialecticUrl, DialecticUrl } from './dialecticUrl';
import { searchInFile, getBestSearchResult, formatSearchResults, needsDisambiguation } from './searchEngine';

// Choice memory is now managed by WalkthroughWebviewProvider and threaded down as parameter

/**
 * Open a file location specified by a dialectic URL
 * Full implementation with regex search support extracted from reviewWebview
 */
export async function openDialecticUrl(
    dialecticUrl: string, 
    outputChannel: vscode.OutputChannel, 
    baseUri?: vscode.Uri,
    placementMemory?: Map<string, any>
): Promise<void> {
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
                    // Multiple matches - check placement memory first
                    const linkKey = `link:${dialecticUrl}`;
                    const placementState = placementMemory?.get(linkKey);
                    
                    if (placementState?.isPlaced && placementState.chosenLocation) {
                        // Use previously placed location
                        const rememberedChoice = placementState.chosenLocation;
                        // Check if remembered choice is still valid in current results
                        const stillValid = searchResults.find(r => 
                            r.line === rememberedChoice.line && 
                            r.column === rememberedChoice.column &&
                            r.text === rememberedChoice.text
                        );
                        
                        if (stillValid) {
                            // Show disambiguation with "same as last time" option
                            const selectedResult = await showSearchDisambiguationWithMemory(
                                searchResults, parsed.regex, document, rememberedChoice
                            );
                            
                            if (selectedResult) {
                                targetLine = selectedResult.line;
                                targetColumn = selectedResult.column;
                                // Update placement memory with new choice
                                placementMemory?.set(linkKey, {
                                    isPlaced: true,
                                    chosenLocation: selectedResult,
                                    wasAmbiguous: true
                                });
                            }
                        } else {
                            // Remembered choice no longer valid, show normal disambiguation
                            const selectedResult = await showSearchDisambiguation(searchResults, parsed.regex, document);
                            if (selectedResult) {
                                targetLine = selectedResult.line;
                                targetColumn = selectedResult.column;
                                placementMemory?.set(linkKey, {
                                    isPlaced: true,
                                    chosenLocation: selectedResult,
                                    wasAmbiguous: true
                                });
                            }
                        }
                    } else {
                        // No previous choice, show normal disambiguation
                        const selectedResult = await showSearchDisambiguation(searchResults, parsed.regex, document);
                        if (selectedResult) {
                            targetLine = selectedResult.line;
                            targetColumn = selectedResult.column;
                            placementMemory?.set(linkKey, {
                                isPlaced: true,
                                chosenLocation: selectedResult,
                                wasAmbiguous: true
                            });
                        }
                    }
                } else {
                    // Single clear result or clear winner after prioritization
                    const bestResult = getBestSearchResult(searchResults);
                    if (bestResult) {
                        targetLine = bestResult.line;
                        targetColumn = bestResult.column;
                        outputChannel.appendLine(`Using best result: line ${targetLine}, column ${targetColumn}`);
                        
                        // Auto-place unambiguous links
                        const linkKey = `link:${dialecticUrl}`;
                        placementMemory?.set(linkKey, {
                            isPlaced: true,
                            chosenLocation: bestResult,
                            wasAmbiguous: false
                        });
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

        // Explicitly set the cursor position after opening
        editor.selection = new vscode.Selection(line, column, line, column);
        editor.revealRange(new vscode.Range(line, column, line, column), vscode.TextEditorRevealType.InCenter);

        // Apply highlight decoration using the appropriate ranges
        const lineHighlightDecoration = vscode.window.createTextEditorDecorationType({
            backgroundColor: new vscode.ThemeColor('editor.findMatchHighlightBackground'),
            border: '1px solid',
            borderColor: new vscode.ThemeColor('editor.findMatchBorder')
        });

        const bestSearchResult = parsed.regex ? 
            (await searchInFile(fileUri, { regexPattern: parsed.regex, lineConstraint: parsed.line }))
                .find(r => r.line === targetLine && r.column === targetColumn) : undefined;

        const decorationRanges = createDecorationRanges(document, parsed.line, targetLine, targetColumn, bestSearchResult);
        if (decorationRanges.length > 0) {
            editor.setDecorations(lineHighlightDecoration, decorationRanges);
            
            // Remove highlight after 3 seconds
            setTimeout(() => {
                if (vscode.window.activeTextEditor === editor) {
                    editor.setDecorations(lineHighlightDecoration, []);
                }
                lineHighlightDecoration.dispose();
            }, 3000);
        }

        outputChannel.appendLine(`Navigated to line ${targetLine}, column ${targetColumn}`);

    } catch (error) {
        outputChannel.appendLine(`Failed to open dialectic URL: ${error}`);
        vscode.window.showErrorMessage(`Failed to open ${dialecticUrl} - ${error}`);
    }
}

/**
 * Show disambiguation dialog with "same as last time" option
 */
async function showSearchDisambiguationWithMemory(
    results: import('./searchEngine').SearchResult[], 
    searchTerm: string, 
    document: vscode.TextDocument,
    rememberedChoice: import('./searchEngine').SearchResult
): Promise<import('./searchEngine').SearchResult | undefined> {
    // Create "same as last time" option
    const sameAsLastItem = {
        label: `$(history) Same as last time: Line ${rememberedChoice.line}`,
        description: `${rememberedChoice.text.trim()}`,
        detail: `Column ${rememberedChoice.column} (press Enter to use this)`,
        result: rememberedChoice,
        isSameAsLast: true
    };

    // Create other options
    const otherItems = results
        .filter(r => !(r.line === rememberedChoice.line && r.column === rememberedChoice.column))
        .map((result, index) => ({
            label: `Line ${result.line}: ${result.text.trim()}`,
            description: `$(search) Match ${index + 1} of ${results.length}`,
            detail: `Column ${result.column}`,
            result: result,
            isSameAsLast: false
        }));

    const allItems = [sameAsLastItem, ...otherItems];

    const quickPick = vscode.window.createQuickPick();
    quickPick.title = `Multiple matches for "${searchTerm}"`;
    quickPick.placeholder = 'Select match (first option repeats your last choice)';
    quickPick.items = allItems;
    quickPick.canSelectMany = false;
    
    // Pre-select the "same as last time" option
    if (allItems.length > 0) {
        quickPick.activeItems = [allItems[0]];
    }

    // Create line highlight decoration type
    const lineHighlightDecoration = vscode.window.createTextEditorDecorationType({
        backgroundColor: new vscode.ThemeColor('editor.findMatchHighlightBackground'),
        border: '1px solid',
        borderColor: new vscode.ThemeColor('editor.findMatchBorder')
    });

    return new Promise((resolve) => {
        let currentActiveItem: any = null;
        let isResolved = false;

        // Show live preview as user navigates through options
        quickPick.onDidChangeActive((items) => {
            if (items.length > 0) {
                currentActiveItem = items[0];
                const selectedResult = (items[0] as any).result;
                
                // Show preview
                vscode.window.showTextDocument(document, {
                    selection: new vscode.Range(
                        selectedResult.line - 1, 
                        selectedResult.matchStart,
                        selectedResult.line - 1, 
                        selectedResult.matchEnd
                    ),
                    preview: true,
                    preserveFocus: true,
                    viewColumn: vscode.ViewColumn.One
                }).then((editor) => {
                    const decorationRanges = createDecorationRanges(
                        document, undefined, selectedResult.line, selectedResult.column, selectedResult
                    );
                    if (decorationRanges.length > 0) {
                        editor.setDecorations(lineHighlightDecoration, decorationRanges);
                        setTimeout(() => {
                            if (editor && !editor.document.isClosed) {
                                editor.setDecorations(lineHighlightDecoration, []);
                            }
                        }, 2000);
                    }
                });
            }
        });

        quickPick.onDidAccept(() => {
            if (isResolved) return;

            const selected = currentActiveItem || quickPick.selectedItems[0];
            
            if (selected && (selected as any).result) {
                const result = (selected as any).result;
                isResolved = true;
                quickPick.dispose();
                lineHighlightDecoration.dispose();
                resolve(result);
                return;
            }

            isResolved = true;
            quickPick.dispose();
            lineHighlightDecoration.dispose();
            resolve(undefined);
        });

        quickPick.onDidHide(() => {
            if (!isResolved) {
                isResolved = true;
                quickPick.dispose();
                lineHighlightDecoration.dispose();
                resolve(undefined);
            }
        });

        quickPick.show();
    });
}

/**
 * Show disambiguation dialog for multiple search results
 * Full implementation with live preview and highlighting
 */
async function showSearchDisambiguation(
    results: import('./searchEngine').SearchResult[], 
    searchTerm: string, 
    document: vscode.TextDocument
): Promise<import('./searchEngine').SearchResult | undefined> {
    // Create QuickPick items with context
    const items = results.map((result, index) => ({
        label: `Line ${result.line}: ${result.text.trim()}`,
        description: `$(search) Match ${index + 1} of ${results.length}`,
        detail: `Column ${result.column}`,
        result: result
    }));

    const quickPick = vscode.window.createQuickPick();
    quickPick.title = `Multiple matches for "${searchTerm}"`;
    quickPick.placeholder = 'Select the match you want to navigate to (preview updates as you navigate)';
    quickPick.items = items;
    quickPick.canSelectMany = false;

    // Create line highlight decoration type
    const lineHighlightDecoration = vscode.window.createTextEditorDecorationType({
        backgroundColor: new vscode.ThemeColor('editor.findMatchHighlightBackground'),
        border: '1px solid',
        borderColor: new vscode.ThemeColor('editor.findMatchBorder')
    });

    return new Promise((resolve) => {
        let currentActiveItem: any = null;
        let isResolved = false;

        // Show live preview as user navigates through options
        quickPick.onDidChangeActive((items) => {
            if (items.length > 0) {
                currentActiveItem = items[0]; // Track the currently active item
                const selectedResult = (items[0] as any).result;
                
                // Show preview by revealing the location without committing to it
                vscode.window.showTextDocument(document, {
                    selection: new vscode.Range(
                        selectedResult.line - 1, 
                        selectedResult.matchStart,
                        selectedResult.line - 1, 
                        selectedResult.matchEnd
                    ),
                    preview: true, // This keeps it as a preview tab
                    preserveFocus: true, // Keep focus on the QuickPick
                    viewColumn: vscode.ViewColumn.One // Ensure it opens in main editor area
                }).then((editor) => {
                    // Add line decorations to preview just like final navigation
                    const decorationRanges = createDecorationRanges(
                        document, 
                        undefined, // No line constraint for search results
                        selectedResult.line, 
                        selectedResult.column, 
                        selectedResult
                    );
                    if (decorationRanges.length > 0) {
                        editor.setDecorations(lineHighlightDecoration, decorationRanges);
                        
                        // Remove preview highlight after 2 seconds (shorter than final)
                        setTimeout(() => {
                            if (editor && !editor.document.isClosed) {
                                editor.setDecorations(lineHighlightDecoration, []);
                            }
                        }, 2000);
                    }
                }, (error: any) => {
                    console.log(`Preview failed: ${error}`);
                });
            }
        });

        quickPick.onDidAccept(() => {
            if (isResolved) {
                return;
            }

            // Use the currently active item instead of selectedItems
            const selected = currentActiveItem || quickPick.selectedItems[0];
            
            if (selected && (selected as any).result) {
                const result = (selected as any).result;
                isResolved = true;
                quickPick.dispose();
                lineHighlightDecoration.dispose();
                resolve(result);
                return;
            }

            // Fallback case
            isResolved = true;
            quickPick.dispose();
            lineHighlightDecoration.dispose();
            resolve(undefined);
        });

        quickPick.onDidHide(() => {
            if (!isResolved) {
                isResolved = true;
                quickPick.dispose();
                lineHighlightDecoration.dispose();
                resolve(undefined);
            }
        });

        quickPick.show();
    });
}

// clearChoiceMemory is no longer needed - placement memory is managed by WalkthroughWebviewProvider

/**
 * Create decoration ranges based on line specification or search result
 */
function createDecorationRanges(
    document: vscode.TextDocument, 
    lineSpec?: import('./dialecticUrl').LineSpec, 
    targetLine?: number, 
    targetColumn?: number,
    searchResult?: import('./searchEngine').SearchResult
): vscode.Range[] {
    // If we have a search result, highlight the exact match
    if (searchResult) {
        const line = Math.max(0, searchResult.line - 1); // Convert to 0-based
        const startCol = searchResult.matchStart;
        const endCol = searchResult.matchEnd;
        return [new vscode.Range(line, startCol, line, endCol)];
    }
    
    if (lineSpec) {
        const ranges: vscode.Range[] = [];
        const startLine = Math.max(0, lineSpec.startLine - 1);
        const endLine = lineSpec.endLine ? Math.max(0, lineSpec.endLine - 1) : startLine;
        
        for (let line = startLine; line <= Math.min(endLine, document.lineCount - 1); line++) {
            const lineText = document.lineAt(line);
            ranges.push(new vscode.Range(line, 0, line, lineText.text.length));
        }
        return ranges;
    }
    
    // Single line highlight
    if (targetLine) {
        const line = Math.max(0, targetLine - 1);
        if (line < document.lineCount) {
            const lineText = document.lineAt(line);
            return [new vscode.Range(line, 0, line, lineText.text.length)];
        }
    }
    
    return [];
}
