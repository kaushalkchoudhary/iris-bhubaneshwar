#!/usr/bin/env python3
"""
IRIS Environment Variable Manager
Automatically loads and sets IRIS environment variables from ~/.iris/config.json
"""

import os
import json
import logging
from pathlib import Path

logger = logging.getLogger('iris_env')

def is_docker() -> bool:
    """
    Determine if the script is running inside a Docker container.
    """
    try:
        return os.path.exists("/.dockerenv")
    except Exception:
        return False

def load_iris_environment():
    """
    Load IRIS environment variables from ~/.iris/config.json (host) or /secrets/config.json (docker)
    Returns True if successful, False otherwise
    """
    try:
        config_path = None
        # Prefer secrets path when running in Docker
        if is_docker():
            docker_api_config = Path('/secrets') / 'config.json'
            if docker_api_config.exists():
                config_path = docker_api_config
        else:
            config_path = Path.home() / '.iris' / 'config.json'

        if not config_path.exists():
            logger.error(f"❌ IRIS config file not found: {config_path}")
            return False

        with open(config_path, 'r') as f:
            config = json.load(f)

        # Set server token
        if 'serverToken' in config:
            os.environ['IRIS_SERVER_TOKEN'] = config['serverToken']
            logger.debug("✅ IRIS_SERVER_TOKEN set from config file")
        else:
            logger.error("❌ serverToken not found in config file")
            return False

        # Set worker identity (used by edge Jetsons to fetch their own camera config)
        # These map to the WORKER_ID / AUTH_TOKEN expected by config_manager.
        if 'workerId' in config and 'WORKER_ID' not in os.environ:
            os.environ['WORKER_ID'] = config['workerId']
            logger.debug("✅ WORKER_ID set from config file")
        if 'authToken' in config and 'AUTH_TOKEN' not in os.environ:
            os.environ['AUTH_TOKEN'] = config['authToken']
            logger.debug("✅ AUTH_TOKEN set from config file")

        # Set config path
        os.environ['IRIS_CONFIG_PATH'] = str(config_path)
        os.environ['IRIS_HOME'] = str(config_path.parent)

        # Set default API base URL if not already set
        if 'IRIS_API_BASE_URL' not in os.environ:
            default_api_url = "http://localhost:3001/api"
            os.environ['IRIS_API_BASE_URL'] = default_api_url
            logger.debug(f"🌐 IRIS_API_BASE_URL set to default: {default_api_url}")
        else:
            logger.debug(f"🌐 Using existing IRIS_API_BASE_URL: {os.environ['IRIS_API_BASE_URL']}")

        logger.debug("🚀 IRIS environment variables loaded successfully")
        return True
    
    except Exception as e:
        logger.error(f"❌ Failed to load IRIS environment: {e}")
        return False

def get_iris_token() -> str:
    """
    Get IRIS server token from environment or config file.
    
    Returns:
        str: IRIS server token
        
    Raises:
        RuntimeError: If token cannot be found
    """
    # Try environment variable first
    token = os.environ.get('IRIS_SERVER_TOKEN')
    if token:
        return token
    
    # Load from config file
    if load_iris_environment():
        token = os.environ.get('IRIS_SERVER_TOKEN')
        if token:
            return token
    
    raise RuntimeError("IRIS server token not found. Please ensure IRIS server has been started.")

def get_iris_api_url() -> str:
    """
    Get IRIS API base URL from environment.
    
    Returns:
        str: IRIS API base URL
    """
    return os.environ.get('IRIS_API_BASE_URL', 'http://localhost:3001/api')

def print_iris_env():
    """Print current IRIS environment variables for debugging"""
    print("\n=== IRIS Environment Variables ===")
    iris_vars = {k: v for k, v in os.environ.items() if k.startswith('IRIS_')}
    
    if iris_vars:
        for key, value in iris_vars.items():
            if 'TOKEN' in key:
                # Mask token for security
                masked_value = value[:10] + "..." + value[-10:] if len(value) > 20 else "***masked***"
                print(f"{key}: {masked_value}")
            else:
                print(f"{key}: {value}")
    else:
        print("No IRIS environment variables found")
    print("=" * 35)

if __name__ == '__main__':
    # Test the environment loading
    load_iris_environment()
    print_iris_env() 