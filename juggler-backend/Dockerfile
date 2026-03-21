FROM node:20-slim

WORKDIR /app

# Copy shared modules
COPY shared/ /shared/

# Copy package.json only (no lock file — auth-client path gets rewritten)
COPY juggler-backend/package.json ./

# Rewrite auth-client to point to a local copy, then install
RUN sed -i '/"auth-client"/d' package.json && \
    npm install --omit=dev --ignore-scripts

# Copy the auth-client module directly into node_modules
# (it only depends on jose, which is already installed above)
COPY auth-client/auth-client.js ./node_modules/auth-client/auth-client.js
COPY auth-client/package.json ./node_modules/auth-client/package.json

# Copy backend source
COPY juggler-backend/ .

ENV PORT=8080
EXPOSE 8080

CMD ["node", "src/server.js"]
