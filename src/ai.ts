import * as vscode from 'vscode';

export type AiKind = 'explain' | 'review';

const PROMPTS: Record<AiKind, string> = {
  explain: [
    'You are a senior software engineer. Explain the following diff between two files.',
    'Start with a one-paragraph summary of the overall intent of the change, then walk',
    'through the notable changes grouped by theme. Call out any behavioral changes,',
    'renamed symbols, or altered edge cases. Use concise markdown.',
  ].join(' '),
  review: [
    'You are a meticulous code reviewer. Review the following diff and report,',
    'in order of severity: (1) bugs or logic errors introduced, (2) risky edge cases',
    'or missing error handling, (3) simplification and style improvements.',
    'Reference the relevant hunks for each finding. Be specific and actionable.',
    'If the change looks solid, say so briefly instead of inventing problems.',
    'Use concise markdown.',
  ].join(' '),
};

/** Pick the best available chat model, preferring GitHub Copilot. */
export async function selectModel(): Promise<vscode.LanguageModelChat | undefined> {
  const family = vscode.workspace
    .getConfiguration('diffium')
    .get<string>('ai.modelFamily')
    ?.trim();

  let models: vscode.LanguageModelChat[] = [];
  if (family) {
    models = await vscode.lm.selectChatModels({ vendor: 'copilot', family });
  }
  if (models.length === 0) {
    models = await vscode.lm.selectChatModels({ vendor: 'copilot' });
  }
  if (models.length === 0) {
    models = await vscode.lm.selectChatModels({});
  }
  return models[0];
}

/** Run an AI task over a unified patch, streaming chunks to the callback. */
export async function streamAI(
  kind: AiKind,
  patch: string,
  onChunk: (text: string) => void,
  token: vscode.CancellationToken
): Promise<string> {
  const model = await selectModel();
  if (!model) {
    throw new Error(
      'No language model is available. Install and sign in to GitHub Copilot to use AI features.'
    );
  }

  const prompt = `${PROMPTS[kind]}\n\n\`\`\`diff\n${patch}\n\`\`\``;
  const response = await model.sendRequest(
    [vscode.LanguageModelChatMessage.User(prompt)],
    {},
    token
  );

  let full = '';
  for await (const chunk of response.text) {
    full += chunk;
    onChunk(chunk);
  }
  return full;
}

export function friendlyLmError(err: unknown): string {
  if (err instanceof vscode.LanguageModelError) {
    switch (err.code) {
      case vscode.LanguageModelError.NoPermissions.name:
        return 'Access to the language model was not granted. Approve the permission prompt from GitHub Copilot and try again.';
      case vscode.LanguageModelError.Blocked.name:
        return 'The request was blocked by the language model provider.';
      case vscode.LanguageModelError.NotFound.name:
        return 'The requested language model was not found. Check the diffium.ai.modelFamily setting.';
      default:
        return `Language model error: ${err.message}`;
    }
  }
  return err instanceof Error ? err.message : String(err);
}
