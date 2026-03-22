# Build stage
FROM node:18-alpine AS build

WORKDIR /app

# Copy shared module first (must be vendored into ./shared before build)
COPY shared/ /shared/

# Copy package files and install
COPY package.json package-lock.json* ./
RUN npm ci

# Copy application code
COPY . .

# Production URLs baked into the build
ENV REACT_APP_API_URL=https://juggler-backend-vl525q4h7q-uc.a.run.app/api
ENV REACT_APP_GOOGLE_CLIENT_ID=1057418149210-smec08mm420k77co525bf27q48k7nc64.apps.googleusercontent.com
ENV REACT_APP_AUTH_SERVICE_URL=https://auth-backend-vl525q4h7q-uc.a.run.app
ENV REACT_APP_AUTH_FRONTEND_URL=https://auth-frontend-vl525q4h7q-uc.a.run.app
ENV REACT_APP_BILLING_URL=https://payment-frontend-vl525q4h7q-uc.a.run.app
ENV REACT_APP_BILLING_API_URL=https://payment-backend-vl525q4h7q-uc.a.run.app
ENV GENERATE_SOURCEMAP=false
ENV NODE_ENV=production

RUN npm run build

# Production stage
FROM nginx:alpine

COPY --from=build /app/build /usr/share/nginx/html
COPY nginx.conf /etc/nginx/templates/default.conf.template

EXPOSE 8080

ENV NGINX_ENVSUBST_OUTPUT_DIR=/etc/nginx/conf.d
CMD ["nginx", "-g", "daemon off;"]
