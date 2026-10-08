FROM python:3.12-slim
WORKDIR /app
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
COPY backend/requirements.txt backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt
COPY backend/app backend/app
COPY mcp-server mcp-server
RUN useradd --create-home chef && chown -R chef:chef /app
USER chef
EXPOSE 8000
CMD ["sh", "-c", "exec uvicorn backend.app.main:app --host 0.0.0.0 --port \"${PORT:-8000}\""]
