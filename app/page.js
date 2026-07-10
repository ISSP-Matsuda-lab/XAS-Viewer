import fs from 'node:fs';
import path from 'node:path';
import Script from 'next/script';

export const dynamic = 'force-static';

function readProjectFile(filePath) {
  return fs.readFileSync(path.join(process.cwd(), filePath), 'utf8');
}

function readBodyMarkup() {
  const html = readProjectFile('index.html');
  const match = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  const body = match ? match[1] : html;
  return body.replace(/<script\b[\s\S]*?<\/script>/gi, '').trim();
}

export default function Page() {
  return (
    <>
      <div dangerouslySetInnerHTML={{ __html: readBodyMarkup() }} />
      <Script id="xas-core" strategy="afterInteractive" dangerouslySetInnerHTML={{ __html: readProjectFile('src/xas-core.js') }} />
      <Script id="xas-app" strategy="afterInteractive" dangerouslySetInnerHTML={{ __html: readProjectFile('src/app.js') }} />
    </>
  );
}
