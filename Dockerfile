FROM node:20-alpine
WORKDIR /app
COPY server.js index.html ./
ENV PORT=8899 DATA_DIR=/data NODE_ENV=production
EXPOSE 8899
VOLUME ["/data"]
CMD ["node", "server.js"]
