FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
WORKDIR /opt/dialogy-video
COPY agent-video-runner.cjs ./runner.cjs
USER node
ENTRYPOINT ["node", "/opt/dialogy-video/runner.cjs"]
