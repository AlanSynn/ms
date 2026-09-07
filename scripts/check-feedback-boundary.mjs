import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const filesIn = directory => existsSync(directory) ? readdirSync(directory, { withFileTypes: true })
  .flatMap(entry => entry.isDirectory() ? filesIn(join(directory, entry.name)) : [join(directory, entry.name)]) : [];
const browserRoots = ['components', 'hooks', 'utils', 'runtime', 'shared'];
const errors = [];
for (const file of browserRoots.flatMap(filesIn).filter(file => /\.[jt]sx?$/.test(file))) {
  const source = readFileSync(file, 'utf8');
  if (/GITHUB_FEEDBACK_TOKEN|FEEDBACK_RECEIPT_SECRET|uploads\.github\.com|workers\/feedback/.test(source)) {
    errors.push(`Worker-only code entered browser source: ${file}`);
  }
}
for (const key of Object.keys(process.env)) {
  if (/^VITE_.*(?:TOKEN|SECRET|PASSWORD)/i.test(key)) errors.push(`Secret-shaped browser environment key: ${key}`);
}
for (const file of filesIn('dist').filter(file => /\.(?:js|map|html|json)$/.test(file))) {
  const built = readFileSync(file, 'utf8');
  if (/GITHUB_FEEDBACK_TOKEN|FEEDBACK_RECEIPT_SECRET|uploads\.github\.com|github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{20,}/.test(built)) {
    errors.push(`Feedback credential/Worker boundary failed: ${file}`);
  }
}
if (errors.length) throw new Error(errors.join('\n'));
console.log('Feedback browser/Worker boundary passed.');
