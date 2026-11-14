from pathlib import Path
from PIL import Image
import re

project=Path(__file__).resolve().parents[1]
resources=project/'android/app/src/main/res'
gradle=project/'android/app/build.gradle'
content=gradle.read_text(encoding='utf-8')
content,ncode=re.subn(r'versionCode\s+1\b','versionCode 110',content,count=1)
content,nname=re.subn(r'versionName\s+"1\.0"', 'versionName "1.1.0"',content,count=1)
if ncode!=1 or nname!=1: raise ValueError('Unexpected native Gradle version settings')
gradle.write_text(content,encoding='utf-8')

source=project/'icon.png'
icon=Image.open(source).convert('RGBA')
for qualifier,size in [('mdpi',48),('hdpi',72),('xhdpi',96),('xxhdpi',144),('xxxhdpi',192)]:
    folder=resources/('mipmap-'+qualifier);folder.mkdir(exist_ok=True,parents=True)
    fgsize=int(round(size*2.25))
    fg=Image.new('RGBA',(fgsize,fgsize),(0,0,0,0))
    # Adaptive icon safe zone: 66% center so Android's circular crop does not cut the logo.
    logo=icon.resize((int(fgsize*.65),int(fgsize*.65)),Image.Resampling.LANCZOS)
    fg.alpha_composite(logo,((fgsize-logo.width)//2,(fgsize-logo.height)//2))
    fg.save(folder/'ic_launcher_foreground.png')
    square=Image.new('RGBA',(size,size),'#181b24')
    logo=icon.resize((int(size*.88),int(size*.88)),Image.Resampling.LANCZOS)
    square.alpha_composite(logo,((size-logo.width)//2,(size-logo.height)//2))
    square.convert('RGB').save(folder/'ic_launcher.png')
    square.convert('RGB').save(folder/'ic_launcher_round.png')
print('Android native version 1.1.0 / code 110 + official Silent Garden launcher icon')
