import { execFileSync } from 'node:child_process';
const target = `${process.platform === 'win32' ? 'win32' : process.platform}-${process.arch}`;
execFileSync(process.execPath, ['node_modules/@vscode/vsce/vsce', 'package', '--no-dependencies', '--allow-missing-repository', '--target', target], { stdio: 'inherit' });
