import * as path from 'path';
import * as vscode from 'vscode';
import { DiffPanel, type DiffSource } from './diffPanel';

const FOLDER_EXCLUDES = new Set(['.git', 'node_modules', 'dist', 'out', '.vs', '__pycache__']);
const MAX_FOLDER_FILES = 4_000;

export function activate(context: vscode.ExtensionContext): void {
  const { extensionUri } = context;

  context.subscriptions.push(
    vscode.commands.registerCommand('diffium.compareFiles', () => compareFiles(extensionUri)),
    vscode.commands.registerCommand('diffium.compareFolders', () => compareFolders(extensionUri)),
    vscode.commands.registerCommand(
      'diffium.compareSelected',
      (_uri: vscode.Uri, uris?: vscode.Uri[]) => compareSelected(extensionUri, uris)
    ),
    vscode.commands.registerCommand('diffium.compareWithClipboard', () =>
      compareWithClipboard(extensionUri)
    )
  );
}

async function readText(uri: vscode.Uri): Promise<string> {
  const bytes = await vscode.workspace.fs.readFile(uri);
  return Buffer.from(bytes).toString('utf8');
}

function fileSource(left: vscode.Uri, right: vscode.Uri): DiffSource {
  return {
    path: `${path.basename(left.fsPath)} ↔ ${path.basename(right.fsPath)}`,
    status: 'M',
    leftName: path.basename(left.fsPath),
    rightName: path.basename(right.fsPath),
    leftLabel: vscode.workspace.asRelativePath(left, false),
    rightLabel: vscode.workspace.asRelativePath(right, false),
    getLeft: () => readText(left),
    getRight: () => readText(right),
  };
}

async function compareFiles(extensionUri: vscode.Uri): Promise<void> {
  const uris = await vscode.window.showOpenDialog({
    canSelectMany: true,
    openLabel: 'Compare',
    title: 'Select exactly two files to compare (old file first, new file second)',
  });
  if (!uris || uris.length === 0) {
    return;
  }
  if (uris.length !== 2) {
    void vscode.window.showWarningMessage('Diffium: please select exactly two files.');
    return;
  }
  const title = `${path.basename(uris[0].fsPath)} ↔ ${path.basename(uris[1].fsPath)}`;
  DiffPanel.show(extensionUri, title, [fileSource(uris[0], uris[1])]);
}

async function compareSelected(extensionUri: vscode.Uri, uris?: vscode.Uri[]): Promise<void> {
  if (!uris || uris.length !== 2) {
    void vscode.window.showWarningMessage('Diffium: select exactly two items in the Explorer.');
    return;
  }
  const [statA, statB] = await Promise.all([
    vscode.workspace.fs.stat(uris[0]),
    vscode.workspace.fs.stat(uris[1]),
  ]);
  const aIsDir = (statA.type & vscode.FileType.Directory) !== 0;
  const bIsDir = (statB.type & vscode.FileType.Directory) !== 0;
  if (aIsDir !== bIsDir) {
    void vscode.window.showWarningMessage('Diffium: select two files or two folders, not a mix.');
    return;
  }
  if (aIsDir) {
    await openFolderDiff(extensionUri, uris[0], uris[1]);
    return;
  }
  const title = `${path.basename(uris[0].fsPath)} ↔ ${path.basename(uris[1].fsPath)}`;
  DiffPanel.show(extensionUri, title, [fileSource(uris[0], uris[1])]);
}

async function compareWithClipboard(extensionUri: vscode.Uri): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    void vscode.window.showWarningMessage('Diffium: open a file first.');
    return;
  }
  const clipboard = await vscode.env.clipboard.readText();
  const docText = editor.document.getText();
  const name = path.basename(editor.document.uri.fsPath) || 'untitled';
  DiffPanel.show(extensionUri, `Clipboard ↔ ${name}`, [
    {
      path: name,
      status: 'M',
      leftName: 'Clipboard',
      rightName: name,
      leftLabel: 'Clipboard',
      rightLabel: name,
      getLeft: async () => clipboard,
      getRight: async () => docText,
    },
  ]);
}

// ------------------------------------------------------- folder comparison

async function compareFolders(extensionUri: vscode.Uri): Promise<void> {
  const pick = async (title: string) => {
    const result = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      openLabel: 'Select',
      title,
    });
    return result?.[0];
  };
  const leftDir = await pick('Diffium: select the OLD folder');
  if (!leftDir) {
    return;
  }
  const rightDir = await pick('Diffium: select the NEW folder');
  if (!rightDir) {
    return;
  }
  await openFolderDiff(extensionUri, leftDir, rightDir);
}

async function openFolderDiff(
  extensionUri: vscode.Uri,
  leftDir: vscode.Uri,
  rightDir: vscode.Uri
): Promise<void> {
  const sources = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Diffium: comparing folders…' },
    () => collectFolderDiff(leftDir, rightDir)
  );
  if (!sources) {
    return;
  }
  if (sources.length === 0) {
    void vscode.window.showInformationMessage('Diffium: the folders are identical.');
    return;
  }
  const title = `${path.basename(leftDir.fsPath)} ↔ ${path.basename(rightDir.fsPath)}`;
  DiffPanel.show(extensionUri, title, sources);
}

async function collectFolderDiff(
  leftDir: vscode.Uri,
  rightDir: vscode.Uri
): Promise<DiffSource[] | undefined> {
  const leftFiles = new Map<string, vscode.Uri>();
  const rightFiles = new Map<string, vscode.Uri>();
  try {
    await walk(leftDir, '', leftFiles);
    await walk(rightDir, '', rightFiles);
  } catch (err) {
    void vscode.window.showErrorMessage(
      `Diffium: failed to scan folders — ${err instanceof Error ? err.message : String(err)}`
    );
    return undefined;
  }
  if (leftFiles.size >= MAX_FOLDER_FILES || rightFiles.size >= MAX_FOLDER_FILES) {
    void vscode.window.showWarningMessage(
      `Diffium: folder scan capped at ${MAX_FOLDER_FILES} files; results may be incomplete.`
    );
  }

  const leftName = path.basename(leftDir.fsPath);
  const rightName = path.basename(rightDir.fsPath);
  const sources: DiffSource[] = [];
  const allPaths = new Set([...leftFiles.keys(), ...rightFiles.keys()]);

  for (const rel of allPaths) {
    const leftUri = leftFiles.get(rel);
    const rightUri = rightFiles.get(rel);
    let status: string;
    if (leftUri && rightUri) {
      if (await sameContent(leftUri, rightUri)) {
        continue;
      }
      status = 'M';
    } else {
      status = leftUri ? 'D' : 'A';
    }
    const name = path.posix.basename(rel);
    sources.push({
      path: rel,
      status,
      leftName: name,
      rightName: name,
      leftLabel: `${leftName}/${rel}`,
      rightLabel: `${rightName}/${rel}`,
      getLeft: () => (leftUri ? readText(leftUri) : Promise.resolve('')),
      getRight: () => (rightUri ? readText(rightUri) : Promise.resolve('')),
    });
  }

  sources.sort((a, b) => a.path.localeCompare(b.path));
  return sources;
}

async function walk(root: vscode.Uri, prefix: string, out: Map<string, vscode.Uri>): Promise<void> {
  if (out.size >= MAX_FOLDER_FILES) {
    return;
  }
  const entries = await vscode.workspace.fs.readDirectory(
    prefix ? vscode.Uri.joinPath(root, prefix) : root
  );
  for (const [name, type] of entries) {
    if (out.size >= MAX_FOLDER_FILES) {
      return;
    }
    const rel = prefix ? `${prefix}/${name}` : name;
    if (type & vscode.FileType.Directory) {
      if (!FOLDER_EXCLUDES.has(name)) {
        await walk(root, rel, out);
      }
    } else if (type & vscode.FileType.File) {
      out.set(rel, vscode.Uri.joinPath(root, rel));
    }
  }
}

async function sameContent(a: vscode.Uri, b: vscode.Uri): Promise<boolean> {
  const [statA, statB] = await Promise.all([
    vscode.workspace.fs.stat(a),
    vscode.workspace.fs.stat(b),
  ]);
  if (statA.size !== statB.size) {
    return false;
  }
  const [bytesA, bytesB] = await Promise.all([
    vscode.workspace.fs.readFile(a),
    vscode.workspace.fs.readFile(b),
  ]);
  return Buffer.from(bytesA).equals(Buffer.from(bytesB));
}

export function deactivate(): void {
  // disposables are handled via context.subscriptions
}
