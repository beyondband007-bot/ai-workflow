ARG NODE_BASE_IMAGE=docker.m.daocloud.io/library/node:20.20.0-bookworm
ARG NGINX_BASE_IMAGE=docker.m.daocloud.io/library/nginx:1.24.0

FROM ${NODE_BASE_IMAGE} AS auth-build

WORKDIR /build/auth

COPY demo/case-前端页面设计/login-app/package*.json ./
RUN npm install

COPY demo/case-前端页面设计/login-app/ ./
RUN npm run build

FROM ${NGINX_BASE_IMAGE}

COPY deploy/nginx/ai-workflow.docker.conf /etc/nginx/conf.d/default.conf
COPY demo/fristlog.html /srv/landing/fristlog.html
COPY client-portal /srv/portal
COPY --from=auth-build /build/auth/build /srv/auth
