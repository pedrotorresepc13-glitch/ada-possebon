// Varredura de segredos em arquivos versionados (CI). Não substitui um scanner dedicado.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
const SKIP = /^(vendor\/|props\/|assets\/|package-lock\.json$)|\.(png|jpg|glb|wasm|task)$/;
const PATTERNS = [
  [/-----BEGIN (RSA |EC |OPENSSH |)PRIVATE KEY-----/, 'chave privada'],
  [/"private_key"\s*:\s*"-----BEGIN/, 'conta de serviço com chave privada'],
  [/\bsk-(proj-)?[A-Za-z0-9_-]{32,}\b/, 'chave estilo OpenAI'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'chave AWS'],
  [/\bghp_[A-Za-z0-9]{36}\b/, 'token GitHub'],
  [/\bxox[bpas]-[A-Za-z0-9-]{20,}\b/, 'token Slack'],
  [/postgres(ql)?:\/\/[^:\s<]+:[^@\s<]{6,}@/, 'URL de banco com senha']
];
let found = 0;
for (const f of files) {
  if (SKIP.test(f) || f === '.env') continue;
  let text;
  try {
    text = readFileSync(f, 'utf8');
  } catch {
    continue;
  }
  for (const [re, label] of PATTERNS) {
    if (re.test(text)) {
      console.error(`✘ ${f}: possível ${label}`);
      found++;
    }
  }
}
if (files.includes('.env')) {
  console.error('✘ .env está versionado');
  found++;
}
if (found) process.exit(1);
console.log(`✔ nenhum segredo aparente em ${files.length} arquivos versionados`);
