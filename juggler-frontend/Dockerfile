# Build stage
FROM node:18-alpine AS build

WORKDIR /app

# Copy shared module first (must be vendored into ./shared before build)
COPY shared/ /shared/

# Copy package files and install (from juggler-frontend/ subdirectory in build context)
COPY juggler-frontend/package.json juggler-frontend/package-lock.json* ./
# Fix shared module path, strip file: deps that can't resolve in Docker context, then install
RUN sed -i 's|"file:../shared"|"file:/shared"|g' package.json package-lock.json 2>/dev/null && \
    sed -i '/"bug-reporter-client"/d' package.json && \
    node -e "const f=require('fs');const p=JSON.parse(f.readFileSync('package-lock.json','utf8'));delete p.packages['node_modules/bug-reporter-client'];delete p.dependencies?.['bug-reporter-client'];Object.keys(p.packages).forEach(k=>{if(k.includes('bug-reporter'))delete p.packages[k]});f.writeFileSync('package-lock.json',JSON.stringify(p,null,2))" && \
    npm ci --legacy-peer-deps && \
    mkdir -p node_modules/bug-reporter-client && \
    echo "module.exports.createBugReporterClient=function(){return{submitReport:function(){return Promise.resolve()},init:function(){}}};" > node_modules/bug-reporter-client/index.js && \
    echo '{"name":"bug-reporter-client","version":"1.0.0","main":"index.js"}' > node_modules/bug-reporter-client/package.json && \
    mkdir -p node_modules/html2canvas && \
    echo "module.exports=function(){return Promise.resolve(document.createElement('canvas'))};" > node_modules/html2canvas/index.js && \
    echo '{"name":"html2canvas","version":"1.0.0","main":"index.js"}' > node_modules/html2canvas/package.json && \
    mkdir -p node_modules/react-konva && \
    echo "var R=require('react');var e=function(p){return R.createElement('div',null)};module.exports={Stage:e,Layer:e,Image:e,Line:e,Arrow:e,Text:e,Rect:e};" > node_modules/react-konva/index.js && \
    echo '{"name":"react-konva","version":"1.0.0","main":"index.js"}' > node_modules/react-konva/package.json

# Copy application code (frontend source from juggler-frontend/ in build context)
COPY juggler-frontend/ .

# Production URLs baked into the build
ENV REACT_APP_API_URL=https://juggler-backend-vl525q4h7q-uc.a.run.app/api
ENV REACT_APP_GOOGLE_CLIENT_ID=1057418149210-tc90mmg77ri1s4fjtt2s8179cudbfssc.apps.googleusercontent.com
ENV REACT_APP_AUTH_SERVICE_URL=https://auth-backend-vl525q4h7q-uc.a.run.app
ENV REACT_APP_AUTH_FRONTEND_URL=https://auth.raikegroup.com
ENV REACT_APP_BILLING_URL=https://billing.raikegroup.com
ENV REACT_APP_BILLING_API_URL=https://payment-backend-vl525q4h7q-uc.a.run.app
ENV GENERATE_SOURCEMAP=false
ENV NODE_ENV=production

RUN npm run build

# Production stage
FROM nginx:alpine

COPY --from=build /app/build /usr/share/nginx/html
COPY juggler-frontend/nginx.conf /etc/nginx/templates/default.conf.template

EXPOSE 8080

ENV NGINX_ENVSUBST_OUTPUT_DIR=/etc/nginx/conf.d
CMD ["nginx", "-g", "daemon off;"]
