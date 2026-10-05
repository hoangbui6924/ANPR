# ANPR API (docs ch. 12). node:22-slim, not Alpine: onnxruntime-node and sharp need glibc.
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
# prisma generate (postinstall) only needs a syntactically valid URL at build time
RUN DATABASE_URL=postgresql://build:build@localhost:5432/build npm ci --no-audit --no-fund

COPY src ./src
# trained / downloaded models (not in git): plate.onnx, plate_ocr_v2.{onnx,json}, rec_ch_v4_server.onnx, ppocr_keys_v1.txt
COPY models ./models

EXPOSE 3001
# create/upgrade tables, create the first admin if missing, then serve
CMD ["sh", "-c", "npx --no-install prisma migrate deploy && npx --no-install tsx prisma/seed.ts && exec npx --no-install tsx src/index.ts"]
