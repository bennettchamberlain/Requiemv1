#!/bin/sh

# Wait for MinIO to be ready
until mc alias set minio http://minio:9000 $MINIO_ROOT_USER $MINIO_ROOT_PASSWORD; do
  echo "Waiting for MinIO to be ready..."
  sleep 2
done

echo "MinIO is ready. Setting bucket policies..."

# Set the companion bucket to allow public downloads
mc anonymous set download minio/companion

echo "MinIO bucket policies configured successfully!"
