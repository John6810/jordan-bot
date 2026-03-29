FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --only=production

COPY src/ ./src/

USER node

CMD ["node", "src/bot.js"]
