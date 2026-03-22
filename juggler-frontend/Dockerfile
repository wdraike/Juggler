# Build stage
FROM node:18-alpine AS build

WORKDIR /app

# Copy shared module first (must be vendored into ./shared before build)
COPY shared/ /shared/

# Copy package files and install
COPY package.json package-lock.json* ./
# Remove file: deps, fix shared path, clean lock file, install, stub missing modules
RUN sed -i '/"bug-reporter-client"/d' package.json && \
    sed -i 's|"juggler-shared": "file:../shared"|"juggler-shared": "file:/shared"|' package.json && \
    node -e "const f=require('fs');const p=JSON.parse(f.readFileSync('package-lock.json','utf8'));delete p.packages?.['node_modules/bug-reporter-client'];delete p.dependencies?.['bug-reporter-client'];Object.keys(p.packages||{}).forEach(k=>{if(k.includes('bug-reporter'))delete p.packages[k]});if(p.packages?.['node_modules/juggler-shared'])p.packages['node_modules/juggler-shared'].resolved='file:///shared';f.writeFileSync('package-lock.json',JSON.stringify(p,null,2))" && \
    npm ci --legacy-peer-deps && \
    mkdir -p node_modules/bug-reporter-client && \
    echo "module.exports={BugReporterClient:function(){return{submitReport:function(){return Promise.resolve()}}}};" > node_modules/bug-reporter-client/index.js && \
    echo '{"name":"bug-reporter-client","version":"1.0.0","main":"index.js"}' > node_modules/bug-reporter-client/package.json

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
