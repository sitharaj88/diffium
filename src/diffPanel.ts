import * as vscode from 'vscode';
import { createTwoFilesPatch } from 'diff';
import { computeDiff } from './diffEngine';
import { streamAI, friendlyLmError, type AiKind } from './ai';

const MAX_DIFF_BYTES = 8_000_000;
const MAX_PATCH_CHARS = 90_000;

/** One comparison in a session (a file pair); content is loaded lazily. */
export interface DiffSource {
  /** display path in the sidebar (relative, forward slashes) */
  path: string;
  /** 'M' | 'A' | 'D' | '' */
  status: string;
  leftName: string;
  rightName: string;
  leftLabel: string;
  rightLabel: string;
  getLeft(): Promise<string>;
  getRight(): Promise<string>;
}

interface SessionOptions {
  ignoreWhitespace: boolean;
  swapped: boolean;
}

export class DiffPanel {
  private static current: DiffPanel | undefined;

  static show(extensionUri: vscode.Uri, title: string, sources: DiffSource[]): void {
    if (DiffPanel.current) {
      DiffPanel.current.setSession(title, sources);
      DiffPanel.current.panel.reveal(vscode.ViewColumn.Active);
      return;
    }
    const panel = vscode.window.createWebviewPanel('diffium.diff', title, vscode.ViewColumn.Active, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'dist')],
    });
    DiffPanel.current = new DiffPanel(panel, extensionUri, title, sources);
  }

  private title: string;
  private sources: DiffSource[];
  private contentCache = new Map<number, { left: string; right: string }>();
  private options: SessionOptions = { ignoreWhitespace: false, swapped: false };
  private aiCts: vscode.CancellationTokenSource | undefined;

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    title: string,
    sources: DiffSource[]
  ) {
    this.title = title;
    this.sources = sources;
    panel.iconPath = new vscode.ThemeIcon('git-compare');
    panel.webview.html = this.getHtml(panel.webview, extensionUri);
    panel.webview.onDidReceiveMessage((msg) => this.onMessage(msg));
    panel.onDidDispose(() => {
      this.aiCts?.cancel();
      DiffPanel.current = undefined;
    });
  }

  private setSession(title: string, sources: DiffSource[]): void {
    this.aiCts?.cancel();
    this.title = title;
    this.sources = sources;
    this.contentCache.clear();
    this.options = { ignoreWhitespace: false, swapped: false };
    this.panel.title = title;
    this.postSession();
  }

  private post(message: unknown): void {
    void this.panel.webview.postMessage(message);
  }

  private postSession(): void {
    this.post({
      type: 'session',
      title: this.title,
      files: this.sources.map((s) => ({ path: s.path, status: s.status })),
      options: this.options,
      contextLines: vscode.workspace.getConfiguration('diffium').get<number>('contextLines', 3),
    });
  }

  private async onMessage(msg: { type: string; [key: string]: unknown }): Promise<void> {
    switch (msg.type) {
      case 'ready':
        this.postSession();
        break;
      case 'open':
        await this.sendModel(msg.index as number);
        break;
      case 'setOptions': {
        const opts = msg.options as Partial<SessionOptions>;
        this.options = { ...this.options, ...opts };
        await this.sendModel(msg.index as number);
        break;
      }
      case 'ai':
        await this.runAI(msg.kind as AiKind, msg.index as number);
        break;
      case 'aiCancel':
        this.aiCts?.cancel();
        break;
    }
  }

  /** Left/right content of a source, honoring the swap option. */
  private async loadContent(index: number): Promise<{ left: string; right: string }> {
    let content = this.contentCache.get(index);
    if (!content) {
      const source = this.sources[index];
      const [left, right] = await Promise.all([source.getLeft(), source.getRight()]);
      content = { left, right };
      this.contentCache.set(index, content);
    }
    return this.options.swapped ? { left: content.right, right: content.left } : content;
  }

  /** Display names/labels for a source, honoring the swap option. */
  private sides(source: DiffSource): {
    leftName: string;
    rightName: string;
    leftLabel: string;
    rightLabel: string;
  } {
    if (this.options.swapped) {
      return {
        leftName: source.rightName,
        rightName: source.leftName,
        leftLabel: source.rightLabel,
        rightLabel: source.leftLabel,
      };
    }
    return {
      leftName: source.leftName,
      rightName: source.rightName,
      leftLabel: source.leftLabel,
      rightLabel: source.rightLabel,
    };
  }

  private async sendModel(index: number): Promise<void> {
    const source = this.sources[index];
    if (!source) {
      return;
    }
    const base = { type: 'model', index, ...this.sides(source), options: this.options };
    try {
      const { left, right } = await this.loadContent(index);
      if (left.includes('\0') || right.includes('\0')) {
        this.post({ ...base, note: 'Binary file — cannot display a text diff.' });
        return;
      }
      if (left.length + right.length > MAX_DIFF_BYTES) {
        this.post({ ...base, note: 'These files are too large to diff in the viewer.' });
        return;
      }
      const { rows, added, removed } = computeDiff(left, right, {
        ignoreWhitespace: this.options.ignoreWhitespace,
      });
      this.post({ ...base, rows, added, removed });
    } catch (err) {
      this.post({
        ...base,
        note: `Failed to load diff: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  private async buildPatch(index: number): Promise<string> {
    const source = this.sources[index];
    const { left, right } = await this.loadContent(index);
    const sides = this.sides(source);
    const patch = createTwoFilesPatch(
      `a/${sides.leftName}`,
      `b/${sides.rightName}`,
      left.replace(/\r\n/g, '\n'),
      right.replace(/\r\n/g, '\n'),
      sides.leftLabel,
      sides.rightLabel,
      { context: 3 }
    );
    if (patch.length > MAX_PATCH_CHARS) {
      return `${patch.slice(0, MAX_PATCH_CHARS)}\n(… diff truncated for length)`;
    }
    return patch;
  }

  private async runAI(kind: AiKind, index: number): Promise<void> {
    this.aiCts?.cancel();
    const cts = new vscode.CancellationTokenSource();
    this.aiCts = cts;
    this.post({ type: 'aiStart', kind });
    try {
      const patch = await this.buildPatch(index);
      if (!patch.trim()) {
        throw new Error('The diff is empty.');
      }
      await streamAI(kind, patch, (text) => this.post({ type: 'aiChunk', text }), cts.token);
      this.post({ type: 'aiEnd' });
    } catch (err) {
      if (!cts.token.isCancellationRequested) {
        this.post({ type: 'aiError', message: friendlyLmError(err) });
      }
    } finally {
      if (this.aiCts === cts) {
        this.aiCts = undefined;
      }
      cts.dispose();
    }
  }

  private getHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'dist', 'webview.js'));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'dist', 'webview.css'));
    const nonce = getNonce();
    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link href="${styleUri}" rel="stylesheet">
  <title>Diffium</title>
</head>
<body>
  <div id="app"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let text = '';
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}
