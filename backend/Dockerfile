FROM debian:trixie-slim AS hwp-cli
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl && rm -rf /var/lib/apt/lists/*
RUN set -eu; \
    case "$(dpkg --print-architecture)" in \
      amd64) target=x86_64-unknown-linux-gnu; checksum=21bd8ab3b6834c48fcebca390e3d3f79dcedd6a4388e4eeaf802501f84fcf433 ;; \
      arm64) target=aarch64-unknown-linux-gnu; checksum=3c721f2548c4c74aba2ffb38fa09888d15610edaecc9fe33f81b1d7c42d222e4 ;; \
      *) exit 1 ;; \
    esac; \
    curl -fL --retry 3 -o /tmp/hwp.tar.gz "https://github.com/STAIxBWLB/hwp-cli/releases/download/v1.3.1/hwp-v1.3.1-${target}.tar.gz"; \
    echo "$checksum  /tmp/hwp.tar.gz" | sha256sum -c -; \
    mkdir /hwp; tar -xzf /tmp/hwp.tar.gz -C /hwp; /hwp/hwp --version

FROM python:3.12-slim
COPY --from=hwp-cli /hwp/hwp /usr/local/bin/hwp
COPY --from=hwp-cli /hwp/LICENSE-MIT /hwp/LICENSE-APACHE /hwp/NOTICE /usr/local/share/doc/hwp-cli/
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends fonts-noto-cjk ffmpeg && rm -rf /var/lib/apt/lists/*
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app ./app
COPY scripts ./scripts
ENV ENV=production AUTH_MODE=firebase STORAGE_BACKEND=firestore PORT=8080 PDF_FONT_PATH=/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc
# OPENAI_API_KEY via Secret Manager (--set-secrets); OPENAI_MODEL via --set-env-vars
# Production uses GCS signed URLs; ignore caller-controlled X-Forwarded-* headers.
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT} --no-proxy-headers"]
