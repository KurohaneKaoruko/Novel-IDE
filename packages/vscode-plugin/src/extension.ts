import * as vscode from 'vscode';
import * as path from 'path';
import { ChatPanel } from './chatPanel';
import { WorkspaceManager } from './workspaceManager';
import { AIProvider } from './aiProvider';

let chatPanel: ChatPanel | undefined;
let workspaceManager: WorkspaceManager | undefined;
let aiProvider: AIProvider | undefined;

export function activate(context: vscode.ExtensionContext) {
    // Initialize services
    workspaceManager = new WorkspaceManager(context);
    aiProvider = new AIProvider(context);

    // Create chat panel
    chatPanel = new ChatPanel(context, workspaceManager, aiProvider);

    // Register commands
    const commands = [
        vscode.commands.registerCommand('novel-ai.openPanel', () => {
            chatPanel?.show();
        }),
        vscode.commands.registerCommand('novel-ai.quoteSelection', () => {
            chatPanel?.quoteSelection();
        }),
        vscode.commands.registerCommand('novel-ai.insertToCursor', () => {
            chatPanel?.insertToCursor();
        }),
        vscode.commands.registerCommand('novel-ai.newChapter', async () => {
            await workspaceManager?.createNewChapter();
        }),
        vscode.commands.registerCommand('novel-ai.smartComplete', async () => {
            await chatPanel?.triggerSmartComplete();
        }),
        vscode.commands.registerCommand('novel-ai.setProvider', async () => {
            await aiProvider?.showProviderConfig();
        })
    ];

    context.subscriptions.push(...commands);

    // Show welcome on first install
    const hasShownWelcome = context.globalState.get('hasShownWelcome');
    if (!hasShownWelcome) {
        vscode.window.showInformationMessage('欢迎使用 Novel AI Assistant！按 Ctrl+Shift+A 打开AI创作面板');
        context.globalState.update('hasShownWelcome', true);
    }

    // Auto-open panel on startup if configured
    const config = vscode.workspace.getConfiguration('novelAI');
    if (config.get('autoOpenPanel', false)) {
        chatPanel.show();
    }
}

export function deactivate() {
    chatPanel?.dispose();
}
