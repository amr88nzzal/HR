FROM node:22-alpine

WORKDIR /app

# Copy dependency specifications
COPY package*.json ./

# Install dependencies
RUN npm install --legacy-peer-deps

# Copy application source code
COPY . .

# Build production assets
RUN npm run build

# Expose application port
EXPOSE 3000

ENV NODE_ENV=production
ENV PORT=3000

# Run full-stack server
CMD ["npx", "tsx", "server.ts"]
