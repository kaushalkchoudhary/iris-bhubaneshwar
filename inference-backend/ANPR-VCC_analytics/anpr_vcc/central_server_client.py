"""
Central Server Client for syncing VCC and ANPR data to dashboard.
"""
import os
import json
import time
import logging
import threading
import requests
import numpy as np
from datetime import datetime
from typing import Optional, Dict, Any

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("central_server")

# Configuration from environment
CENTRAL_SERVER_URL = os.environ.get("CENTRAL_SERVER_URL", "http://localhost:3002").rstrip('/')
CENTRAL_SERVER_ENABLED = os.environ.get("CENTRAL_SERVER_ENABLED", "true").lower() == "true"
WORKER_ID = os.environ.get("WORKER_ID", "worker-1")
AUTH_TOKEN = os.environ.get("AUTH_TOKEN", "")
REQUEST_TIMEOUT = 10


def sanitize_for_json(obj):
    """Convert numpy types to Python native types for JSON serialization."""
    if isinstance(obj, dict):
        return {k: sanitize_for_json(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [sanitize_for_json(item) for item in obj]
    elif isinstance(obj, (np.integer, np.int32, np.int64)):
        return int(obj)
    elif isinstance(obj, (np.floating, np.float32, np.float64)):
        return float(obj)
    elif isinstance(obj, np.ndarray):
        return obj.tolist()
    else:
        return obj


def get_device_id(camera_id, camera_name: Optional[str] = None) -> str:
    """Return device ID for central server (uses the camera_id directly as it is the DB device ID)."""
    return str(camera_id)


def send_vcc_event(
    camera_id: int,
    vehicle_counts: Dict[str, int],
    timestamp: Optional[datetime] = None,
    camera_name: Optional[str] = None,
    metadata: Optional[Dict[str, Any]] = None
) -> bool:
    """Send VCC (Vehicle Classification & Counting) events to central server.
    Sends one event per vehicle type to match the ingest handler format.
    """
    if not CENTRAL_SERVER_ENABLED:
        return False

    url = f"{CENTRAL_SERVER_URL}/api/events/ingest"
    headers = {
        "Content-Type": "application/json",
        "X-Worker-ID": WORKER_ID
    }
    if AUTH_TOKEN:
        headers["X-Auth-Token"] = AUTH_TOKEN

    device_id = get_device_id(camera_id, camera_name)
    event_timestamp = (timestamp or datetime.utcnow()).isoformat()
    success = True

    try:
        for vehicle_type, count in vehicle_counts.items():
            event_data = {
                "id": f"vcc_{device_id}_{vehicle_type}_{int(time.time() * 1000)}",
                "type": "vcc",
                "device_id": device_id,
                "timestamp": event_timestamp,
                "data": {
                    "vehicle_type": vehicle_type,
                    "count": count,
                }
            }
            if metadata:
                event_data["data"].update(metadata)

            response = requests.post(url, json={"event": event_data}, headers=headers, timeout=REQUEST_TIMEOUT)
            if response.status_code in [200, 201]:
                logger.info(f"VCC event sent: {vehicle_type} x{count}")
            else:
                logger.error(f"Failed to send VCC event: {response.status_code}")
                success = False

        return success

    except Exception as e:
        logger.error(f"Error sending VCC event: {e}")
        return False


def send_anpr_detection(
    camera_id: int,
    plate_number: str,
    vehicle_type: str,
    plate_confidence: float,
    plate_image_path: Optional[str] = None,
    vehicle_image_path: Optional[str] = None,
    timestamp: Optional[datetime] = None,
    camera_name: Optional[str] = None,
    metadata: Optional[Dict[str, Any]] = None
) -> bool:
    """Send ANPR (Automatic Number Plate Recognition) detection to central server."""
    if not CENTRAL_SERVER_ENABLED:
        return False

    try:
        device_id = get_device_id(camera_id, camera_name)
        detection_timestamp = (timestamp or datetime.utcnow()).isoformat()

        # Upload images if provided
        image_urls = {}
        if plate_image_path or vehicle_image_path:
            files = {}
            file_handles = []

            try:
                if plate_image_path and os.path.exists(plate_image_path):
                    fh = open(plate_image_path, 'rb')
                    file_handles.append(fh)
                    files['plate.jpg'] = ('plate.jpg', fh, 'image/jpeg')

                if vehicle_image_path and os.path.exists(vehicle_image_path):
                    fh = open(vehicle_image_path, 'rb')
                    file_handles.append(fh)
                    files['vehicle.jpg'] = ('vehicle.jpg', fh, 'image/jpeg')

                if files:
                    event_data = {
                        "id": f"anpr_img_{int(time.time() * 1000)}",
                        "timestamp": detection_timestamp,
                        "worker_id": WORKER_ID,
                        "device_id": device_id,
                        "type": "anpr",
                        "data": {"upload_only": True}
                    }

                    url = f"{CENTRAL_SERVER_URL}/api/events/ingest"
                    data = {"event": json.dumps(event_data)}

                    headers = {"X-Worker-ID": WORKER_ID}
                    if AUTH_TOKEN:
                        headers["X-Auth-Token"] = AUTH_TOKEN

                    response = requests.post(url, data=data, files=files, headers=headers, timeout=REQUEST_TIMEOUT * 3)

                    if response.status_code in [200, 201]:
                        response_data = response.json()
                        uploaded_images = response_data.get('images', {})
                        if 'plate.jpg' in uploaded_images:
                            image_urls['plateImageUrl'] = uploaded_images['plate.jpg']
                        if 'vehicle.jpg' in uploaded_images:
                            image_urls['vehicleImageUrl'] = uploaded_images['vehicle.jpg']

                for fh in file_handles:
                    try:
                        fh.close()
                    except:
                        pass

            except Exception as e:
                logger.error(f"Error uploading ANPR images: {e}")
                for fh in file_handles:
                    try:
                        fh.close()
                    except:
                        pass

        # Build detection payload
        payload = {
            "deviceId": device_id,
            "plateNumber": plate_number,
            "vehicleType": vehicle_type,
            "confidence": float(plate_confidence),
            "timestamp": detection_timestamp,
            "detectionMethod": "AI_VISION"
        }

        if image_urls:
            payload.update(image_urls)

        if metadata:
            payload.update(sanitize_for_json(metadata))

        url = f"{CENTRAL_SERVER_URL}/api/vehicles/detect"
        logger.info(f"Sending ANPR detection: {device_id} - {plate_number} ({vehicle_type})")

        headers = {
            "Content-Type": "application/json",
            "X-Worker-ID": WORKER_ID
        }
        if AUTH_TOKEN:
            headers["X-Auth-Token"] = AUTH_TOKEN

        response = requests.post(url, json=payload, headers=headers, timeout=REQUEST_TIMEOUT)

        if response.status_code in [200, 201]:
            logger.info(f"ANPR detection sent to central server")
            return True
        else:
            logger.error(f"Failed to send ANPR detection: {response.status_code}")
            return False

    except Exception as e:
        logger.error(f"Error sending ANPR detection: {e}")
        return False


def send_vcc_event_async(*args, **kwargs):
    """Send VCC event asynchronously."""
    def _send():
        send_vcc_event(*args, **kwargs)

    thread = threading.Thread(target=_send, daemon=True)
    thread.start()
    return thread


def send_anpr_detection_async(*args, **kwargs):
    """Send ANPR detection asynchronously."""
    def _send():
        send_anpr_detection(*args, **kwargs)

    thread = threading.Thread(target=_send, daemon=True)
    thread.start()
    return thread
