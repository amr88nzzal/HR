#!/usr/bin/env sh
# التشغيل على السيرفر (ARM64) أو أي جهاز فيه Docker:  sh run-docker.sh
set -e
cd "$(dirname "$0")"
docker build -t hrms-cert-spike .
mkdir -p out
docker run --rm -v "$PWD/out:/spike/out" hrms-cert-spike
echo "الناتج في: $PWD/out  (certificate.html.pdf / certificate.docx.pdf / *.png)"
uname -m
