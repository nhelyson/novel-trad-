
import re

with open('C:/Users/japhet/Downloads/novel_trad/server.js', 'r', encoding='utf-8') as f:
    content = f.read()

content = content.replace('console.log([EPUB Progress] % - );', 'console.log(\[EPUB Progress] % - \);')
content = content.replace('console.log([PDF Progress] % - );', 'console.log(\[PDF Progress] % - \);')
content = content.replace('console.log([Text Progress] % - );', 'console.log(\[Text Progress] % - \);')

with open('C:/Users/japhet/Downloads/novel_trad/server.js', 'w', encoding='utf-8') as f:
    f.write(content)

