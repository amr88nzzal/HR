# نموذج أولي: توليد شهادة عربية HTML->PDF و DOCX->PDF، ويعمل على ARM64 و AMD64.
FROM node:22-bookworm-slim
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium libreoffice-writer libreoffice-core poppler-utils python3 python3-docx \
      fontconfig ca-certificates \
    && rm -rf /var/lib/apt/lists/*
# الخطوط تُضمَّن مع المشروع (OFL) وتُسجَّل في النظام لـ LibreOffice؛ والـ HTML يحمّلها مباشرة عبر @font-face
COPY fonts/ /usr/local/share/fonts/hrms/
RUN fc-cache -f
WORKDIR /spike
COPY package.json ./
RUN npm install --no-audit --no-fund
COPY . .
ENV CHROMIUM_PATH=/usr/bin/chromium
CMD ["sh", "-c", "python3 scripts/make_docx_template.py && node scripts/render.mjs"]
