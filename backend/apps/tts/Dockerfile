FROM python:3.11-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \
    ffmpeg \
    tini \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

ENV PYTHONPATH=/app

# Copy requirements and install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY tts_service.py .

# Create models directory
RUN mkdir -p /app/models

# Expose port
EXPOSE 9002

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["python", "tts_service.py"]
