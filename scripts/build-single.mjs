import { readFileSync, writeFileSync } from 'node:fs';

const jsFiles = [
  'js/constants.js',
  'js/rules.js',
  'js/bot.js',
  'js/game.js',
  'js/ui.js',
  'js/main.js',
];

function stripModules(source) {
  return source
    .replace(/^import\s+[\s\S]*?from\s+['"][^'"]+['"];\s*/gm, '')
    .replace(/^import\s+['"][^'"]+['"];\s*/gm, '')
    .replace(/^export\s+(?=(?:const|let|var|function|class)\b)/gm, '');
}

let html = readFileSync('index.html', 'utf8');
const css = readFileSync('css/styles.css', 'utf8').replace(/<\/style>/gi, '<\\/style>');
const js = jsFiles
  .map((path) => `// ===== ${path} =====\n${stripModules(readFileSync(path, 'utf8')).trim()}\n`)
  .join('\n')
  .replace(/<\/script>/gi, '<\\/script>');

html = html
  .replace(/\s*<link rel="stylesheet" href="css\/styles\.css"\s*\/?>/, `\n  <style>\n${css}\n  </style>`)
  .replace(/\s*<script type="module" src="js\/main\.js"><\/script>/, `\n  <script>\n${js}\n  </script>`);

if (html.includes('type="module"') || html.includes('src="js/main.js"')) {
  throw new Error('Nie udało się osadzić modułów JavaScript w pliku single-file.');
}

writeFileSync('makao-single.html', html, 'utf8');
console.log(`Wygenerowano makao-single.html (${Buffer.byteLength(html)} B)`);
