FROM python:3.11-slim

# Install Nginx
RUN apt-get update && apt-get install -y nginx && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy requirements and install
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy the app and Nginx config
COPY app.py .
COPY nginx.conf /etc/nginx/sites-available/default

# Expose port 80 (Nginx)
EXPOSE 80

# Start Nginx and Gunicorn
# (Using a simple shell script to start both)
CMD service nginx start && gunicorn --bind 0.0.0.0:5000 --workers 3 app:app
