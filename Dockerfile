FROM node:24-alpine
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --prod --frozen-lockfile
COPY src/server ./src/server
COPY src/shared ./src/shared
COPY db/migrations ./db/migrations
COPY scripts/import-products.mjs ./scripts/import-products.mjs
USER node
ENV NODE_ENV=production PORT=8787
EXPOSE 8787
CMD ["node", "src/server/index.js"]
