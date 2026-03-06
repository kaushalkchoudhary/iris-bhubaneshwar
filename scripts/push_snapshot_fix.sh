#!/bin/bash
set -x
FRS="/Users/kaushal/Desktop/iris-bhubaneshwar/inference-backend/frs-analytics"
for IP in 10.10.0.11 10.10.0.13 10.10.0.14 10.10.0.22 10.10.0.150; do
  echo "==============="
  echo "Deploying to $IP"
  echo "==============="
  scp -o StrictHostKeyChecking=no -o ConnectTimeout=10 $FRS/api_reporter.py jetson@${IP}:/opt/iris-edge/inference-backend/frs-analytics/
  if [ $? -eq 0 ]; then
    echo "Files copied successfully to $IP"
    ssh -o StrictHostKeyChecking=no -o ConnectTimeout=10 jetson@${IP} "echo jetson | sudo -S systemctl restart iris-edge && echo 'Service restarted on $IP'"
  else
    echo "FAILED to copy to $IP"
  fi
  echo ""
done
