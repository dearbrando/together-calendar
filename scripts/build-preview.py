# Builds preview/together-preview.html: a single-file, device-only preview of the app.
import re, base64, pathlib
root = pathlib.Path(__file__).resolve().parent.parent
css = (root/'public/app.css').read_text(); js = (root/'public/qr.js').read_text() + '\n' + (root/'public/app.js').read_text()
font = base64.b64encode((root/'public/fonts/hand-latin.woff2').read_bytes()).decode()
css = css.replace('url("/fonts/hand-latin.woff2")', f'url("data:font/woff2;base64,{font}")')
m = re.search(r'@media \(prefers-color-scheme: dark\) \{\n  :root \{(.*?)\n  \}\n\}', css, re.S)
dark = m.group(1)
css = css.replace(m.group(0), '@media (prefers-color-scheme: dark) {\n  :root:not([data-theme="light"]) {' + dark + '\n    color-scheme: dark;\n  }\n}\n:root[data-theme="dark"] {' + dark + '\n  color-scheme: dark;\n}')
css = css.replace('  color-scheme: light dark;\n', '')
(root/'preview/together-preview.html').write_text(f'''<title>Together Family Calendar</title>
<style>
{css}
</style>
<div id="app" aria-live="polite"></div>
<div id="sheet-root"></div>
<div id="toast" role="status"></div>
<script>window.TOGETHER_DEMO = true;</script>
<script>
{js}
</script>
''')
