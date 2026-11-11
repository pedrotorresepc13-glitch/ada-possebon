import { readFileSync, writeFileSync } from 'node:fs';
const path = process.argv[2];
if (!path) throw new Error('Informe o arquivo de configuração.');
const keys = ['ADA_AI_MONTHLY_TOKENS_PER_USER', 'ADA_AI_DAILY_REQUESTS_PER_USER', 'ADA_CHAT_PER_MINUTE'];
const lines = readFileSync(path, 'utf8').split('\n').filter(line => {
  const key = line.trim().replace(/^export\s+/, '').split('=')[0].trim();
  return !keys.includes(key);
});
writeFileSync(path, lines.join('\n') + '\n' + keys.map(key => key + '=0').join('\n') + '\n');
console.log('Cotas internas de conversa desativadas.');
