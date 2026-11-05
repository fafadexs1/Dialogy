FROM mcr.microsoft.com/playwright:v1.62.1-noble
WORKDIR /opt/dialogy-browser
RUN npm install --omit=dev --no-audit --no-fund playwright@1.62.1
COPY agent-browser-runner.cjs ./runner.cjs
USER pwuser
ENTRYPOINT ["node", "/opt/dialogy-browser/runner.cjs"]
