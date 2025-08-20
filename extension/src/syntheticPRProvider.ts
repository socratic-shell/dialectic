import * as vscode from 'vscode';

interface SyntheticPRData {
    review_id: string;
    title: string;
    description: any;
    commit_range: string;
    files_changed: FileChange[];
    comment_threads: CommentThread[];
    status: string;
}

interface FileChange {
    path: string;
    additions: number;
    deletions: number;
    hunks: DiffHunk[];
}

interface DiffHunk {
    old_start: number;
    old_lines: number;
    new_start: number;
    new_lines: number;
    lines: DiffLine[];
}

interface DiffLine {
    line_type: 'context' | 'addition' | 'deletion';
    old_line_number?: number;
    new_line_number?: number;
    content: string;
}

interface CommentThread {
    id: string;
    file_path: string;
    line_number: number;
    comment_type: 'insight' | 'question' | 'todo' | 'fixme';
    content: string;
}

/**
 * Manages synthetic pull request UI components
 * 
 * Creates CommentController for displaying AI insight comments
 * and provides basic PR navigation functionality.
 */
export class SyntheticPRProvider implements vscode.Disposable {
    private commentController: vscode.CommentController;
    private currentPR: SyntheticPRData | null = null;

    constructor(private context: vscode.ExtensionContext) {
        // 💡 Create comment controller for PR comments - this enables VSCode's native comment UI
        this.commentController = vscode.comments.createCommentController(
            'dialectic-synthetic-pr',
            'Synthetic PR Comments'
        );
        
        // ❓ Should we allow users to add their own comments to AI-generated PRs?
        this.commentController.commentingRangeProvider = {
            provideCommentingRanges: () => []  // Read-only for now
        };

        context.subscriptions.push(this.commentController);
    }

    /**
     * Create a new synthetic PR from MCP server data
     */
    async createSyntheticPR(prData: SyntheticPRData): Promise<void> {
        this.currentPR = prData;
        
        // Clear existing comment threads
        this.commentController.dispose();
        this.commentController = vscode.comments.createCommentController(
            'dialectic-synthetic-pr',
            `PR: ${prData.title}`
        );
        
        // Create comment threads for each AI insight
        for (const thread of prData.comment_threads) {
            await this.createCommentThread(thread);
        }

        // Show status message
        vscode.window.showInformationMessage(
            `Synthetic PR created: ${prData.title} (${prData.files_changed.length} files changed)`
        );
    }

    /**
     * Update existing synthetic PR
     */
    async updateSyntheticPR(prData: SyntheticPRData): Promise<void> {
        if (!this.currentPR || this.currentPR.review_id !== prData.review_id) {
            // If no current PR or different PR, treat as create
            return this.createSyntheticPR(prData);
        }

        this.currentPR = prData;
        
        // For now, just recreate all comment threads
        // TODO: Implement smart diff-based updates
        this.commentController.dispose();
        this.commentController = vscode.comments.createCommentController(
            'dialectic-synthetic-pr',
            `PR: ${prData.title}`
        );
        
        for (const thread of prData.comment_threads) {
            await this.createCommentThread(thread);
        }
    }

    /**
     * Create a comment thread for an AI insight
     */
    private async createCommentThread(thread: CommentThread): Promise<void> {
        try {
            const uri = vscode.Uri.file(thread.file_path);
            const document = await vscode.workspace.openTextDocument(uri);
            
            // TODO: Add error handling for files that don't exist
            // Convert 1-based line number to 0-based range
            const line = Math.max(0, thread.line_number - 1);
            const range = new vscode.Range(line, 0, line, document.lineAt(line).text.length);
            
            const commentThread = this.commentController.createCommentThread(uri, range, []);
            
            // 💡 Create comment with AI insight - using MarkdownString for rich formatting
            const comment: vscode.Comment = {
                body: new vscode.MarkdownString(this.formatComment(thread)),
                mode: vscode.CommentMode.Preview,
                author: {
                    name: 'AI Assistant'
                }
            };
            
            commentThread.comments = [comment];
            commentThread.label = `${this.getCommentIcon(thread.comment_type)} ${thread.comment_type.toUpperCase()}`;
            
        } catch (error) {
            // FIXME: Better error handling needed - should show user-friendly message
            console.error(`Failed to create comment thread for ${thread.file_path}:${thread.line_number}`, error);
        }
    }

    /**
     * Format comment content with type-specific styling
     */
    private formatComment(thread: CommentThread): string {
        const icon = this.getCommentIcon(thread.comment_type);
        const typeLabel = thread.comment_type.toUpperCase();
        
        return `${icon} **${typeLabel}**\n\n${thread.content}`;
    }

    /**
     * Get icon for comment type
     */
    private getCommentIcon(type: string): string {
        switch (type) {
            case 'insight': return '💡';
            case 'question': return '❓';
            case 'todo': return '📝';
            case 'fixme': return '🔧';
            default: return '💬';
        }
    }

    dispose(): void {
        this.commentController.dispose();
    }
}
