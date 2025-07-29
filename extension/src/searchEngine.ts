// 💡: Search engine for finding text within files with optional line constraints
// Supports the parameter combinations from dialectic: URL scheme design

import * as vscode from 'vscode';
import { LineSpec } from './dialecticUrl';

export interface SearchResult {
    line: number;        // 1-based line number
    column: number;      // 1-based column number
    text: string;        // The line containing the match
    matchStart: number;  // 0-based start position within the line
    matchEnd: number;    // 0-based end position within the line
}

export interface SearchOptions {
    regexPattern: string;
    lineConstraint?: LineSpec;
    caseSensitive?: boolean;
    wholeWord?: boolean;
}

/**
 * Search for text within a file, optionally constrained to specific lines
 * 
 * Parameter combinations:
 * - regex=pattern -> search entire file
 * - regex=pattern&line=100 -> search starting from line 100
 * - regex=pattern&line=50-150 -> search only within lines 50-150
 */
export async function searchInFile(fileUri: vscode.Uri, options: SearchOptions): Promise<SearchResult[]> {
    try {
        // 💡: Read file content using VSCode workspace API for consistency
        const document = await vscode.workspace.openTextDocument(fileUri);
        const fileContent = document.getText();
        const lines = fileContent.split('\n');
        
        const results: SearchResult[] = [];
        const { regexPattern, lineConstraint, caseSensitive = false } = options;
        
        // 💡: Determine search bounds based on line constraint
        const searchBounds = getSearchBounds(lines.length, lineConstraint);
        
        // 💡: Create regex with appropriate flags
        const flags = caseSensitive ? 'g' : 'gi';
        let regex: RegExp;
        try {
            regex = new RegExp(regexPattern, flags);
        } catch (error) {
            throw new Error(`Invalid regex pattern "${regexPattern}": ${error}`);
        }
        
        console.log(`[SearchEngine] Searching with regex: /${regexPattern}/${flags}`);
        console.log(`[SearchEngine] Search bounds: lines ${searchBounds.startLine}-${searchBounds.endLine}`);
        
        // 💡: Search within the determined bounds
        for (let i = searchBounds.startLine - 1; i < searchBounds.endLine; i++) {
            const line = lines[i];
            
            // 💡: Find all matches in this line using regex
            let match: RegExpExecArray | null;
            regex.lastIndex = 0; // Reset regex state for each line
            
            while ((match = regex.exec(line)) !== null) {
                const matchIndex = match.index;
                const matchLength = match[0].length;
                
                console.log(`[SearchEngine] Found match on line ${i + 1}: "${match[0]}" at column ${matchIndex + 1}`);
                
                // 💡: Check column constraints if specified
                if (shouldIncludeMatch(i + 1, matchIndex + 1, lineConstraint)) {
                    results.push({
                        line: i + 1,  // Convert to 1-based
                        column: matchIndex + 1,  // Convert to 1-based
                        text: line,
                        matchStart: matchIndex,
                        matchEnd: matchIndex + matchLength
                    });
                } else {
                    console.log(`[SearchEngine] Match excluded by column constraints`);
                }
                
                // 💡: Prevent infinite loop on zero-width matches
                if (matchLength === 0) {
                    regex.lastIndex++;
                }
            }
        }
        
        console.log(`[SearchEngine] Total matches found: ${results.length}`);
        
        return results;
    } catch (error) {
        throw new Error(`Failed to search in file ${fileUri.fsPath}: ${error}`);
    }
}

/**
 * Determine search bounds based on line constraint
 */
function getSearchBounds(totalLines: number, lineConstraint?: LineSpec): { startLine: number; endLine: number } {
    if (!lineConstraint) {
        return { startLine: 1, endLine: totalLines };
    }
    
    switch (lineConstraint.type) {
        case 'single':
        case 'single-with-column':
            // 💡: For single line constraints, search from that line to end
            // This matches the design: "search starting from line N"
            return { 
                startLine: lineConstraint.startLine, 
                endLine: totalLines 
            };
            
        case 'range':
        case 'range-with-columns':
            // 💡: For range constraints, search only within the range
            return { 
                startLine: lineConstraint.startLine, 
                endLine: lineConstraint.endLine || totalLines 
            };
    }
}

/**
 * Check if a match should be included based on column constraints
 */
function shouldIncludeMatch(line: number, column: number, lineConstraint?: LineSpec): boolean {
    if (!lineConstraint) {
        return true;
    }
    
    // 💡: For single line with column, only include matches at or after that column
    if (lineConstraint.type === 'single-with-column' && line === lineConstraint.startLine) {
        return column >= (lineConstraint.startColumn || 1);
    }
    
    // 💡: For range with columns, check if match falls within the precise range
    if (lineConstraint.type === 'range-with-columns') {
        if (line < lineConstraint.startLine || line > (lineConstraint.endLine || lineConstraint.startLine)) {
            return false;
        }
        
        // Check column bounds for start and end lines
        if (line === lineConstraint.startLine && column < (lineConstraint.startColumn || 1)) {
            return false;
        }
        
        if (line === lineConstraint.endLine && column > (lineConstraint.endColumn || Number.MAX_SAFE_INTEGER)) {
            return false;
        }
    }
    
    return true;
}

/**
 * Get the best search result for navigation
 * Returns the first match, which is typically what users expect
 */
export function getBestSearchResult(results: SearchResult[]): SearchResult | null {
    // 💡: Return first result as it appears earliest in the file
    // Could be enhanced with ranking based on context or exact word matches
    return results.length > 0 ? results[0] : null;
}

/**
 * Format search results for debugging/logging
 */
export function formatSearchResults(results: SearchResult[]): string {
    if (results.length === 0) {
        return 'No matches found';
    }
    
    return results.map(result => 
        `${result.line}:${result.column} "${result.text.trim()}"`
    ).join('\n');
}
