FROM node:18

WORKDIR /app

COPY package*.json ./
RUN npm install && useradd -m appuser && chown -R appuser:appuser /app

COPY . .

USER node

CMD ["node", "server.js"]
