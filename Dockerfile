FROM oven/bun:1.3.14-alpine

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .
RUN bun run build

EXPOSE 1420
CMD ["bun", "run", "preview", "--", "--host", "0.0.0.0", "--port", "1420"]
