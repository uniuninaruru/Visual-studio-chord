FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

COPY backend /app/backend

RUN python -m pip install --no-cache-dir /app/backend \
    && useradd --create-home --uid 10001 harmony

USER harmony

EXPOSE 8765

CMD ["python", "-m", "uvicorn", "app.main:app", "--app-dir", "/app/backend", "--host", "0.0.0.0", "--port", "8765"]
