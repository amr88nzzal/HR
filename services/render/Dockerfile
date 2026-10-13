# حاوية التحويل إلى PDF: Chromium + الخطوط العربية المضمّنة. تعمل على ARM64 وAMD64.
FROM node:22-bookworm-slim
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends chromium fontconfig ca-certificates \
    && rm -rf /var/lib/apt/lists/*
# الخطوط (OFL) تُسجَّل في النظام فيجدها Chromium بالاسم (Amiri / Noto Naskh Arabic)
COPY spikes/arabic-certificate/fonts/ /usr/local/share/fonts/hrms/
RUN fc-cache -f
WORKDIR /app
COPY services/render/package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY services/render/server.mjs ./
ENV CHROMIUM_PATH=/usr/bin/chromium PORT=3100
USER node
EXPOSE 3100
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://localhost:3100/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.mjs"]
