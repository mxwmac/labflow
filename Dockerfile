# LabFlow — Cloud Run 用コンテナ
FROM node:22-slim

ENV NODE_ENV=production \
    TZ=Asia/Tokyo \
    PORT=8080
WORKDIR /app

# 依存関係だけ先に入れてレイヤーキャッシュを効かせる
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY server.js ./
COPY src ./src
COPY public ./public

# root で動かさない
USER node
EXPOSE 8080
CMD ["node", "server.js"]
