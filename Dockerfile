FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev
COPY api/ api/
EXPOSE 3000
CMD ["node", "api/server.js"]
