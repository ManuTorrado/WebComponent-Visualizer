import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';

execFileSync(process.execPath, ['node_modules/typescript/bin/tsc', '-p', '.'], { stdio: 'inherit' });
// Keep Playwright's runtime files and esbuild's platform binary intact.
rmSync('dist/node_modules', { recursive: true, force: true });
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const dependencies = execFileSync(npm, ['ls', '--omit=dev', '--all', '--parseable'], { encoding: 'utf8' }).trim().split(/\r?\n/).slice(1);
for (const dependency of new Set(dependencies)) {
  const relative = path.relative(path.join(process.cwd(), 'node_modules'), dependency);
  if (relative.startsWith('..')) throw new Error(`Unexpected dependency: ${dependency}`);
  const destination = path.join('dist/node_modules', relative);
  mkdirSync(path.dirname(destination), { recursive: true });
  cpSync(dependency, destination, { recursive: true });
}
