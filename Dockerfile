FROM node:24-alpine
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --prod --frozen-lockfile
COPY server ./server
COPY backup-data.js ./backup-data.js
COPY migrations ./migrations
COPY scripts/import-products.mjs ./scripts/import-products.mjs
USER node
ENV NODE_ENV=production PORT=8787
EXPOSE 8787
CMD ["node", "server/index.js"]
