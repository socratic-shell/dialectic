import * as vscode from 'vscode';

export class DialecticCommentController {
    private commentController: vscode.CommentController;
    private comments: Map<string, vscode.CommentThread> = new Map();

    constructor() {
        this.commentController = vscode.comments.createCommentController(
            'dialectic-comments',
            'Dialectic Comments'
        );
        
        this.commentController.commentingRangeProvider = {
            provideCommentingRanges: (document: vscode.TextDocument) => {
                // Allow commenting on any line
                const lineCount = document.lineCount;
                return [new vscode.Range(0, 0, lineCount - 1, 0)];
            }
        };

        // Handle comment creation
        this.commentController.options = {
            prompt: 'Add a comment about this dialectic link...',
            placeHolder: 'Type your comment here'
        };
    }

    /**
     * Create a comment thread at the specified location for a dialectic link
     */
    public async createCommentForDialecticLink(
        dialecticUrl: string,
        uri: vscode.Uri,
        range: vscode.Range,
        initialComment?: string
    ): Promise<vscode.CommentThread> {
        const commentKey = `${dialecticUrl}:${uri.toString()}:${range.start.line}`;
        
        // Check if comment thread already exists
        const existingThread = this.comments.get(commentKey);
        if (existingThread) {
            // Focus existing thread
            existingThread.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded;
            return existingThread;
        }

        // Create new comment thread
        const thread = this.commentController.createCommentThread(uri, range, []);
        thread.contextValue = 'dialectic-comment';
        thread.label = `Dialectic: ${this.extractLinkText(dialecticUrl)}`;
        thread.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded;

        // Add initial comment if provided
        if (initialComment) {
            const comment: vscode.Comment = {
                body: initialComment,
                mode: vscode.CommentMode.Preview,
                author: { name: 'Dialectic System' }
            };
            thread.comments = [comment];
        }

        // Store the thread
        this.comments.set(commentKey, thread);
        
        console.log(`[CommentController] Created comment thread for ${dialecticUrl} at ${uri.fsPath}:${range.start.line}`);
        return thread;
    }

    /**
     * Get existing comment thread for a dialectic link
     */
    public getCommentThread(dialecticUrl: string, uri: vscode.Uri, range: vscode.Range): vscode.CommentThread | undefined {
        const commentKey = `${dialecticUrl}:${uri.toString()}:${range.start.line}`;
        return this.comments.get(commentKey);
    }

    /**
     * Remove a comment thread
     */
    public removeCommentThread(dialecticUrl: string, uri: vscode.Uri, range: vscode.Range): void {
        const commentKey = `${dialecticUrl}:${uri.toString()}:${range.start.line}`;
        const thread = this.comments.get(commentKey);
        if (thread) {
            thread.dispose();
            this.comments.delete(commentKey);
        }
    }

    /**
     * Extract readable text from dialectic URL for display
     */
    private extractLinkText(dialecticUrl: string): string {
        // Extract pattern from dialectic:file.ts?pattern format
        const match = dialecticUrl.match(/dialectic:([^?]+)\?(?:regex=)?(.+)/);
        if (match) {
            const [, file, pattern] = match;
            const fileName = file.split('/').pop() || file;
            return `${fileName}?${pattern}`;
        }
        return dialecticUrl.replace('dialectic:', '');
    }

    /**
     * Dispose of the comment controller
     */
    public dispose(): void {
        this.commentController.dispose();
        this.comments.clear();
    }
}
