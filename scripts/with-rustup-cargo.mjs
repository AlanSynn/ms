#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { dirname } from 'node:path';

const [cmd, ...args] = process.argv.slice(2);
if (!cmd) {
  console.error('usage: bun scripts/with-rustup-cargo.mjs <command> [...args]');
  process.exit(64);
}

let env = { ...process.env };
const hasCargo = spawnSync('cargo', ['--version'], { stdio: 'ignore', env }).status === 0;
if (!hasCargo) {
  const located = spawnSync('rustup', ['which', 'cargo'], { encoding: 'utf8', env });
  const cargoPath = located.status === 0 ? located.stdout.trim() : '';
  if (cargoPath) env.PATH = `${dirname(cargoPath)}:${env.PATH ?? ''}`;
}

const result = spawnSync(cmd, args, { stdio: 'inherit', env, shell: process.platform === 'win32' });
if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
