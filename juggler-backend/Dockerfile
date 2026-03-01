FROM node:20-slim

WORKDIR /app

# Install dependencies
COPY package.json package-lock.json* ./
RUN npm ci --production

# Copy source
COPY . .

# Cloud Run uses port 8080
ENV PORT=8080
EXPOSE 8080

CMD ["node", "src/server.js"]
