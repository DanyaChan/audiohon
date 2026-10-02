#!/bin/sh
# Regenerates the tiny audio files used by the metadata tests (needs ffmpeg).
set -e
cd "$(dirname "$0")/../src/lib/metadata/__fixtures__"

cat > chapters.ffmeta <<'EOF'
;FFMETADATA1
title=Тестовая книга
artist=Автор Тестов
album=Тестовая книга
[CHAPTER]
TIMEBASE=1/1000
START=0
END=1500
title=Глава первая
[CHAPTER]
TIMEBASE=1/1000
START=1500
END=3000
title=Глава вторая
[CHAPTER]
TIMEBASE=1/1000
START=3000
END=4000
title=Эпилог
EOF

silence="-f lavfi -t 4 -i anullsrc=r=8000:cl=mono"
common="-map_metadata 1 -map_chapters 1 -loglevel error -y"

# M4B with both a QuickTime chapter track and a Nero `chpl` box, plus cover art.
ffmpeg -f lavfi -i color=c=orange:s=32x32 -frames:v 1 -loglevel error -y cover.jpg
ffmpeg $silence -i chapters.ffmeta -i cover.jpg $common -map 0:a -map 2:v \
  -c:a aac -b:a 16k -c:v copy -disposition:v attached_pic book.m4b
# MP4 with only the QuickTime chapter track.
ffmpeg $silence -i chapters.ffmeta $common -c:a aac -b:a 16k -f ipod -movflags disable_chpl qt-only.m4b
# MP3 with ID3v2.3 CHAP/CTOC frames.
ffmpeg $silence -i chapters.ffmeta $common -c:a libmp3lame -b:a 8k -id3v2_version 3 book.mp3
# MP3 with ID3v2.4 tags.
ffmpeg $silence -i chapters.ffmeta $common -c:a libmp3lame -b:a 8k -id3v2_version 4 book-v24.mp3

rm chapters.ffmeta cover.jpg
