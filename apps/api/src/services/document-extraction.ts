import { execFile } from 'node:child_process';

export const documentExtractors: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
};

function convert(command: string, args: string[], input: Buffer, timeout = 20_000, maxBuffer = 8_000_000) {
  return new Promise<Buffer>((resolve, reject) => {
    const child = execFile(command, args, {
      timeout, maxBuffer, encoding: 'buffer', windowsHide: true,
      env: {
        PATH: process.env.PATH,
        SystemRoot: process.env.SystemRoot,
        TEMP: process.env.TEMP,
        TMPDIR: process.env.TMPDIR,
        LANG: 'C.UTF-8'
      }
    }, (error, stdout) => {
      if (!error) return resolve(stdout);
      reject(new Error(error.code === 'ENOENT'
        ? `Extrator ${command} não está instalado. O arquivo pode ser reprocessado.`
        : `Extrator ${command} não conseguiu ler o arquivo dentro dos limites de processamento.`));
    });
    child.stdin?.on('error', () => { /* O resultado do processo informa a falha. */ });
    child.stdin?.end(input);
  });
}

export async function extractDocumentText(extension: string, input: Buffer): Promise<string> {
  if (extension === '.docx') {
    return (await convert('pandoc', ['--sandbox', '-f', 'docx', '-t', 'plain', '--wrap=none'], input)).toString('utf8');
  }
  if (extension === '.xlsx') {
    return (await convert('xlsx2csv', ['-a', '-c', 'utf-8', '-'], input)).toString('utf8');
  }
  const pdfText = ['-layout', '-enc', 'UTF-8', '-', '-'];
  const text = (await convert('pdftotext', pdfText, input)).toString('utf8');
  if (text.trim()) return text;
  const scanned = await convert('ocrmypdf', [
    '--skip-text', '--output-type', 'pdf', '--jobs', '1', '--tesseract-timeout', '20',
    '--optimize', '0', '-l', 'por', '-', '-'
  ], input, 60_000, 24_000_000);
  return (await convert('pdftotext', pdfText, scanned)).toString('utf8');
}
