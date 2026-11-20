FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
WORKDIR /app

COPY requirements.txt .
RUN pip install -r requirements.txt

COPY ticketsecure ./ticketsecure
COPY migrations ./migrations
COPY wsgi.py ./

# L'application ne tourne jamais en root. Les affiches sont stockées dans /app/media (volume).
RUN useradd --create-home --uid 10001 app && mkdir -p /app/media/affiches && chown -R app /app
USER app

ENV FLASK_APP=wsgi.py PORT=5000 MEDIA_FOLDER=/app/media
EXPOSE 5000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:5000/health', timeout=4).status == 200 else 1)"
CMD ["sh", "-c", "flask bootstrap && exec gunicorn --workers ${WEB_WORKERS:-3} --timeout 60 --bind 0.0.0.0:${PORT} --access-logfile - wsgi:app"]
