# Use a slim Python 3.12 image
FROM python:3.12-slim

# Set working directory
WORKDIR /app

# Prevent Python from writing pyc files and buffering stdout
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

# Install system dependencies (none are strictly needed for now, but good to have)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Copy and install Python requirements
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend, frontend, configuration, and sample files
COPY backend/ ./backend/
COPY frontend/ ./frontend/
COPY .env .
COPY contacts_sample.xlsx .
COPY dummy_resume.pdf .

# Create persistent storage directories (for oauth tokens and uploads)
RUN mkdir -p tokens uploads

# Expose FastAPI server port
EXPOSE 8000

# Start uvicorn server pointing to the backend module
CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]
