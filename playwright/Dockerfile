FROM mcr.microsoft.com/playwright:v1.55.0-jammy

WORKDIR /app

COPY package.json ./

RUN npm install

COPY server.js ./

EXPOSE 3000

RUN npm install sharp
RUN npm install tesseract.js



CMD ["node", "server.js"]