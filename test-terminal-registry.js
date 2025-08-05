#!/usr/bin/env node

/**
 * Test script to verify the terminal registry API is working
 * This simulates how Ask Socratic Shell would query active terminals
 */

const vscode = require('vscode');

async function testTerminalRegistry() {
    console.log('🧪 Testing Terminal Registry API...');
    
    try {
        // Get the Dialectic extension
        const dialecticExtension = vscode.extensions.getExtension('dialectic.dialectic');
        
        if (!dialecticExtension) {
            console.error('❌ Dialectic extension not found');
            return;
        }
        
        if (!dialecticExtension.isActive) {
            console.log('⏳ Activating Dialectic extension...');
            await dialecticExtension.activate();
        }
        
        // Get the extension API
        const api = dialecticExtension.exports;
        
        if (!api) {
            console.error('❌ Extension API not available');
            return;
        }
        
        if (!api.getActiveTerminals) {
            console.error('❌ getActiveTerminals method not found in API');
            console.log('Available API methods:', Object.keys(api));
            return;
        }
        
        // Query active terminals
        const activeTerminals = api.getActiveTerminals();
        
        console.log('✅ Terminal Registry API working!');
        console.log('📊 Active terminals with MCP servers:', Array.from(activeTerminals));
        console.log('📈 Total active terminals:', activeTerminals.size);
        
        // Test the filtering logic that Ask Socratic Shell would use
        const allTerminals = vscode.window.terminals;
        console.log('🖥️  All VSCode terminals:', allTerminals.length);
        
        // Simulate Ask Socratic Shell filtering
        const availableTerminals = allTerminals.filter(terminal => {
            // In real implementation, Ask Socratic Shell would extract PID from terminal
            // For now, we'll just show the concept
            console.log(`   Terminal: "${terminal.name}" (would check if PID is in active set)`);
            return true; // Placeholder
        });
        
        console.log('🎯 Terminals that would be available for AI routing:', availableTerminals.length);
        
    } catch (error) {
        console.error('❌ Test failed:', error.message);
    }
}

// Run the test
testTerminalRegistry().catch(console.error);
