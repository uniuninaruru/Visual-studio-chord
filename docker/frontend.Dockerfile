FROM node:24-slim AS build

WORKDIR /app

RUN npm install --global pnpm@11.9.0

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY frontend/package.json frontend/package.json
RUN pnpm install --frozen-lockfile

COPY frontend frontend
RUN pnpm --dir frontend build

FROM nginx:alpine

COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/frontend/dist /usr/share/nginx/html

EXPOSE 80
