# Self-Healing Distributed Cache Cluster

An enterprise-grade, sharded, replicated, and self-healing distributed key-value cache built from scratch in Node.js and TypeScript. 

This project implements consistent hashing using SHA-256, active replication, SWIM-inspired peer-to-peer gossip for membership, automated failure detection, zero-downtime state migration (rebalancing) upon node additions/removals, dynamic consistency quorums (ONE/QUORUM/ALL), and memory-bounded LRU/LFU cache evictions. It also includes an interactive Web Visual Dashboard.

---

## Key Features

1. **SHA-256 Consistent Hashing**:
   - Spreads keys and physical nodes across a 32-bit numeric ring space.
   - Utilizes **Virtual Nodes (vnodes)** (default: 40 per physical node) to ensure uniform key distribution.
   - Adding or removing nodes reshuffles a minimal number of keys ($\approx 1/M$ of keys).

2. **Active Replication**:
   - Replicates every key-value pair to a configurable number of replicas (default: $N=2$).
   - Automatically writes to the primary node and the next $N-1$ successive healthy nodes clockwise on the hash ring.

3. **SWIM-inspired Gossip & Failure Detection**:
   - P2P gossip protocol synchronizes node memberships and heartbeat counters bidirectionally.
   - Distinguishes network blips from hard failures using a **Suspicion State** (`ALIVE` $\rightarrow$ `SUSPECT` $\rightarrow$ `DEAD`).
   - Supports self-refutation: if a node is falsely reported as suspected/dead, it increments its heartbeat and refutes the claim.
   - Auto-prunes dead nodes from the active consistent hash ring and reroutes client queries dynamically.

4. **Zero-Downtime State Migration & Rebalancing**:
   - When a node joins or returns, the keys it is now responsible for are transferred in background batches from their current owners.
   - When a node leaves gracefully, it handshakes and flushes all its keys to their new primary/replica targets on the updated ring before terminating.
   - Client operations continue uninterrupted during migrations. Read-repair catches any temporary mismatches.

5. **Configurable Read/Write Quorums**:
   - **Writes**: Support `ONE` (first ack), `QUORUM` (consensus), and `ALL` (strict sync).
   - **Reads**: Query $R$ replica nodes, resolve conflicts using physical Last-Write-Wins (LWW) timestamps, and trigger background **Read-Repair** on outdated nodes.

6. **LRU/LFU Eviction Policies**:
   - Configurable dynamic memory capacity limits (in bytes) on each node.
   - Automatically evicts keys under memory pressure using Least Recently Used (LRU) or Least Frequently Used (LFU) strategies.

7. **Interactive Dashboard Visualizer**:
   - Modern, glowing dark-theme monitoring panel.
   - Renders the consistent hash ring with virtual nodes, node statuses, keys list, and an operations feed.
   - Features cluster simulators to trigger chaos (hard crash nodes, perform graceful leaves, add nodes, or run traffic).

---

## Tech Stack
* **Runtime**: Node.js
* **Language**: TypeScript
* **Networking**: Express (HTTP API endpoints), WebSockets (real-time telemetry to Dashboard)

---

## Getting Started

### 1. Installation
Install the project dependencies:
```bash
npm install
```

### 2. Run the Cluster
Spin up a 5-node cluster (ports 8001–8005) and the Client Proxy Gateway (port 8000) using a single command:
```bash
npm run cluster:start
```

### 3. Open the Dashboard
Open your browser and navigate to:
```
http://localhost:8000/dashboard
```
Here, you can:
* Write and read keys with customizable Quorum levels.
* Visualise the Hashing Ring and dynamic vnodes.
* Click **⚡ Start Chaos Stress Test** to stream continuous traffic.
* Simulate a node crashing mid-traffic (click **❌ Kill Node**) and watch the cluster automatically detect the failure, trigger suspicion, mark it dead, remove it from the ring, and re-route traffic with zero client errors!
* Click **🚪 Leave Node** to watch graceful key migration in action.

### 4. Run Automated Chaos/Resilience Tests
To execute the automated headless chaos load test (which spins up 5 nodes, runs heavy read/write traffic, crashes a random node, and verifies a 0% client error rate):
```bash
npm run test:resilience
```

---

## API Endpoints

### Client Proxy Gateway (Port 8000)
* `GET /keys/:key?consistency=QUORUM`: Retrieves a key using quorum reads.
* `POST /keys/:key?consistency=QUORUM`: Writes a key using quorum writes. Accepts body: `{ "value": "val", "ttlSeconds": 30 }`.
* `DELETE /keys/:key`: Deletes a key from all replicas.
* `GET /status`: Retrieves proxy health and stats of all nodes.

### Local Node Endpoint (Ports 8001–8005)
* `GET /local/keys/:key`: Gets key from local node store.
* `POST /local/keys/:key`: Sets key on local node store.
* `DELETE /local/keys/:key`: Deletes key from local node store.
* `POST /config`: Configures memory limit and eviction policy. Body: `{ "maxMemoryBytes": 10240, "evictionPolicy": "LRU" }`.
* `POST /leave`: Triggers graceful handoff migration and shutdown.
* `POST /leave?crash=true`: Simulates a sudden hard crash (no handoff, no gossip updates).
