FROM node:20-slim AS builder
WORKDIR /app
COPY package*.json tsconfig.json ./
RUN npm ci
COPY src ./src
RUN npm run build

FROM node:20-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
EXPOSE 8080
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 appuser --ingroup nodejs
USER appuser
CMD ["node", "dist/http.js"]
