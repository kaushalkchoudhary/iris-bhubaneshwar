#!/bin/bash
curl -s "http://localhost:3002/api/devices?type=CAMERA" | jq '.[0]'
