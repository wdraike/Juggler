FROM node:20-slim

WORKDIR /app

# Install dependencies
COPY juggler-backend/package.json juggler-backend/package-lock.json* ./
RUN npm ci --production

# Copy shared module (referenced via ../../../shared from src/scheduler/)
COPY shared/ /shared/

# Copy backend source
COPY juggler-backend/ .

# Cloud Run uses port 8080
ENV PORT=8080
EXPOSE 8080

CMD ["node", "src/server.js"]
