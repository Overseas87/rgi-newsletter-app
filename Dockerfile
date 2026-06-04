FROM node:24-slim

WORKDIR /app

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8080
ENV FIREBASE_PROJECT_ID=rgi-insight-blog-generator
ENV RGI_INLINE_JOBS=true

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig*.json .npmrc ./
COPY artifacts ./artifacts
COPY lib ./lib

RUN pnpm install --frozen-lockfile
RUN pnpm --filter @workspace/api-server run build

EXPOSE 8080

CMD ["pnpm", "--filter", "@workspace/api-server", "run", "start"]
