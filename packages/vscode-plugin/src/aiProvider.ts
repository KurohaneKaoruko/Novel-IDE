import * as vscode from 'vscode';

export interface ChatMessage {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    streaming?: boolean;
    thinking?: string;
    timestamp?: number;
}

export class AIProvider {
    private context: vscode.ExtensionContext;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
    }

    async chat(
        userMessage: string,
        contextText: string,
        onChunk: (chunk: string) => void
    ): Promise<void> {
        const config = vscode.workspace.getConfiguration('novelAI');
        
        const provider = config.get<string>('provider', 'openai');
        const apiBaseUrl = config.get<string>('apiBaseUrl', 'https://api.openai.com/v1');
        const model = config.get<string>('model', 'gpt-4');
        const temperature = config.get<number>('temperature', 0.7);
        const maxTokens = config.get<number>('maxTokens', 4096);
        
        // Get API key from secure storage or config
        let apiKey = config.get<string>('apiKey', '');
        
        if (!apiKey) {
            // Try to get from environment or prompt
            apiKey = process.env.OPENAI_API_KEY || '';
        }
        
        if (!apiKey) {
            const entered = await vscode.window.showInputBox({
                prompt: '请输入API Key',
                password: true
            });
            if (!entered) {
                throw new Error('需要API Key');
            }
            apiKey = entered;
            await config.update('apiKey', apiKey, vscode.ConfigurationTarget.Global);
        }

        // Build messages
        const systemPrompt = this.buildSystemPrompt();
        
        const messages = [
            { role: 'system', content: systemPrompt },
            ...(contextText ? [{ role: 'user' as const, content: `【当前文本上下文】\n${contextText}` }] : []),
            { role: 'user' as const, content: userMessage }
        ];

        // Call API based on provider
        switch (provider) {
            case 'openai':
                await this.callOpenAI(apiBaseUrl, apiKey, model, messages, temperature, maxTokens, onChunk);
                break;
            case 'claude':
                await this.callClaude(apiBaseUrl, apiKey, model, messages, temperature, maxTokens, onChunk);
                break;
            case 'qianwen':
                await this.callQianwen(apiBaseUrl, apiKey, model, messages, temperature, maxTokens, onChunk);
                break;
            default:
                await this.callOpenAI(apiBaseUrl, apiKey, model, messages, temperature, maxTokens, onChunk);
        }
    }

    private buildSystemPrompt(): string {
        return `你是一个专业的网络小说创作助手。

## 你的能力
- 续写小说情节
- 改写/润色现有内容
- 生成人物对话
- 创建场景描写
- 提供剧情建议
- 帮助梳理大纲

## 写作风格
- 使用生动的场景描写
- 人物对话符合性格
- 情节流畅，有张力
- 注意伏笔和节奏

## 注意事项
- 如果用户没有指定具体需求，可以询问用户想要什么帮助
- 保持上下文连贯性
- 适当使用Markdown格式增强可读性`;
    }

    private async callOpenAI(
        baseUrl: string,
        apiKey: string,
        model: string,
        messages: any[],
        temperature: number,
        maxTokens: number,
        onChunk: (chunk: string) => void
    ): Promise<void> {
        const url = `${baseUrl}/chat/completions`;
        
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model,
                messages,
                temperature,
                max_tokens: maxTokens,
                stream: true
            })
        });

        if (!response.ok) {
            const error = await response.text();
            throw new Error(`API错误: ${response.status} - ${error}`);
        }

        const reader = response.body?.getReader();
        if (!reader) {
            throw new Error('无法读取响应');
        }

        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const data = line.slice(6);
                    if (data === '[DONE]') return;

                    try {
                        const json = JSON.parse(data);
                        const content = json.choices?.[0]?.delta?.content;
                        if (content) {
                            onChunk(content);
                        }
                    } catch (e) {
                        // Ignore parse errors
                    }
                }
            }
        }
    }

    private async callClaude(
        baseUrl: string,
        apiKey: string,
        model: string,
        messages: any[],
        temperature: number,
        maxTokens: number,
        onChunk: (chunk: string) => void
    ): Promise<void> {
        const url = `${baseUrl}/messages`;
        
        // Convert messages format for Claude
        const claudeMessages = messages.map(m => ({
            role: m.role === 'system' ? 'system' : m.role,
            content: m.content
        }));

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({
                model: model.replace('claude-', ''),
                messages: claudeMessages,
                temperature,
                max_tokens: maxTokens,
                stream: true
            })
        });

        if (!response.ok) {
            const error = await response.text();
            throw new Error(`API错误: ${response.status} - ${error}`);
        }

        const reader = response.body?.getReader();
        if (!reader) {
            throw new Error('无法读取响应');
        }

        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const data = line.slice(6);
                    if (data === '[DONE]') return;

                    try {
                        const json = JSON.parse(data);
                        const content = json.delta?.text || json.message?.content;
                        if (content) {
                            onChunk(content);
                        }
                    } catch (e) {
                        // Ignore parse errors
                    }
                }
            }
        }
    }

    private async callQianwen(
        baseUrl: string,
        apiKey: string,
        model: string,
        messages: any[],
        temperature: number,
        maxTokens: number,
        onChunk: (chunk: string) => void
    ): Promise<void> {
        // Similar to OpenAI but with different endpoint
        await this.callOpenAI(baseUrl, apiKey, model, messages, temperature, maxTokens, onChunk);
    }

    async showProviderConfig() {
        const config = vscode.workspace.getConfiguration('novelAI');
        
        const provider = await vscode.window.showQuickPick(
            ['openai', 'claude', 'qianwen', 'custom'],
            { placeHolder: '选择AI Provider' }
        );

        if (provider) {
            await config.update('provider', provider, vscode.ConfigurationTarget.Global);
            
            if (provider === 'openai') {
                await config.update('apiBaseUrl', 'https://api.openai.com/v1', vscode.ConfigurationTarget.Global);
                await config.update('model', 'gpt-4', vscode.ConfigurationTarget.Global);
            } else if (provider === 'claude') {
                await config.update('apiBaseUrl', 'https://api.anthropic.com/v1', vscode.ConfigurationTarget.Global);
                await config.update('model', 'claude-sonnet-4-20250514', vscode.ConfigurationTarget.Global);
            }
            
            vscode.window.showInformationMessage(`已切换到 ${provider}，请在设置中配置API Key`);
        }
    }
}
