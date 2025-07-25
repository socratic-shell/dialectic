import * as vscode from 'vscode';
import { ReviewProvider } from './reviewProvider';

export function activate(context: vscode.ExtensionContext) {
    console.log('Dialectic extension is now active');

    // Create the review provider
    const reviewProvider = new ReviewProvider();
    
    // Register the tree data provider for our custom view
    vscode.window.createTreeView('dialecticReviews', {
        treeDataProvider: reviewProvider,
        showCollapseAll: true
    });

    console.log('TreeView registered successfully');

    // Register commands
    const showReviewCommand = vscode.commands.registerCommand('dialectic.showReview', () => {
        reviewProvider.showDummyReview();
    });

    const copyReviewCommand = vscode.commands.registerCommand('dialectic.copyReview', () => {
        reviewProvider.copyReviewToClipboard();
    });

    context.subscriptions.push(showReviewCommand, copyReviewCommand);
}

export function deactivate() {}