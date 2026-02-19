import * as vscode from 'vscode';
import * as path from 'path';
import { WorkspaceManager } from './workspaceManager';
import { AIProvider, ChatMessage } from './aiProvider';

export class ChatPanel {
    private panel: vscode.WebviewPanel | undefined;
    private context: vscode.ExtensionContext;
    private workspaceManager: WorkspaceManager;
    private aiProvider: AIProvider;
    private messages: ChatMessage[] = [];
    private isStreaming = false;

    constructor(
        context: vscode.ExtensionContext,
        workspaceManager: WorkspaceManager,
        aiProvider: AIProvider
    ) {
        this.context = context;
        this.workspaceManager = workspaceManager;
        this.aiProvider = aiProvider;
    }

    show() {
        if (this.panel) {
            this.panel.reveal();
            return;
        }

        this.panel = vscode.window.createWebviewPanel(
            'novelAI',
            '🤖 Novel AI 助手',
            vscode.ViewColumn.Two,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [
                    path.join(this.context.extensionPath, 'assets')
                ]
            }
        );

        this.panel.webview.html = this.getHtml();
        this.panel.onDidDispose(() => {
            this.panel = undefined;
        });

        // Handle messages from webview
        this.panel.webview.onDidReceiveMessage(async (message) => {
            await this.handleWebviewMessage(message);
        });
    }

    private async handleWebviewMessage(message: any) {
        switch (message.type) {
            case 'send':
                await this.sendMessage(message.content);
                break;
            case 'clear':
                this.messages = [];
                this.panel?.webview.postMessage({ type: 'messages', messages: [] });
                break;
            case 'quoteSelection':
                this.quoteSelection();
                break;
            case 'insertText':
                await this.insertText(message.text);
                break;
            case 'getSettings':
                await this.sendSettings();
                break;
            case 'saveSettings':
                await this.saveSettings(message.settings);
                break;
        }
    }

    private async sendMessage(content: string) {
        if (this.isStreaming || !content.trim()) return;

        // Add user message
        const userMessage: ChatMessage = {
            id: Date.now().toString(),
            role: 'user',
            content,
            timestamp: Date.now()
        };
        this.messages.push(userMessage);

        // Add placeholder for AI response
        const aiMessage: ChatMessage = {
            id: (Date.now() + 1).toString(),
            role: 'assistant',
            content: '',
            streaming: true,
            timestamp: Date.now()
        };
        this.messages.push(aiMessage);

        // Update UI
        this.panel?.webview.postMessage({ type: 'messages', messages: this.messages });

        this.isStreaming = true;

        try {
            // Get editor context
            const editor = vscode.window.activeTextEditor;
            let contextText = '';
            if (editor) {
                const selection = editor.selection;
                if (!selection.isEmpty) {
                    contextText = editor.document.getText(selection);
                } else {
                    // Get surrounding context
                    const position = selection.start;
                    const range = new vscode.Range(
                        Math.max(0, position.line - 10),
                        0,
                        position.line,
                        position.character
                    );
                    contextText = editor.document.getText(range);
                }
            }

            // Stream response
            await this.aiProvider.chat(
                content,
                contextText,
                (chunk) => {
                    aiMessage.content += chunk;
                    this.panel?.webview.postMessage({ 
                        type: 'messageUpdate', 
                        message: aiMessage 
                    });
                }
            );

            aiMessage.streaming = false;
            this.panel?.webview.postMessage({ type: 'messageUpdate', message: aiMessage });

        } catch (error: any) {
            aiMessage.content = `❌ 错误: ${error.message}`;
            aiMessage.streaming = false;
            this.panel?.webview.postMessage({ type: 'messageUpdate', message: aiMessage });
        }

        this.isStreaming = false;
    }

    quoteSelection() {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showWarningMessage('没有活动的编辑器');
            return;
        }

        const selection = editor.selection;
        const text = editor.document.getText(selection);

        if (!text) {
            vscode.window.showInformationMessage('请先选中一些文字');
            return;
        }

        this.panel?.webview.postMessage({ 
            type: 'quoteText', 
            text: `[引用选区]\n${text}` 
        });
        this.show();
    }

    async insertToCursor() {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showWarningMessage('没有活动的编辑器');
            return;
        }

        const lastMessage = this.messages.filter(m => m.role === 'assistant').pop();
        if (!lastMessage?.content) {
            vscode.window.showWarningMessage('没有AI输出可插入');
            return;
        }

        await this.insertText(lastMessage.content);
    }

    private async insertText(text: string) {
        const editor = vscode.window.activeTextEditor;
        if (!editor) return;

        const selection = editor.selection;
        await editor.edit(editBuilder => {
            if (!selection.isEmpty) {
                editBuilder.replace(selection, text);
            } else {
                editBuilder.insert(selection.start, text);
            }
        });
    }

    async triggerSmartComplete() {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showWarningMessage('没有活动的编辑器');
            return;
        }

        const config = vscode.workspace.getConfiguration('novelAI');
        const targetWordCount = config.get<number>('chapterWordCount', 3000);

        // Get current document context
        const doc = editor.document;
        const fullText = doc.getText();
        const currentWordCount = fullText.length;

        const prompt = `智能补全提示：
- 当前字数: ${currentWordCount}
- 目标字数: ${targetWordCount}
- 请根据以下上下文续写故事，帮助达到目标字数：

${editor.document.getText(editor.selection.isEmpty ? 
    new vscode.Range(0, 0, editor.selection.start.line, editor.selection.start.character) : 
    editor.selection)}`;

        await this.sendMessage(prompt);
        this.show();
    }

    private async sendSettings() {
        const config = vscode.workspace.getConfiguration('novelAI');
        const settings = {
            provider: config.get('provider', 'openai'),
            apiBaseUrl: config.get('apiBaseUrl', 'https://api.openai.com/v1'),
            model: config.get('model', 'gpt-4'),
            temperature: config.get('temperature', 0.7),
            maxTokens: config.get('maxTokens', 4096),
            enableMarkdown: config.get('enableMarkdown', true),
            theme: config.get('theme', 'auto')
        };
        this.panel?.webview.postMessage({ type: 'settings', settings });
    }

    private async saveSettings(settings: any) {
        const config = vscode.workspace.getConfiguration('novelAI');
        for (const [key, value] of Object.entries(settings)) {
            await config.update(key, value, vscode.ConfigurationTarget.Global);
        }
        vscode.window.showInformationMessage('设置已保存');
    }

    private getHtml(): string {
        return `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        
        :root {
            --bg-primary: #1e1e1e;
            --bg-secondary: #252526;
            --bg-tertiary: #2d2d2d;
            --text-primary: #cccccc;
            --text-secondary: #858585;
            --accent: #569cd6;
            --accent-hover: #4fc1ff;
            --user-msg-bg: #264f78;
            --ai-msg-bg: #2d2d30;
            --border: #3c3c3c;
            --success: #4ec9b0;
            --error: #f14c4c;
        }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: var(--bg-primary);
            color: var(--text-primary);
            height: 100vh;
            display: flex;
            flex-direction: column;
        }
        
        .header {
            padding: 12px 16px;
            background: var(--bg-secondary);
            border-bottom: 1px solid var(--border);
            display: flex;
            align-items: center;
            justify-content: space-between;
        }
        
        .header-title {
            display: flex;
            align-items: center;
            gap: 8px;
            font-size: 14px;
            font-weight: 600;
        }
        
        .header-actions {
            display: flex;
            gap: 8px;
        }
        
        .btn {
            padding: 6px 12px;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 12px;
            transition: all 0.2s;
        }
        
        .btn-primary {
            background: var(--accent);
            color: white;
        }
        
        .btn-primary:hover {
            background: var(--accent-hover);
        }
        
        .btn-secondary {
            background: var(--bg-tertiary);
            color: var(--text-primary);
        }
        
        .btn-secondary:hover {
            background: #3c3c3c;
        }
        
        .messages {
            flex: 1;
            overflow-y: auto;
            padding: 16px;
            display: flex;
            flex-direction: column;
            gap: 16px;
        }
        
        .message {
            display: flex;
            gap: 12px;
            max-width: 100%;
        }
        
        .message-user {
            flex-direction: row-reverse;
        }
        
        .avatar {
            width: 32px;
            height: 32px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 16px;
            flex-shrink: 0;
        }
        
        .avatar-user {
            background: var(--accent);
        }
        
        .avatar-ai {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        }
        
        .message-content {
            background: var(--ai-msg-bg);
            padding: 12px 16px;
            border-radius: 12px;
            max-width: 80%;
            line-height: 1.6;
            white-space: pre-wrap;
            word-break: break-word;
        }
        
        .message-user .message-content {
            background: var(--user-msg-bg);
        }
        
        .message-content p {
            margin-bottom: 8px;
        }
        
        .message-content p:last-child {
            margin-bottom: 0;
        }
        
        .streaming-indicator {
            display: inline-block;
            animation: blink 1s infinite;
        }
        
        @keyframes blink {
            0%, 50% { opacity: 1; }
            51%, 100% { opacity: 0; }
        }
        
        .empty-state {
            flex: 1;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            color: var(--text-secondary);
            text-align: center;
            padding: 40px;
        }
        
        .empty-icon {
            font-size: 48px;
            margin-bottom: 16px;
        }
        
        .empty-title {
            font-size: 16px;
            margin-bottom: 8px;
        }
        
        .empty-hint {
            font-size: 12px;
            opacity: 0.7;
        }
        
        .input-area {
            padding: 16px;
            background: var(--bg-secondary);
            border-top: 1px solid var(--border);
        }
        
        .input-container {
            display: flex;
            gap: 8px;
            align-items: flex-end;
        }
        
        .input-wrapper {
            flex: 1;
            position: relative;
        }
        
        textarea {
            width: 100%;
            background: var(--bg-tertiary);
            border: 1px solid var(--border);
            border-radius: 8px;
            padding: 12px;
            color: var(--text-primary);
            font-family: inherit;
            font-size: 14px;
            resize: none;
            min-height: 60px;
            max-height: 200px;
        }
        
        textarea:focus {
            outline: none;
            border-color: var(--accent);
        }
        
        textarea::placeholder {
            color: var(--text-secondary);
        }
        
        .input-actions {
            display: flex;
            gap: 8px;
            margin-bottom: 8px;
        }
        
        .action-btn {
            padding: 4px 8px;
            font-size: 11px;
            background: var(--bg-tertiary);
            border: 1px solid var(--border);
            border-radius: 4px;
            color: var(--text-secondary);
            cursor: pointer;
        }
        
        .action-btn:hover {
            background: #3c3c3c;
            color: var(--text-primary);
        }
        
        .send-btn {
            width: 60px;
            height: 60px;
            border: none;
            border-radius: 8px;
            background: var(--accent);
            color: white;
            cursor: pointer;
            font-size: 20px;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all 0.2s;
        }
        
        .send-btn:hover:not(:disabled) {
            background: var(--accent-hover);
            transform: scale(1.05);
        }
        
        .send-btn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }
        
        .typing {
            display: flex;
            gap: 4px;
            padding: 8px 12px;
        }
        
        .typing span {
            width: 8px;
            height: 8px;
            background: var(--text-secondary);
            border-radius: 50%;
            animation: typing 1.4s infinite;
        }
        
        .typing span:nth-child(2) { animation-delay: 0.2s; }
        .typing span:nth-child(3) { animation-delay: 0.4s; }
        
        @keyframes typing {
            0%, 60%, 100% { transform: translateY(0); }
            30% { transform: translateY(-4px); }
        }
        
        .settings-modal {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0,0,0,0.7);
            display: none;
            align-items: center;
            justify-content: center;
            z-index: 1000;
        }
        
        .settings-modal.show {
            display: flex;
        }
        
        .settings-content {
            background: var(--bg-secondary);
            border-radius: 12px;
            padding: 24px;
            width: 400px;
            max-height: 80vh;
            overflow-y: auto;
        }
        
        .settings-title {
            font-size: 16px;
            font-weight: 600;
            margin-bottom: 16px;
        }
        
        .setting-item {
            margin-bottom: 16px;
        }
        
        .setting-label {
            display: block;
            font-size: 12px;
            color: var(--text-secondary);
            margin-bottom: 4px;
        }
        
        .setting-input {
            width: 100%;
            padding: 8px;
            background: var(--bg-tertiary);
            border: 1px solid var(--border);
            border-radius: 4px;
            color: var(--text-primary);
        }
        
        .setting-select {
            width: 100%;
            padding: 8px;
            background: var(--bg-tertiary);
            border: 1px solid var(--border);
            border-radius: 4px;
            color: var(--text-primary);
        }
    </style>
</head>
<body>
    <div class="header">
        <div class="header-title">
            <span>🤖</span>
            <span>Novel AI 助手</span>
        </div>
        <div class="header-actions">
            <button class="btn btn-secondary" onclick="showSettings()">⚙️ 设置</button>
            <button class="btn btn-secondary" onclick="clearChat()">🗑️ 清空</button>
        </div>
    </div>
    
    <div class="messages" id="messages">
        <div class="empty-state" id="emptyState">
            <div class="empty-icon">✍️</div>
            <div class="empty-title">开始你的小说创作</div>
            <div class="empty-hint">
                选中文字后点击"引用选区"可让AI理解上下文<br>
                按 Ctrl+Enter 发送消息
            </div>
        </div>
    </div>
    
    <div class="input-area">
        <div class="input-actions">
            <button class="action-btn" onclick="quoteSelection()">📋 引用选区</button>
            <button class="action-btn" onclick="newChapter()">📄 新建章节</button>
            <button class="action-btn" onclick="smartComplete()">✨ 智能补全</button>
        </div>
        <div class="input-container">
            <div class="input-wrapper">
                <textarea 
                    id="input" 
                    placeholder="输入消息... (Ctrl+Enter 发送)"
                    rows="2"
                ></textarea>
            </div>
            <button class="send-btn" id="sendBtn" onclick="send()">➤</button>
        </div>
    </div>
    
    <div class="settings-modal" id="settingsModal">
        <div class="settings-content">
            <div class="settings-title">⚙️ 设置</div>
            
            <div class="setting-item">
                <label class="setting-label">Provider</label>
                <select class="setting-select" id="settingProvider">
                    <option value="openai">OpenAI</option>
                    <option value="claude">Claude</option>
                    <option value="qianwen">文心一言</option>
                    <option value="custom">自定义</option>
                </select>
            </div>
            
            <div class="setting-item">
                <label class="setting-label">API Base URL</label>
                <input class="setting-input" id="settingApiBaseUrl" type="text">
            </div>
            
            <div class="setting-item">
                <label class="setting-label">Model</label>
                <input class="setting-input" id="settingModel" type="text">
            </div>
            
            <div class="setting-item">
                <label class="setting-label">API Key</label>
                <input class="setting-input" id="settingApiKey" type="password">
            </div>
            
            <div class="setting-item">
                <label class="setting-label">Temperature</label>
                <input class="setting-input" id="settingTemperature" type="number" min="0" max="2" step="0.1">
            </div>
            
            <div class="setting-item">
                <label class="setting-label">Max Tokens</label>
                <input class="setting-input" id="settingMaxTokens" type="number">
            </div>
            
            <div style="display: flex; gap: 8px; margin-top: 16px;">
                <button class="btn btn-primary" onclick="saveSettings()">保存</button>
                <button class="btn btn-secondary" onclick="hideSettings()">取消</button>
            </div>
        </div>
    </div>
    
    <script>
        const vscode = acquireVsCodeApi();
        let messages = [];
        
        document.getElementById('input').addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                send();
            }
        });
        
        function send() {
            const input = document.getElementById('input');
            const content = input.value.trim();
            if (!content) return;
            
            input.value = '';
            vscode.postMessage({ type: 'send', content });
        }
        
        function quoteSelection() {
            vscode.postMessage({ type: 'quoteSelection' });
        }
        
        function newChapter() {
            vscode.postMessage({ type: 'command', command: 'novel-ai.newChapter' });
        }
        
        function smartComplete() {
            vscode.postMessage({ type: 'command', command: 'novel-ai.smartComplete' });
        }
        
        function clearChat() {
            messages = [];
            renderMessages();
            vscode.postMessage({ type: 'clear' });
        }
        
        function showSettings() {
            vscode.postMessage({ type: 'getSettings' });
            document.getElementById('settingsModal').classList.add('show');
        }
        
        function hideSettings() {
            document.getElementById('settingsModal').classList.remove('show');
        }
        
        function saveSettings() {
            const settings = {
                provider: document.getElementById('settingProvider').value,
                apiBaseUrl: document.getElementById('settingApiBaseUrl').value,
                model: document.getElementById('settingModel').value,
                apiKey: document.getElementById('settingApiKey').value,
                temperature: parseFloat(document.getElementById('settingTemperature').value),
                maxTokens: parseInt(document.getElementById('settingMaxTokens').value)
            };
            vscode.postMessage({ type: 'saveSettings', settings });
            hideSettings();
        }
        
        function insertToCursor() {
            const lastAiMessage = messages.filter(m => m.role === 'assistant').pop();
            if (lastAiMessage) {
                vscode.postMessage({ type: 'insertText', text: lastAiMessage.content });
            }
        }
        
        function renderMessages() {
            const container = document.getElementById('messages');
            const emptyState = document.getElementById('emptyState');
            
            if (messages.length === 0) {
                emptyState.style.display = 'flex';
                container.querySelectorAll('.message').forEach(el => el.remove());
                return;
            }
            
            emptyState.style.display = 'none';
            
            // Remove old messages
            container.querySelectorAll('.message').forEach(el => el.remove());
            
            messages.forEach(msg => {
                const div = document.createElement('div');
                div.className = 'message' + (msg.role === 'user' ? ' message-user' : '');
                
                const avatar = msg.role === 'user' ? '👤' : '🤖';
                const content = msg.content + (msg.streaming ? '<span class="streaming-indicator">▍</span>' : '');
                
                div.innerHTML = \`
                    <div class="avatar \${msg.role === 'user' ? 'avatar-user' : 'avatar-ai'}">\${avatar}</div>
                    <div class="message-content">\${content}</div>
                \`;
                
                container.appendChild(div);
            });
            
            container.scrollTop = container.scrollHeight;
        }
        
        // Handle messages from extension
        window.addEventListener('message', (event) => {
            const data = event.data;
            
            switch (data.type) {
                case 'messages':
                    messages = data.messages;
                    renderMessages();
                    break;
                case 'messageUpdate':
                    const idx = messages.findIndex(m => m.id === data.message.id);
                    if (idx !== -1) {
                        messages[idx] = data.message;
                        renderMessages();
                    }
                    break;
                case 'quoteText':
                    const input = document.getElementById('input');
                    input.value = (input.value ? input.value + '\\n' : '') + data.text;
                    input.focus();
                    break;
                case 'settings':
                    document.getElementById('settingProvider').value = data.settings.provider;
                    document.getElementById('settingApiBaseUrl').value = data.settings.apiBaseUrl;
                    document.getElementById('settingModel').value = data.settings.model;
                    document.getElementById('settingTemperature').value = data.settings.temperature;
                    document.getElementById('settingMaxTokens').value = data.settings.maxTokens;
                    break;
            }
        });
    </script>
</body>
</html>`;
    }

    dispose() {
        this.panel?.dispose();
    }
}
