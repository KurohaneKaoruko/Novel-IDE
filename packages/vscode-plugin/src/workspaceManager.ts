import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export class WorkspaceManager {
    private context: vscode.ExtensionContext;
    private workspaceRoot: string | undefined;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.initWorkspace();
    }

    private initWorkspace() {
        const config = vscode.workspace.getConfiguration('novelAI');
        this.workspaceRoot = config.get<string>('workspace');

        if (!this.workspaceRoot) {
            // Try to detect from current file
            const editor = vscode.window.activeTextEditor;
            if (editor) {
                const docPath = editor.document.uri.fsPath;
                // Check if in a novel workspace
                if (docPath.includes('/stories/') || docPath.includes('/concept/') || docPath.includes('/outline/')) {
                    this.workspaceRoot = path.dirname(path.dirname(path.dirname(docPath)));
                }
            }
        }
    }

    async ensureWorkspace(): Promise<boolean> {
        if (this.workspaceRoot && fs.existsSync(this.workspaceRoot)) {
            return true;
        }

        // Show workspace picker
        const selected = await vscode.window.showOpenDialog({
            canSelectFolders: true,
            canSelectFiles: false,
            title: '选择小说工作区'
        });

        if (selected.length > 0) {
            this.workspaceRoot = selected[0].fsPath;
            const config = vscode.workspace.getConfiguration('novelAI');
            await config.update('workspace', this.workspaceRoot, vscode.ConfigurationTarget.Global);
            await this.initWorkspaceStructure();
            return true;
        }

        return false;
    }

    async initWorkspaceStructure() {
        if (!this.workspaceRoot) return;

        const dirs = ['concept', 'outline', 'stories', '.novel/settings'];
        
        for (const dir of dirs) {
            const fullPath = path.join(this.workspaceRoot, dir);
            if (!fs.existsSync(fullPath)) {
                fs.mkdirSync(fullPath, { recursive: true });
            }
        }

        // Create default templates if not exist
        const templatesDir = path.join(this.workspaceRoot, '.novel/settings');
        const settingsPath = path.join(templatesDir, 'project.json');
        
        if (!fs.existsSync(settingsPath)) {
            const defaultSettings = {
                chapterWordCount: 3000,
                genre: 'fantasy',
                language: 'zh-CN'
            };
            fs.writeFileSync(settingsPath, JSON.stringify(defaultSettings, null, 2));
        }
    }

    async createNewChapter(): Promise<string | null> {
        const success = await this.ensureWorkspace();
        if (!success || !this.workspaceRoot) {
            vscode.window.showWarningMessage('请先设置小说工作区');
            return null;
        }

        const now = new Date();
        const filename = `chapter-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}.md`;
        
        const chapterPath = path.join(this.workspaceRoot, 'stories', filename);
        
        const content = `# 第${this.getNextChapterNumber()}章

`;

        fs.writeFileSync(chapterPath, content);

        // Open the file
        const doc = await vscode.workspace.openTextDocument(chapterPath);
        await vscode.window.showTextDocument(doc);

        return chapterPath;
    }

    private getNextChapterNumber(): number {
        if (!this.workspaceRoot) return 1;

        const storiesDir = path.join(this.workspaceRoot, 'stories');
        if (!fs.existsSync(storiesDir)) return 1;

        const files = fs.readdirSync(storiesDir).filter(f => f.endsWith('.md'));
        
        let maxNum = 0;
        for (const file of files) {
            const match = file.match(/chapter-(\d+)/);
            if (match) {
                const num = parseInt(match[1].slice(-2));
                if (num > maxNum) maxNum = num;
            }
        }

        return maxNum + 1;
    }

    getWorkspace(): string | undefined {
        return this.workspaceRoot;
    }

    async openWorkspace() {
        const selected = await vscode.window.showOpenDialog({
            canSelectFolders: true,
            canSelectFiles: false,
            title: '打开小说工作区'
        });

        if (selected.length > 0) {
            this.workspaceRoot = selected[0].fsPath;
            const config = vscode.workspace.getConfiguration('novelAI');
            await config.update('workspace', this.workspaceRoot, vscode.ConfigurationTarget.Global);
            
            // Open the workspace in explorer
            vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(this.workspaceRoot));
        }
    }
}
