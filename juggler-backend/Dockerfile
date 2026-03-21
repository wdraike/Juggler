FROM node:20-slim

WORKDIR /app

# Copy shared modules
COPY shared/ /shared/
COPY auth-client/ /auth-client/

# Install dependencies
COPY juggler-backend/package.json juggler-backend/package-lock.json* ./
RUN sed -i 's|file:../../auth-service/shared|file:/auth-client|g' package.json && \
    npm install --production --ignore-scripts

# Copy backend source
COPY juggler-backend/ .

ENV PORT=8080
EXPOSE 8080

CMD ["node", "src/server.js"]
