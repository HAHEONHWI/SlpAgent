FROM python:3.12-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends fonts-noto-cjk && rm -rf /var/lib/apt/lists/*
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app ./app
COPY scripts ./scripts
ENV ENV=production AUTH_MODE=firebase STORAGE_BACKEND=firestore PORT=8080 PDF_FONT_PATH=/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc
# OPENAI_API_KEY via Secret Manager (--set-secrets); OPENAI_MODEL via --set-env-vars
# Behind Firebase Hosting / Cloud Run proxies: trust X-Forwarded-* so generated URLs use https.
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT} --proxy-headers --forwarded-allow-ips=*"]
