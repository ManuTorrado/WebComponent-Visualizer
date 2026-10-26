const vscode = require('vscode');
const assert = require('node:assert/strict');
const path = require('node:path');

exports.run = async function () {
  const extension = vscode.extensions.getExtension('wc-visualizer.wc-visualizer');
  assert.ok(extension, 'extension must be discovered by VS Code');
  await extension.activate();
  const commands = await vscode.commands.getCommands(true);
  for (const name of ['preview', 'prewarm', 'installBrowser', 'stop']) {
    assert.ok(commands.includes(`wcVisualizer.${name}`), `${name} must be registered`);
  }
  const uri = vscode.Uri.file(path.join(__dirname, '../examples/counter-card.ts'));
  await vscode.window.showTextDocument(uri);
  await vscode.commands.executeCommand('wcVisualizer.preview', uri);
  const tabs = () => vscode.window.tabGroups.all.flatMap(group => group.tabs);
  const deadline = Date.now() + 5000;
  while (!tabs().some(tab => tab.label === '<counter-card>') && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(tabs().some(tab => tab.label === '<counter-card>'), 'preview panel must open beside editor');
  // Leave the webview time to complete its ready handshake and start rendering.
  await new Promise(resolve => setTimeout(resolve, Number(process.env.WC_VISUALIZER_TEST_DWELL || 5000)));
  await vscode.commands.executeCommand('wcVisualizer.stop');
  const stopDeadline = Date.now() + 5000;
  while (tabs().some(tab => tab.label === '<counter-card>') && Date.now() < stopDeadline) {
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(!tabs().some(tab => tab.label === '<counter-card>'), 'stop must dispose preview panels');
  console.log('VS Code smoke test passed: activation, commands, preview panel, shutdown.');
};
