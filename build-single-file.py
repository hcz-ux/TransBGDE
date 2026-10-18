"""Erzeugt uebersetzer.html: die komplette App in einer einzigen Datei (zum Weitergeben/Öffnen ohne Server)."""
import base64
import pathlib

root = pathlib.Path(__file__).parent
read = lambda name: (root / name).read_text(encoding='utf-8')
inline_js = lambda name: '<script>\n' + read(name).replace('</script>', '<\\/script>') + '</script>'

html = read('index.html')
svg = base64.b64encode((root / 'icons/icon.svg').read_bytes()).decode()
html = html.replace('  <link rel="manifest" href="manifest.webmanifest">\n', '')
html = html.replace('  <link rel="apple-touch-icon" href="icons/icon-192.png">\n', '')
html = html.replace('href="icons/icon.svg"', f'href="data:image/svg+xml;base64,{svg}"')
html = html.replace('<link rel="stylesheet" href="style.css">', '<style>\n' + read('style.css') + '</style>')
html = html.replace('<script src="translator.js"></script>', inline_js('translator.js'))
html = html.replace('<script src="app.js"></script>', inline_js('app.js'))
(root / 'uebersetzer.html').write_text(html, encoding='utf-8')
print('uebersetzer.html erstellt')
