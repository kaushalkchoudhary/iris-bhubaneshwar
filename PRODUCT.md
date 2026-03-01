# IRIS - Smart City Video Analytics Platform

## Overview

IRIS is a comprehensive **Smart City Command Center** platform that integrates computer vision AI, distributed edge computing, and real-time analytics to provide intelligent surveillance and monitoring across urban environments. The system processes video streams from thousands of distributed cameras and edge devices to deliver actionable intelligence to city administrators, traffic authorities, and security teams.

The platform is designed around a hub-and-spoke architecture: a central command server orchestrates distributed **MagicBox** edge workers (running on NVIDIA Jetson devices) that perform local AI inference on camera feeds, sending events and analytics upstream in real-time.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | React 19, TypeScript 5.9, Vite 7, Tailwind CSS 4, Radix UI / shadcn |
| **Backend** | Go 1.21, Gin framework, GORM ORM |
| **Database** | PostgreSQL with JSONB metadata fields |
| **Messaging** | Embedded NATS server (port 4233) |
| **Real-time** | WebSocket (Gorilla), HLS.js |
| **3D/Viz** | Three.js, React Three Fiber, Recharts, Google Maps |
| **Edge Devices** | Go-based MagicBox Node on Jetson (ARM64) |
| **Networking** | WireGuard VPN for secure edge-to-cloud tunnels |
| **AI/ML** | YOLO (object detection), ANPR, VCC, thermal/spectral models |
| **Deployment** | Docker, Systemd, Vercel, PM2 |

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                  IRIS Command Center                │
│  ┌──────────┐  ┌──────────┐  ┌───────────────────┐ │
│  │ React UI │◄─│  Go API  │◄─│   PostgreSQL DB   │ │
│  │ (Vite)   │  │  (Gin)   │  │  (GORM + JSONB)   │ │
│  └────┬─────┘  └────┬─────┘  └───────────────────┘ │
│       │ WebSocket    │ NATS                          │
│       └──────┬───────┘                               │
│              │                                       │
│       ┌──────┴──────┐                                │
│       │  Feed Hub   │  (real-time video relay)       │
│       └──────┬──────┘                                │
└──────────────┼──────────────────────────────────────┘
               │ WireGuard VPN
    ┌──────────┼──────────┐
    │          │          │
┌───┴───┐ ┌───┴───┐ ┌───┴───┐
│MagicBox│ │MagicBox│ │MagicBox│  (Jetson edge workers)
│ Node 1 │ │ Node 2 │ │ Node N │
└───┬────┘ └───┬────┘ └───┬────┘
    │          │          │
  Cameras   Cameras    Cameras
```

### Key Architectural Patterns

- **Distributed Edge Computing** - Workers process video locally on Jetson GPUs, send only events/analytics upstream
- **File-Based Event Queue** - Reliable event delivery with retry logic, survives network outages
- **WebSocket Feed Hub** - Real-time video streaming backed by NATS pub/sub
- **JSONB Metadata** - Flexible schema extension without migrations
- **WireGuard VPN** - Encrypted tunnels between edge workers and central server
- **Approval Workflow** - Token-based + manual approval for worker registration
- **Multi-View Analytics** - Same data rendered as maps, grids, heatmaps, video walls

---

## Analytics Modules

### 1. Crowd Management

Real-time crowd analytics for public spaces, festivals, transit hubs, and high-footfall zones.

| Capability | Description |
|-----------|-------------|
| **People Counting** | YOLO-based real-time headcount per camera/zone |
| **Density Analysis** | LOW / MEDIUM / HIGH / CRITICAL classification |
| **Flow Tracking** | Movement velocity, flow rate, direction vectors |
| **Surge Detection** | Sudden crowd buildup alerts with pressure indexing |
| **Heatmaps** | Spatial density visualization over time |
| **Hotspot Detection** | Automated identification of high-risk zones |
| **Chokepoint Analysis** | Bottleneck identification in pedestrian flow |
| **Stop Wave Detection** | Cascade slowdown pattern recognition |
| **Queue Analytics** | Wait time estimation and queue length monitoring |
| **Re-Identification** | Cross-camera person tracking |
| **Aggression Detection** | Behavioral anomaly flagging |
| **Demographics** | Age group and gender distribution estimation |

**Alert Severity Levels:** GREEN, YELLOW, ORANGE, RED with resolution tracking and audit trail.

---

### 2. Traffic Enforcement (ITMS)

Intelligent Traffic Management System with automated violation detection and e-challan issuance.

| Capability | Description |
|-----------|-------------|
| **ANPR** | Automatic Number Plate Recognition with confidence scoring |
| **Vehicle Classification (VCC)** | 2-Wheeler, 4-Wheeler, Auto, Truck, Bus categorization |
| **Speed Detection** | Radar and camera-based speed enforcement |
| **Violation Detection** | Speed, red light, wrong way, helmet-less, no seatbelt, triple riding, overloading, illegal parking |
| **e-Challan** | Automated fine generation with evidence images |
| **WIM** | Weigh-in-Motion for overloaded vehicles |
| **Watchlist** | Vehicle watchlist with real-time alerts on detection |
| **Parking Analytics** | Occupancy monitoring and violation flagging |

**Violation Workflow:** PENDING → APPROVED / REJECTED → FINED, with plate correction and manual review capabilities.

---

### 3. Security & Surveillance

Perimeter and facility security monitoring with AI-driven threat detection.

| Capability | Description |
|-----------|-------------|
| **Perimeter Intrusion** | Virtual fence crossing detection |
| **Loitering Detection** | Time-in-zone threshold alerts |
| **Abandoned Object** | Unattended bag/object flagging |
| **Weapon Detection** | Knife, gun, and weapon recognition |
| **Face Watchlist** | Real-time face matching against watchlists |
| **Camera Tampering** | Defocus, obstruction, and angle change detection |
| **Access Control** | Entry/exit monitoring and unauthorized access alerts |

---

### 4. Emergency Response

Public safety monitoring for natural and man-made emergencies.

| Capability | Description |
|-----------|-------------|
| **Fire & Smoke** | Thermal spectral model for early fire detection |
| **Flood Monitoring** | Depth estimation for waterlogging events |
| **Coastal Surge** | Wave and tide anomaly detection |
| **Accident Detection** | Rollover, impact severity classification |
| **Weather Integration** | Environmental condition monitoring |

---

### 5. Civic Services

City infrastructure and cleanliness monitoring.

| Capability | Description |
|-----------|-------------|
| **Garbage Bin Monitoring** | Fill-level tracking and overflow alerts |
| **Illegal Dumping** | Unauthorized waste disposal detection |
| **Stray Animal Detection** | Cattle and animal presence on roads |
| **Road Damage** | Pothole and surface degradation detection |
| **Pollution Monitoring** | Air quality and noise level tracking |

---

### 6. Tourism Analytics

Visitor experience measurement for tourist zones, heritage sites, and public venues.

| Capability | Description |
|-----------|-------------|
| **Footfall Counting** | Real-time entry/exit visitor counts |
| **Dwell Time** | Zone-wise time spent analysis |
| **Demographics** | Visitor age and gender distribution |
| **Peak Hour Detection** | Busiest period identification |
| **Zone Hotspots** | Popular area mapping |
| **Comparative Analytics** | Period-over-period trend comparison |

---

## Edge Computing: MagicBox

MagicBox is the edge worker component that runs on NVIDIA Jetson devices at camera locations.

### Capabilities

- **Local AI Inference** - Runs YOLO, ANPR, VCC models on Jetson GPU
- **Camera Discovery** - Auto-discovers RTSP streams on the local network
- **Event Queue** - File-based queue with retry logic for reliable upstream delivery
- **Heartbeat** - Periodic health check-ins with CPU, GPU, memory, and temperature metrics
- **Config Sync** - Versioned configuration pushed from central server
- **Auto-Update** - Binary download and systemd service management

### Registration Flow

1. **Token-Based** - Admin pre-generates tokens; worker registers with token → auto-approved
2. **Approval-Based** - Worker requests registration → admin reviews device info → approve/reject

### Deployment

- ARM64 binaries for Jetson (JetPack 5.x)
- AMD64 binaries for x86 development
- Config stored at `/usr/magicbox/config.yaml`
- Managed as a systemd service

---

## Backend API

The Go backend exposes 90+ REST endpoints organized by domain.

### Core Endpoint Groups

| Group | Prefix | Description |
|-------|--------|-------------|
| **Devices** | `/api/devices` | Camera/sensor CRUD, heartbeat, statistics |
| **Events** | `/api/events` | Raw event ingestion (multipart, up to 32MB) |
| **Workers** | `/api/workers` | Edge worker registration, heartbeat, config |
| **Admin** | `/api/admin/workers` | Worker approval, camera assignment, management |
| **Crowd** | `/api/crowd` | Crowd analysis ingestion, alerts, hotspots |
| **Violations** | `/api/violations` | Traffic violation CRUD, approval workflow |
| **Vehicles** | `/api/vehicles` | Vehicle detection, watchlist management |
| **Analytics** | `/api/analytics` | Trends, comparisons, hotspot aggregation |
| **VCC** | `/api/vcc` | Vehicle classification stats, real-time data |
| **Feeds** | `/ws/feeds` | WebSocket video frame streaming |
| **Uploads** | `/api/uploads` | File upload handling |

### Real-time Communication

- **WebSocket Feed Hub** - Streams base64-encoded JPEG frames from cameras via NATS pub/sub
- **Heartbeat System** - Workers and devices send periodic health updates
- **Event Pipeline** - Edge → Event Queue → API Ingest → Database → WebSocket → UI

---

## Database Schema

PostgreSQL with 13 core entities managed via GORM auto-migration.

### Entity Relationship Overview

```
Device ──┬── Event
         ├── CrowdAnalysis ── CrowdAlert
         ├── VehicleDetection
         └── TrafficViolation

Worker ──┬── WorkerCameraAssignment
         ├── WorkerApprovalRequest
         └── DeviceHeartbeat

Vehicle ──┬── VehicleDetection
          ├── TrafficViolation
          └── Watchlist ── WatchlistAlert

WorkerToken (standalone, used during registration)
```

### Key Design Decisions

- **JSONB fields** for metadata, config, heatmap data, and recommendations - allows schema flexibility
- **Indexed queries** on device ID + timestamp for time-series analytics
- **Unique constraints** on MAC address, plate number, WireGuard IP, and tokens
- **Soft status tracking** - devices and workers have status enums (active, offline, revoked)

---

## Frontend Architecture

### Page Structure

| Route | Module | Description |
|-------|--------|-------------|
| `/` | Dashboard | KPI cards, alert feed, system health |
| `/crowd/*` | Crowd Management | Density, surge, queue, re-ID, aggression, reports |
| `/traffic/*` | Traffic | VCC, violations, ANPR, speed, WIM, parking |
| `/security/*` | Security | Intrusion, loitering, objects, weapons, faces, cameras |
| `/emergency/*` | Emergency | Fire, flood, coastal, accidents |
| `/civic/*` | Civic | Garbage, dumping, animals, roads, pollution |
| `/tourism/*` | Tourism | Footfall, dwell time, demographics, hotspots |
| `/settings` | Settings | User preferences, theme, alerts |

### Key UI Components

- **MainLayout** - Responsive shell with collapsible sidebar, header, footer
- **VideoWall** - Multi-camera grid with live HLS/WebSocket feeds
- **MapView** - Google Maps integration with device markers and zones
- **HeatmapView** - Spatial density overlays
- **ResizablePanels** - Operator-customizable layout
- **SpotlightSearch** - CMD+K command palette for quick navigation
- **NotificationEngine** - Real-time toast alerts with severity styling

### State Management

- React Context for view mode switching and notification state
- Custom hooks (`useCrowdData`) with configurable refresh intervals (30s/60s)
- Centralized API service layer with environment-configurable base URL

---

## Security

| Mechanism | Description |
|----------|-------------|
| **Worker Auth** | `X-Auth-Token` + `X-Worker-ID` headers on every request |
| **Registration Tokens** | Pre-generated, single-use, with expiry and revocation |
| **WireGuard VPN** | Encrypted tunnels for all edge-to-cloud traffic |
| **CORS** | Configurable origin allowlist |
| **Upload Limits** | 32MB max for multipart form data |
| **Approval Workflow** | Manual admin review for tokenless worker registration |
| **Audit Trail** | Created-by tracking on tokens, approvals, and alerts |

---

## Deployment

### Services & Ports

| Service | Port | Protocol |
|---------|------|----------|
| Frontend (Vite dev) | 8443 | HTTPS |
| Backend API | 3001 | HTTP |
| NATS (embedded) | 4233 | TCP |
| MagicBox Web UI | 8080 | HTTP |
| WireGuard VPN | 51820 | UDP |

### Environment Variables

**Backend (.env):**
- `DATABASE_URL` - PostgreSQL connection string
- `PORT` - API server port (default 3001)
- `ENV` - production / development
- `WIREGUARD_ENDPOINT` - VPN endpoint address

**Frontend:**
- `VITE_API_BASE_URL` - Backend API URL (default `http://localhost:8000/api`)

### Infrastructure

- **Docker** - Dockerfile and Compose for containerized deployment
- **Systemd** - Service files for Linux-based production deployments
- **Vercel** - Frontend hosting and edge worker binary distribution
- **PM2** - Process management for Node.js services

---

## AI/ML Models

| Model | Use Case | Variants |
|-------|----------|----------|
| **YOLO** | Object detection, people counting | Day, Night |
| **ANPR** | License plate recognition | Regional variants |
| **VCC** | Vehicle classification | 2W/4W/Auto/Truck/Bus |
| **Thermal Spectral** | Fire and smoke detection | Thermal camera input |
| **Depth Estimation** | Flood/waterlog depth | Monocular depth |
| **Face Recognition** | Watchlist matching | Embedding-based |
| **Weapon Detection** | Knife/gun recognition | Single-class variants |
| **Crowd Hybrid** | Combined density + flow | Multi-model ensemble |

Models run on Jetson edge devices with frame-level inference. Confidence scores, bounding boxes, and classification results are sent upstream as structured events.

---

## Development State

| Area | Status |
|------|--------|
| Backend API (Go) | Production-ready |
| Database schema | Comprehensive, 13 entities |
| Worker management | Complete (token + approval flows) |
| Event pipeline | Functional |
| Crowd analytics backend | Complete |
| Traffic/ANPR backend | Complete |
| Frontend UI | Active development |
| Frontend API integration | Simulated (mock data layer) |
| AI model integration | Backend-ready, edge integration in progress |
| Production deployment | Docker + systemd ready |

---

## Summary

IRIS is a full-stack smart city platform that combines real-time video analytics, distributed edge computing, and a modern web command center. It is built to scale from a handful of cameras to city-wide deployments with thousands of devices, providing six major analytics modules (crowd, traffic, security, emergency, civic, tourism) under a single unified interface.
