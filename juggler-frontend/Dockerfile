# Build stage
FROM node:18-alpine AS build

WORKDIR /app

# Copy shared module first (referenced as file:../shared in package.json)
COPY shared /shared

COPY juggler-frontend/package.json juggler-frontend/package-lock.json* ./
RUN npm ci

COPY juggler-frontend/. .

ARG REACT_APP_API_URL
ARG REACT_APP_GOOGLE_CLIENT_ID
ARG REACT_APP_AUTH_SERVICE_URL=https://auth-backend-1057418149210.us-central1.run.app
ARG REACT_APP_AUTH_FRONTEND_URL=https://auth-frontend-1057418149210.us-central1.run.app
ENV REACT_APP_API_URL=${REACT_APP_API_URL}
ENV REACT_APP_GOOGLE_CLIENT_ID=${REACT_APP_GOOGLE_CLIENT_ID}
ENV REACT_APP_AUTH_SERVICE_URL=${REACT_APP_AUTH_SERVICE_URL}
ENV REACT_APP_AUTH_FRONTEND_URL=${REACT_APP_AUTH_FRONTEND_URL}
ENV GENERATE_SOURCEMAP=false
ENV NODE_ENV=production

RUN npm run build

# Production stage
FROM nginx:alpine

COPY --from=build /app/build /usr/share/nginx/html
COPY juggler-frontend/nginx.conf /etc/nginx/templates/default.conf.template

EXPOSE 8080

# nginx:alpine supports envsubst via /etc/nginx/templates/*.template
ENV NGINX_ENVSUBST_OUTPUT_DIR=/etc/nginx/conf.d
CMD ["nginx", "-g", "daemon off;"]
