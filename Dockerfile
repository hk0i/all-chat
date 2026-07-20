# Build stage — needs the whole workspace (shared/ + web/)
FROM node:22-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY shared/contract/package.json shared/contract/
COPY web/package.json web/
RUN npm ci
COPY shared shared
COPY web web
RUN npm run build -w web

# Runtime stage — adapter-node output only
FROM node:22-alpine
ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/data
WORKDIR /app
COPY --from=build /repo/web/build ./
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 3000
CMD ["node", "index.js"]
