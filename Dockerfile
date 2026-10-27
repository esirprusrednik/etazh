# Без npm install: у проекта нет зависимостей, только стандартная библиотека Node 22
FROM node:22-alpine
ENV NODE_ENV=production DB_PATH=/data/etazh.sqlite PORT=3000
WORKDIR /app
COPY server ./server
COPY public ./public
COPY scripts ./scripts
COPY package.json ./
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:3000/healthz || exit 1
CMD ["node", "--no-warnings", "server/index.js"]
