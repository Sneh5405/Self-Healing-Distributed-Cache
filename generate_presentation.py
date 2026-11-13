import sys
import os
from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.enum.text import PP_ALIGN
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE

def create_deck():
    prs = Presentation()
    prs.slide_width = Inches(13.333)
    prs.slide_height = Inches(7.5)
    blank_slide_layout = prs.slide_layouts[6]

    # Color Palette (Executive Dark Modern)
    BG_COLOR = RGBColor(11, 15, 25)         # #0B0F19 Dark Navy Slate
    CARD_BG = RGBColor(22, 31, 48)          # #161F30 Container Card
    CARD_BORDER = RGBColor(40, 53, 76)      # #28354C Border
    PRIMARY = RGBColor(56, 189, 248)        # #38BDF8 Sky Cyan
    SECONDARY = RGBColor(129, 140, 248)    # #818CF8 Indigo
    ACCENT_GREEN = RGBColor(52, 211, 153)   # #34D399 Emerald
    ACCENT_AMBER = RGBColor(251, 191, 36)   # #FBBF24 Amber
    TEXT_WHITE = RGBColor(248, 250, 252)    # #F8FAFC
    TEXT_MUTED = RGBColor(148, 163, 184)    # #94A3B8 Slate Gray

    slides_data = [
        # SLIDE 1: Title (Zeel)
        {
            "is_title": True,
            "title": "Self-Healing Distributed Cache Cluster",
            "subtitle": "A Masterless, Fault-Tolerant, Horizontally Scalable In-Memory Storage Architecture",
            "speaker_name": "Moradiya Zeel Hareshbhai",
            "speaker_id": "202351085",
            "speaker_role": "Speaker 1: Project Lead & Architecture",
            "bullet_sections": [],
            "transcript": (
                "Good morning, Professor and everyone. Today, our team is presenting our project: "
                "a Self-Healing Distributed Key-Value Cache Cluster. We built this project from scratch using TypeScript and Node.js.\n\n"
                "In simple words, it works like a resilient Redis cluster. It spreads data across multiple servers, "
                "makes sure data is never lost if a server crashes, and automatically adds new servers when the load increases.\n\n"
                "Here is our team order for today's presentation:\n"
                "1. I am Moradiya Zeel, and I will explain the problem, our architecture, and why we chose this tech stack.\n"
                "2. Next, Praval will explain how data is stored, consistent hashing, and how read and write operations work.\n"
                "3. Then, Sneh will explain how nodes check each other using gossip, how self-healing works, and our autoscaling rules.\n"
                "4. Finally, Om will explain data rebalancing, give a live demo on our dashboard, and conclude our presentation.\n\n"
                "Let us start with the core problem we are solving."
            )
        },
        # SLIDE 2: Problem & Motivation (Zeel)
        {
            "is_title": False,
            "title": "The Core Problem & Why We Need Distributed Caches",
            "subtitle": "Why Traditional Single-Server Caches Fail Under Heavy Traffic",
            "speaker_name": "Moradiya Zeel Hareshbhai",
            "speaker_id": "202351085",
            "speaker_role": "Speaker 1: Project Lead & Architecture",
            "bullet_sections": [
                ("The Database Problem", [
                    "Databases are slow because they read and write to disk.",
                    "Websites use an in-memory cache (like Redis) in RAM to keep data fast and protect the database."
                ]),
                ("Three Big Flaws of a Single Cache Server", [
                    "Single Point of Failure: If that single cache server crashes, all requests hit the database at once. This causes a 'cache stampede' and takes down the entire website.",
                    "Memory Limit: A single computer has limited RAM. If your data grows, one machine cannot hold it.",
                    "Manual Recovery: If a server goes down, someone has to manually restart it and fix lost data."
                ]),
                ("What Our Project Does", [
                    "Splits data across multiple nodes (Sharding) — easily scale by adding more nodes.",
                    "Copies every key to 2 nodes (Replication) — if one node crashes, data is safe.",
                    "Automatic Recovery (Self-Healing) — detects failure in seconds and heals without human intervention."
                ])
            ],
            "transcript": (
                "Let us understand why we need this project. In any busy application like Amazon or Instagram, the database is the slowest part. "
                "To make things fast, developers place a cache — like Redis — in front of the database to store frequent data in RAM.\n\n"
                "But using just one cache server creates three big problems:\n"
                "First, Single Point of Failure. If that one cache server crashes, thousands of queries hit the database at the exact same second. "
                "This is called a cache stampede, and it can crash the whole database.\n"
                "Second, Memory Limit. One computer only has so much RAM. When your website grows, one machine is not enough.\n"
                "Third, No Auto-Recovery. When a server fails, developers have to manually fix it.\n\n"
                "Our project solves this by splitting data across multiple nodes, replicating every piece of data, and automatically fixing issues when servers fail."
            )
        },
        # SLIDE 3: Architecture (Zeel)
        {
            "is_title": False,
            "title": "High-Level System Architecture",
            "subtitle": "Masterless Peer-to-Peer Cluster with Client Proxy Gateway",
            "speaker_name": "Moradiya Zeel Hareshbhai",
            "speaker_id": "202351085",
            "speaker_role": "Speaker 1: Project Lead & Architecture",
            "bullet_sections": [
                ("Masterless P2P Design (No Single Boss)", [
                    "All cache nodes are equal peers — no single master node that can fail.",
                    "Inspired by Amazon Dynamo architecture."
                ]),
                ("Client Proxy Gateway (Port 8000)", [
                    "The single entry point for clients and browsers.",
                    "Looks up which node owns the key using Consistent Hashing.",
                    "If a node is down, the proxy automatically retries on a backup replica.",
                    "Monitors cluster load and triggers autoscaling when traffic increases."
                ]),
                ("Cache Storage Nodes (Ports 8001 - 8005+)", [
                    "Each node runs its own in-memory key-value store.",
                    "Nodes talk to each other constantly using a Gossip Protocol.",
                    "Background rebalancer moves data when nodes join or leave."
                ])
            ],
            "transcript": (
                "On Slide 3, you can see how our system is organized. We use a masterless peer-to-peer design, inspired by Amazon Dynamo.\n\n"
                "In traditional systems, you have one master node and multiple worker nodes. But if the master node dies, the whole system stops working. "
                "In our cluster, every node is equal. There is no single master.\n\n"
                "The system has two main parts:\n"
                "1. The Client Proxy Gateway running on port 8000. When a client wants to read or write a key, it sends a simple HTTP request to the proxy. "
                "The proxy checks the hash ring, finds which nodes are responsible, and forwards the request. If the primary node is dead, the proxy automatically retries on the backup replica.\n"
                "2. The Cache Nodes running on ports 8001, 8002, 8003, and so on. They store the data, talk to each other to check health, and move data when needed."
            )
        },
        # SLIDE 4: Tech Stack (Zeel)
        {
            "is_title": False,
            "title": "Tech Stack & Engineering Choices",
            "subtitle": "Why Node.js, TypeScript, Express, and WebSockets?",
            "speaker_name": "Moradiya Zeel Hareshbhai",
            "speaker_id": "202351085",
            "speaker_role": "Speaker 1: Project Lead & Architecture",
            "bullet_sections": [
                ("Node.js Runtime", [
                    "Distributed caches do mostly network communication (I/O), not heavy CPU math.",
                    "Node.js non-blocking event loop handles thousands of network calls smoothly without thread locks."
                ]),
                ("TypeScript Language", [
                    "Strict types ensure nodes send and receive the exact expected data format.",
                    "Catches bugs before running code instead of failing at runtime across network messages."
                ]),
                ("Express & Native WebSockets", [
                    "Express: Fast and simple REST endpoints for storing and reading keys.",
                    "WebSockets: Pushes live cluster updates directly to the dashboard with zero delay."
                ]),
                ("What We Did NOT Use (Built From Scratch)", [
                    "No external database (we built our own in-memory store).",
                    "No ZooKeeper or Consul (we built our own gossip and discovery protocol)."
                ])
            ],
            "transcript": (
                "On Slide 4, here is why we picked this tech stack:\n\n"
                "We chose Node.js because a distributed cache spends most of its time waiting for network calls — nodes pinging each other, sending keys, and responding to clients. "
                "Node.js handles this non-blocking I/O very well without needing complex multi-threading.\n\n"
                "We used TypeScript because in distributed systems, nodes send data packets across the network. "
                "TypeScript gives us strict types, so if any node sends the wrong data format, the compiler catches it right away.\n\n"
                "Express gives us clean REST APIs, and WebSockets let us stream live metrics to our dashboard in real time.\n\n"
                "Most importantly, we did not use any ready-made tools like ZooKeeper or an external database. We wrote the storage, the hashing ring, and the gossip protocol completely ourselves.\n\n"
                "Now, I will pass the microphone to Praval, who will explain how our storage engine and consistent hashing work."
            )
        },
        # SLIDE 5: In-Memory Storage Engine (Praval)
        {
            "is_title": False,
            "title": "The In-Memory Storage Engine",
            "subtitle": "How Keys Are Stored, Expired, and Evicted in RAM",
            "speaker_name": "Praval Hitesh Parikh",
            "speaker_id": "202351110",
            "speaker_role": "Speaker 2: Storage & Distributed Data Lead",
            "bullet_sections": [
                ("Inside Each Cache Node", [
                    "Data is stored in a fast TypeScript Map<string, CacheEntry> in memory.",
                    "value: The actual cached text or JSON data.",
                    "expiry: Time when the key should expire (TTL).",
                    "timestamp: Exact time the key was written (used to resolve conflicts).",
                    "version: Counter that increments whenever the key updates."
                ]),
                ("Two Ways Keys Expire (TTL)", [
                    "Passive cleanup: When a client asks for a key, we check if it expired. If yes, delete it and return 404.",
                    "Active cleanup: A background timer checks keys every 1 second and cleans up dead keys that nobody asked for."
                ]),
                ("Memory Eviction (When RAM is Full)", [
                    "LRU (Least Recently Used): Removes keys that have not been read or written for the longest time.",
                    "LFU (Least Frequently Used): Removes keys that have the lowest total access count."
                ])
            ],
            "transcript": (
                "Thank you, Zeel. Hello everyone, I am Praval. On Slide 5, let us look inside a single cache node.\n\n"
                "Each node stores its data in memory using a fast Map. For every key, we save four things:\n"
                "1. The value itself.\n"
                "2. An expiry time, which is the TTL.\n"
                "3. A write timestamp, so we know when it was saved.\n"
                "4. A version number.\n\n"
                "To clean up expired keys without slowing down the server, we use two methods:\n"
                "First is Passive cleanup. When someone asks to read a key, we check if it is expired. If it is, we delete it immediately.\n"
                "Second is Active cleanup. Every second, a background worker scans keys and removes expired ones that nobody is reading.\n\n"
                "And if a node reaches its memory limit, it protects itself using either LRU — deleting the oldest unused keys — or LFU — deleting the least popular keys."
            )
        },
        # SLIDE 6: Consistent Hashing & Virtual Nodes (Praval)
        {
            "is_title": False,
            "title": "Consistent Hashing & Virtual Nodes",
            "subtitle": "How We Decide Which Node Stores Which Key Without Chaos",
            "speaker_name": "Praval Hitesh Parikh",
            "speaker_id": "202351110",
            "speaker_role": "Speaker 2: Storage & Distributed Data Lead",
            "bullet_sections": [
                ("Why Simple Modulo Hashing (key % N) Fails", [
                    "If you have 3 nodes and you add a 4th node, N changes from 3 to 4.",
                    "Almost every key moves to a different server! All cache misses occur at once."
                ]),
                ("Consistent Hash Ring (The Solution)", [
                    "Imagine a circle numbered from 0 to 4.29 billion (32-bit integer).",
                    "We hash each key with SHA-256 to place it at a position on the circle.",
                    "Walk clockwise to find the first node — that node owns the key."
                ]),
                ("Virtual Nodes (Vnodes) Fix Hotspots", [
                    "Problem: If nodes are placed randomly, one node might get 60% of keys and another only 10%.",
                    "Solution: Each physical node gets 40 virtual points spread around the circle.",
                    "Result: Keys are evenly distributed (less than 5% difference between nodes)."
                ])
            ],
            "transcript": (
                "On Slide 6, we discuss Consistent Hashing. This is the heart of how data is distributed.\n\n"
                "In simple hashing, you take hash(key) % N, where N is the number of servers. But if one server crashes, N changes from 3 to 2. "
                "Suddenly, almost every key hashes to a different machine! Your entire cache becomes empty and useless.\n\n"
                "Consistent hashing fixes this. Imagine a giant clock or circle numbered from 0 to 4 billion. "
                "We hash each node and place it on the circle. When a key arrives, we hash it to a number on the circle and walk clockwise until we hit a node. That node owns the key.\n\n"
                "Now, what happens if two nodes land close together? One node would get too many keys — this is called a hotspot. "
                "To prevent this, we give each physical server 40 virtual nodes scattered all around the circle. "
                "Because of these 40 virtual nodes, keys spread out very evenly across all servers, with less than 5% difference between nodes."
            )
        },
        # SLIDE 7: How Reads & Writes Work (Praval)
        {
            "is_title": False,
            "title": "How Reads & Writes Work (Quorum Consensus)",
            "subtitle": "Replicating Data and Keeping It Consistent Across Nodes",
            "speaker_name": "Praval Hitesh Parikh",
            "speaker_id": "202351110",
            "speaker_role": "Speaker 2: Storage & Distributed Data Lead",
            "bullet_sections": [
                ("Replication Factor N = 2", [
                    "Every key is stored on 2 nodes: 1 primary node + 1 replica node clockwise on the ring.",
                    "If the primary node dies, the replica already has the exact same data."
                ]),
                ("Consistency Levels (User Can Choose)", [
                    "ONE: Fast. Returns success as soon as 1 node saves the key.",
                    "QUORUM: Balanced. Needs majority approval (floor(N/2) + 1 = 2 out of 2 nodes). Most safe.",
                    "ALL: Strict. All replicas must confirm write before returning OK."
                ]),
                ("Conflict Resolution (Last-Write-Wins)", [
                    "If two nodes have different values for the same key, we compare timestamps.",
                    "The newest timestamp wins. The older one is automatically overwritten."
                ])
            ],
            "transcript": (
                "On Slide 7, let us see how writing and reading works.\n\n"
                "We use a replication factor of 2. That means every key is written to 2 nodes: the primary node and the next clockwise node as a replica.\n\n"
                "When a client saves data, they can pick how strict they want the confirmation to be:\n"
                "- Consistency ONE: Very fast. As soon as one node saves it, we return success.\n"
                "- Consistency QUORUM: This is the default. It requires a majority of replicas to confirm the write before telling the client OK.\n"
                "- Consistency ALL: Requires all replicas to confirm.\n\n"
                "If two writes happen at the same time, we use Last-Write-Wins. We compare the timestamps on both nodes, and the latest write wins.\n\n"
                "Now, how do nodes talk to each other and detect when a server crashes? "
                "I will hand over to Sneh to explain our Gossip Protocol, self-healing, and autoscaling."
            )
        },
        # SLIDE 8: Gossip Protocol (Sneh)
        {
            "is_title": False,
            "title": "Gossip Protocol & Failure Detection",
            "subtitle": "How Nodes Talk to Each Other and Detect Crashes Automatically",
            "speaker_name": "Gondaliya Sneh Vipulkumar",
            "speaker_id": "202351174",
            "speaker_role": "Speaker 3: Consensus, Fault Tolerance & Reliability Lead",
            "bullet_sections": [
                ("How Gossip Works (Epidemic Protocol)", [
                    "Every 1 second, each node picks one random peer and sends its heartbeat list.",
                    "Like a rumor, health updates spread to the entire cluster in seconds without overloading the network."
                ]),
                ("Three-Step Failure Detection (ALIVE -> SUSPECT -> DEAD)", [
                    "ALIVE: The node is healthy and answering pings.",
                    "SUSPECT: If a node misses one ping, we do NOT immediately kill it. We mark it SUSPECT for 10 seconds. Maybe the network was just temporarily slow.",
                    "DEAD: If 10 seconds pass with zero response, the node is marked DEAD and removed from the ring."
                ]),
                ("Self-Refutation (Canceling False Alarms)", [
                    "If a healthy node hears that others think it is dead, it immediately shouts 'I am alive!' with a higher heartbeat number. This stops false alarms."
                ])
            ],
            "transcript": (
                "Thank you, Praval. Hello Professor and friends, I am Sneh. On Slide 8, let us look at how nodes monitor each other.\n\n"
                "Instead of having a central boss server that checks everyone, our nodes use a Gossip Protocol inspired by the SWIM protocol.\n"
                "Every second, each node picks a random peer and sends its status. It works just like spreading a rumor — within a few seconds, "
                "every node knows the health of every other node in the cluster.\n\n"
                "A big problem in distributed systems is false alarms. If a network packet gets delayed for half a second, you should not assume the server is dead.\n"
                "So we built a three-step state machine:\n"
                "1. If a ping fails, the node goes from ALIVE to SUSPECT. It gets a 10-second grace period.\n"
                "2. If the suspected node is actually alive, it hears about the suspicion through gossip and refutes it by saying 'I am alive!'\n"
                "3. Only if 10 full seconds pass with no answer does the cluster mark it DEAD and remove it from the ring."
            )
        },
        # SLIDE 9: Self-Healing & Read-Repair (Sneh)
        {
            "is_title": False,
            "title": "Self-Healing: Failover & Read-Repair",
            "subtitle": "How the Cluster Heals Itself When Nodes Crash or Data Gets Out of Sync",
            "speaker_name": "Gondaliya Sneh Vipulkumar",
            "speaker_id": "202351174",
            "speaker_role": "Speaker 3: Consensus, Fault Tolerance & Reliability Lead",
            "bullet_sections": [
                ("Automatic Client Failover", [
                    "If a client requests a key and Node 8001 is dead, the proxy does not show an error.",
                    "It immediately retries on the replica (Node 8002). The client sees a normal 200 OK response."
                ]),
                ("Read-Repair (Healing Outdated Data in the Background)", [
                    "Suppose Node A was restarted and missed an update, so it has old data.",
                    "When a client reads with QUORUM, the coordinator queries both nodes.",
                    "It gives the client the newest data immediately (0 delay).",
                    "In the background, it silently updates the outdated node. The cluster fixes itself automatically."
                ]),
                ("Graceful Leave vs Sudden Crash", [
                    "Graceful: When stopping a node cleanly, it sends all its keys to neighbors first, then turns off.",
                    "Crash: If it dies suddenly, the backup replica serves traffic while the cluster rebalances."
                ])
            ],
            "transcript": (
                "On Slide 9, we show how our cluster heals itself in two important ways:\n\n"
                "First, Failover Routing. If a primary server crashes right when a user requests data, the proxy gateway catches the failure and immediately routes the request to the backup replica. "
                "The user never sees an error screen — they get their data with zero interruption.\n\n"
                "Second, Read-Repair. Imagine Node B was offline for 10 seconds while a key was updated on Node A. Node B now has old data. "
                "When a client performs a QUORUM read, our coordinator compares the timestamps on both nodes. It hands the newest value to the client immediately. "
                "Then, in the background, it sends the fresh data to Node B to heal it. Over time, all data inconsistencies fix themselves without slowing down users.\n\n"
                "Now, what happens if our website gets a sudden surge of traffic? Let us look at autoscaling."
            )
        },
        # SLIDE 10: Dynamic Autoscaling (Sneh)
        {
            "is_title": False,
            "title": "Dynamic Autoscaling Engine",
            "subtitle": "Automatically Spawning New Nodes When Keys or Traffic Increase",
            "speaker_name": "Gondaliya Sneh Vipulkumar",
            "speaker_id": "202351174",
            "speaker_role": "Speaker 3: Consensus, Fault Tolerance & Reliability Lead",
            "bullet_sections": [
                ("The Autoscaler Loop (Runs Every 5 Seconds)", [
                    "The proxy checks CPU, memory, requests per second (RPS), and key count on every active node."
                ]),
                ("When Does It Scale Up? (Adds a New Node)", [
                    "Key Skew: If any single node holds > 120% of the average key count (data is unbalanced).",
                    "Throughput: If traffic exceeds 5,000 requests per second per node.",
                    "Hardware: If average CPU > 75% or memory > 80%."
                ]),
                ("When Does It Scale Down? (Removes a Spawned Node)", [
                    "Only when traffic is low (CPU < 30%, memory < 40%, RPS < 2,000) AND keys are balanced.",
                    "Baseline 3 nodes are never deleted; only dynamically spawned nodes scale down."
                ]),
                ("Cooldown Timers (No Thrashing)", [
                    "Waits 30 seconds after scale-up and 2 minutes after scale-down to keep the cluster stable."
                ])
            ],
            "transcript": (
                "Slide 10 explains our Dynamic Autoscaling Engine. Every 5 seconds, the proxy gateway monitors the cluster health.\n\n"
                "It triggers a Scale-Up if any of these things happen:\n"
                "1. Key Skew: If one node holds more than 120% of the average keys in the cluster. This means keys are getting unbalanced.\n"
                "2. High Traffic: If requests per second exceed 5,000.\n"
                "3. High CPU or Memory: If CPU passes 75% or memory passes 80%.\n\n"
                "When triggered, the proxy automatically starts a new cache node on the next port — like 8004 — gives it 40 virtual nodes, and adds it to the hash ring.\n\n"
                "And when traffic drops, the autoscaler cleanly scales down to save resources, but it always protects our 3 baseline seed nodes.\n\n"
                "Now, I hand over to Om, who will show how data moves to the new node, run our live demo, and conclude our presentation."
            )
        },
        # SLIDE 11: Cluster Rebalancing (Om)
        {
            "is_title": False,
            "title": "Zero-Downtime Data Rebalancing",
            "subtitle": "How Keys Move to the New Node Smoothly Without Slowing Down Traffic",
            "speaker_name": "Mangukiya Om Harjibhai",
            "speaker_id": "202351079",
            "speaker_role": "Speaker 4: Autoscaling, Performance & Live Demo Lead",
            "bullet_sections": [
                ("What Happens When a New Node Joins?", [
                    "The hash ring updates with the new node's 40 virtual points.",
                    "Existing nodes scan their local storage and ask: 'Do any of my keys now belong to the new node?'"
                ]),
                ("Batched Migration (No Freezing)", [
                    "Sending 10,000 keys at once would freeze the server.",
                    "We send keys in small batches of 50 keys, with a 50-millisecond pause between batches.",
                    "This leaves the Node.js event loop free to answer normal client read and write requests."
                ]),
                ("Safe Cleanup", [
                    "The old node only deletes its local copy after the new node confirms it received the keys.",
                    "Result: Keys are rebalanced smoothly across all servers with zero downtime."
                ])
            ],
            "transcript": (
                "Thank you, Sneh. Hello everyone, I am Om. On Slide 11, we explain how data moves when a new node joins.\n\n"
                "When Node 8004 starts, the existing nodes check their stored keys against the new ring. "
                "Any keys that now belong to Node 8004 must be moved.\n\n"
                "If you try to move thousands of keys all at once, you will choke the network and freeze the server. "
                "To prevent this, our rebalancer sends keys in small batches of 50 keys, with a 50-millisecond rest between batches. "
                "This keeps the server fast and responsive to normal user requests.\n\n"
                "Once the new node confirms it received the batch, the old node deletes its local copy. "
                "Everything happens in the background without dropping a single request."
            )
        },
        # SLIDE 12: Real-Time Dashboard (Om)
        {
            "is_title": False,
            "title": "Real-Time Telemetry Dashboard",
            "subtitle": "Making Distributed Systems Visible at http://localhost:8000/dashboard",
            "speaker_name": "Mangukiya Om Harjibhai",
            "speaker_id": "202351079",
            "speaker_role": "Speaker 4: Autoscaling, Performance & Live Demo Lead",
            "bullet_sections": [
                ("Interactive Hash Ring Canvas", [
                    "Visualizes the 32-bit ring circle, all virtual nodes, and exact key positions in real time."
                ]),
                ("Node Health Cards", [
                    "Shows each node's Port, Status (ALIVE/SUSPECT/DEAD), Key Count, and Memory Usage.",
                    "Connected directly via WebSockets for instant updates without page refreshing."
                ]),
                ("Chaos & Control Buttons", [
                    "Buttons to add keys, manually trigger scale-up (+ Add Node), or kill a node to test failover."
                ]),
                ("Live Operations Console", [
                    "A streaming log showing gossip heartbeats, key migrations, and quorum confirmations."
                ])
            ],
            "transcript": (
                "Slide 12 shows our live monitoring dashboard. We built this to make distributed system concepts visual and easy to understand.\n\n"
                "- On the left, we have a canvas drawing the Consistent Hash Ring. You can see the nodes and virtual nodes positioned on the circle.\n"
                "- In the middle, Node Health Cards show live stats: memory usage, active status, and key counts, updated through WebSockets.\n"
                "- On the right, our Operations Console streams live logs showing gossip messages, migrations, and reads/writes.\n\n"
                "Let us now switch to our live demo to see all of this working in real time."
            )
        },
        # SLIDE 13: Live Demo & Test Results (Om)
        {
            "is_title": False,
            "title": "Live Demonstration & Chaos Testing",
            "subtitle": "Watch Autoscaling and Self-Healing Happen Live",
            "speaker_name": "Mangukiya Om Harjibhai",
            "speaker_id": "202351079",
            "speaker_role": "Speaker 4: Autoscaling, Performance & Live Demo Lead",
            "bullet_sections": [
                ("Live Demo Steps", [
                    "Step 1: Start 3 baseline nodes (8001, 8002, 8003) and Proxy (8000).",
                    "Step 2: Run 'npm run seed:stress' to insert 2,000 keys under QUORUM consistency.",
                    "Step 3: Watch proxy detect Key Skew > 120% and automatically spawn Node 8004.",
                    "Step 4: Watch keys migrate in batches of 50 to rebalance from ~666/node to ~500/node.",
                    "Step 5: Click 'Kill Node' on Node 8002; proxy failover ensures 0% data loss and 0 errors."
                ]),
                ("Test Results (npm run test:autoscale)", [
                    "Scale-Up Speed: Spawns new node in under 2.1 seconds after load increases.",
                    "Resilience: 0.00% data loss across 10,000 stress requests during node crash simulations."
                ])
            ],
            "transcript": (
                "(Switching screen to browser and terminal)\n\n"
                "As you can see on the screen, our cluster is running with 3 nodes on ports 8001, 8002, and 8003. "
                "The dashboard shows all three nodes are ALIVE.\n\n"
                "Now, in the terminal, I will run our stress script: npm run seed:stress. This writes 2,000 keys.\n"
                "Notice the dashboard: keys are being stored and replicated. Now watch the terminal logs:\n"
                "[Autoscaler] SCALE UP TRIGGERED: Key skew detected!\n\n"
                "The proxy immediately spawns Node 8004. Look at the dashboard — a 4th card appears, and the rebalance log shows:\n"
                "[Node 8001] Migrating keys to http://localhost:8004...\n"
                "Within seconds, the keys balance evenly across all 4 servers.\n\n"
                "Now let us simulate a crash. I will click Kill Node on Node 8002.\n"
                "Node 8002 turns red. But when we fetch keys from it, the proxy instantly routes to the replica on 8003. "
                "Zero errors, zero lost data.\n\n"
                "Let us switch back to the slides to wrap up."
            )
        },
        # SLIDE 14: Challenges Solved (Om)
        {
            "is_title": False,
            "title": "Engineering Challenges We Solved",
            "subtitle": "Real Problems We Faced and How We Fixed Them",
            "speaker_name": "Mangukiya Om Harjibhai",
            "speaker_id": "202351079",
            "speaker_role": "Speaker 4: Autoscaling, Performance & Live Demo Lead",
            "bullet_sections": [
                ("1. Key Hotspots", [
                    "Problem: Early tests with 1 node point had one node taking 60% of keys.",
                    "Solution: Added 40 Virtual Nodes per physical node for balanced distribution."
                ]),
                ("2. False Alarms on Network Lags", [
                    "Problem: A slow ping was causing nodes to be marked dead by mistake.",
                    "Solution: 3-tier suspicion (ALIVE -> SUSPECT -> DEAD) + Self-Refutation."
                ]),
                ("3. Server Freezing During Migration", [
                    "Problem: Moving thousands of keys at once blocked the Node.js event loop.",
                    "Solution: Batched migration of 50 keys with 50ms pauses."
                ]),
                ("4. Out-of-Sync Replicas", [
                    "Problem: Replicas missed updates during short reboots.",
                    "Solution: Last-Write-Wins timestamps + background Read-Repair."
                ])
            ],
            "transcript": (
                "On Slide 14, here are the main engineering challenges we faced and solved:\n\n"
                "1. Hotspots: In our first version, one server got way more keys than the others. We fixed this by introducing 40 virtual nodes per server.\n"
                "2. False Alarms: Sometimes a tiny network delay made the system think a node died. We added the SUSPECT state and self-refutation to stop false alarms.\n"
                "3. Event Loop Freezing: Moving all keys at once slowed down Node.js. We fixed this with batched migrations of 50 keys with small 50ms pauses.\n"
                "4. Stale Data: When nodes rejoined, they had old values. We fixed this using Last-Write-Wins timestamps and background Read-Repair."
            )
        },
        # SLIDE 15: Limitations & Future Roadmap (Om)
        {
            "is_title": False,
            "title": "Limitations & What We Would Add Next",
            "subtitle": "Areas for Improvement Before Commercial Production",
            "speaker_name": "Mangukiya Om Harjibhai",
            "speaker_id": "202351079",
            "speaker_role": "Speaker 4: Autoscaling, Performance & Live Demo Lead",
            "bullet_sections": [
                ("Current Boundaries", [
                    "Volatile Memory: Everything is stored in RAM. If the whole power goes off, data is lost.",
                    "In-Process Nodes: For local testing, nodes run in one process.",
                    "Physical Clock Reliance: Last-Write-Wins relies on computer clocks being in sync."
                ]),
                ("Future Improvements (Next Steps)", [
                    "Durability: Add a Write-Ahead Log (WAL) on disk to recover data after restarts.",
                    "Docker Containers: Run each node inside its own independent Docker container.",
                    "Vector Clocks: Use logical vector clocks instead of wall-clock timestamps.",
                    "Security: Add Mutual TLS encryption and API key authentication."
                ])
            ],
            "transcript": (
                "On Slide 15, we look honestly at current limitations and what we would improve next:\n\n"
                "First, Durability. Right now, data is only in RAM. If power goes out completely, data is lost. In the future, we would add a Write-Ahead Log (WAL) on disk so data survives a full restart.\n"
                "Second, Process Isolation. Right now, nodes run in one Node.js process for easy testing. In production, each node would run in its own Docker container.\n"
                "Third, Vector Clocks. Replacing physical timestamps with vector clocks would solve clock drift issues.\n"
                "Fourth, Security. Adding TLS encryption and API keys to protect endpoints."
            )
        },
        # SLIDE 16: Conclusion & Q&A (Om)
        {
            "is_title": False,
            "title": "Conclusion & Summary",
            "subtitle": "Thank You! We Are Ready for Your Questions",
            "speaker_name": "Mangukiya Om Harjibhai",
            "speaker_id": "202351079",
            "speaker_role": "Speaker 4: Autoscaling, Performance & Live Demo Lead",
            "bullet_sections": [
                ("Summary of What We Built", [
                    "A resilient, masterless distributed key-value cache cluster built completely from scratch in TypeScript.",
                    "Consistent Hashing with 40 virtual nodes to prevent hotspots.",
                    "P2P Gossip failure detection with self-refutation.",
                    "Dynamic autoscaling when key skew exceeds 120% or traffic spikes.",
                    "Zero-downtime data migration and proven 0.00% data loss under crash tests."
                ]),
                ("Team Members", [
                    "1. Moradiya Zeel Hareshbhai (202351085)",
                    "2. Praval Hitesh Parikh (202351110)",
                    "3. Gondaliya Sneh Vipulkumar (202351174)",
                    "4. Mangukiya Om Harjibhai (202351079)"
                ]),
                ("Open for Q&A", [
                    "Thank you, Professor! We welcome your questions."
                ])
            ],
            "transcript": (
                "To conclude, our team built a working distributed cache cluster from first principles. "
                "We proved that you can achieve high availability, automatic crash recovery, and dynamic autoscaling without relying on heavy third-party tools.\n\n"
                "On behalf of Zeel, Praval, Sneh, and myself, thank you very much for your time and guidance, Professor. "
                "We are now happy to answer your questions!"
            )
        }
    ]

    for idx, slide_info in enumerate(slides_data):
        slide = prs.slides.add_slide(blank_slide_layout)
        
        # Background
        bg = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, 0, 0, Inches(13.333), Inches(7.5))
        bg.fill.solid()
        bg.fill.fore_color.rgb = BG_COLOR
        bg.line.color.rgb = BG_COLOR

        # Slide Number Badge
        slide_num_box = slide.shapes.add_textbox(Inches(11.8), Inches(0.4), Inches(1.1), Inches(0.4))
        tf_num = slide_num_box.text_frame
        tf_num.word_wrap = True
        p_num = tf_num.paragraphs[0]
        p_num.text = f"{idx + 1} / {len(slides_data)}"
        p_num.font.name = "Arial"
        p_num.font.size = Pt(12)
        p_num.font.bold = True
        p_num.font.color.rgb = TEXT_MUTED
        p_num.alignment = PP_ALIGN.RIGHT

        if slide_info["is_title"]:
            tag_box = slide.shapes.add_textbox(Inches(1.0), Inches(0.8), Inches(11.3), Inches(0.5))
            p_tag = tag_box.text_frame.paragraphs[0]
            p_tag.text = "DISTRIBUTED SYSTEMS PROJECT PRESENTATION"
            p_tag.font.name = "Arial"
            p_tag.font.size = Pt(14)
            p_tag.font.bold = True
            p_tag.font.color.rgb = PRIMARY

            title_box = slide.shapes.add_textbox(Inches(1.0), Inches(1.4), Inches(11.3), Inches(1.5))
            tf_title = title_box.text_frame
            tf_title.word_wrap = True
            p_t = tf_title.paragraphs[0]
            p_t.text = slide_info["title"]
            p_t.font.name = "Arial"
            p_t.font.size = Pt(36)
            p_t.font.bold = True
            p_t.font.color.rgb = TEXT_WHITE

            sub_box = slide.shapes.add_textbox(Inches(1.0), Inches(2.8), Inches(11.3), Inches(0.8))
            p_s = sub_box.text_frame.paragraphs[0]
            p_s.text = slide_info["subtitle"]
            p_s.font.name = "Arial"
            p_s.font.size = Pt(18)
            p_s.font.color.rgb = SECONDARY

            card = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(1.0), Inches(3.8), Inches(11.333), Inches(3.0))
            card.fill.solid()
            card.fill.fore_color.rgb = CARD_BG
            card.line.color.rgb = CARD_BORDER
            card.line.width = Pt(1.5)

            card_tx = slide.shapes.add_textbox(Inches(1.3), Inches(4.0), Inches(10.7), Inches(2.6))
            tf_card = card_tx.text_frame
            tf_card.word_wrap = True
            
            p_c_title = tf_card.paragraphs[0]
            p_c_title.text = "TEAM MEMBERS & PRESENTATION ORDER"
            p_c_title.font.name = "Arial"
            p_c_title.font.size = Pt(14)
            p_c_title.font.bold = True
            p_c_title.font.color.rgb = PRIMARY
            p_c_title.space_after = Pt(12)

            team_members = [
                ("1. Moradiya Zeel Hareshbhai", "202351085", "Speaker 1: Project Lead & Architecture", "(Slides 1-4)"),
                ("2. Praval Hitesh Parikh", "202351110", "Speaker 2: Storage & Distributed Data Lead", "(Slides 5-7)"),
                ("3. Gondaliya Sneh Vipulkumar", "202351174", "Speaker 3: Consensus & Autoscaling Lead", "(Slides 8-10)"),
                ("4. Mangukiya Om Harjibhai", "202351079", "Speaker 4: Rebalancing & Live Demo Lead", "(Slides 11-16)")
            ]

            for name, student_id, role, slides in team_members:
                p_mem = tf_card.add_paragraph()
                p_mem.text = f"•  {name} ({student_id})  —  {role}  {slides}"
                p_mem.font.name = "Arial"
                p_mem.font.size = Pt(14)
                p_mem.font.color.rgb = TEXT_WHITE
                p_mem.space_after = Pt(6)

        else:
            pres_badge = slide.shapes.add_textbox(Inches(0.8), Inches(0.4), Inches(9.5), Inches(0.4))
            p_badge = pres_badge.text_frame.paragraphs[0]
            p_badge.text = f"PRESENTER: {slide_info['speaker_name']} ({slide_info['speaker_id']})  |  {slide_info['speaker_role']}"
            p_badge.font.name = "Arial"
            p_badge.font.size = Pt(11)
            p_badge.font.bold = True
            p_badge.font.color.rgb = PRIMARY

            t_box = slide.shapes.add_textbox(Inches(0.8), Inches(0.8), Inches(11.5), Inches(0.8))
            tf_t = t_box.text_frame
            tf_t.word_wrap = True
            p_t = tf_t.paragraphs[0]
            p_t.text = slide_info["title"]
            p_t.font.name = "Arial"
            p_t.font.size = Pt(26)
            p_t.font.bold = True
            p_t.font.color.rgb = TEXT_WHITE

            s_box = slide.shapes.add_textbox(Inches(0.8), Inches(1.5), Inches(11.5), Inches(0.4))
            p_s = s_box.text_frame.paragraphs[0]
            p_s.text = slide_info["subtitle"]
            p_s.font.name = "Arial"
            p_s.font.size = Pt(14)
            p_s.font.color.rgb = SECONDARY

            num_sections = len(slide_info["bullet_sections"])
            if num_sections == 3:
                card_w = Inches(3.64)
                card_gap = Inches(0.3)
                start_x = Inches(0.8)
                card_y = Inches(2.2)
                card_h = Inches(4.7)

                for s_i, (sec_title, bullets) in enumerate(slide_info["bullet_sections"]):
                    cx = start_x + s_i * (card_w + card_gap)
                    c_shape = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, cx, card_y, card_w, card_h)
                    c_shape.fill.solid()
                    c_shape.fill.fore_color.rgb = CARD_BG
                    c_shape.line.color.rgb = CARD_BORDER
                    c_shape.line.width = Pt(1.5)

                    c_text = slide.shapes.add_textbox(cx + Inches(0.2), card_y + Inches(0.2), card_w - Inches(0.4), card_h - Inches(0.4))
                    tf = c_text.text_frame
                    tf.word_wrap = True

                    p_header = tf.paragraphs[0]
                    p_header.text = sec_title
                    p_header.font.name = "Arial"
                    p_header.font.size = Pt(14)
                    p_header.font.bold = True
                    p_header.font.color.rgb = ACCENT_GREEN if s_i == 0 else (PRIMARY if s_i == 1 else ACCENT_AMBER)
                    p_header.space_after = Pt(12)

                    for b in bullets:
                        p_b = tf.add_paragraph()
                        p_b.text = f"• {b}"
                        p_b.font.name = "Arial"
                        p_b.font.size = Pt(12)
                        p_b.font.color.rgb = TEXT_WHITE
                        p_b.space_after = Pt(8)

            elif num_sections in [2, 4]:
                card_w = Inches(5.6)
                card_gap = Inches(0.4)
                start_x = Inches(0.8)
                card_y = Inches(2.2)
                card_h = Inches(4.7)

                if num_sections == 2:
                    for s_i, (sec_title, bullets) in enumerate(slide_info["bullet_sections"]):
                        cx = start_x + s_i * (card_w + card_gap)
                        c_shape = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, cx, card_y, card_w, card_h)
                        c_shape.fill.solid()
                        c_shape.fill.fore_color.rgb = CARD_BG
                        c_shape.line.color.rgb = CARD_BORDER
                        c_shape.line.width = Pt(1.5)

                        c_text = slide.shapes.add_textbox(cx + Inches(0.25), card_y + Inches(0.25), card_w - Inches(0.5), card_h - Inches(0.5))
                        tf = c_text.text_frame
                        tf.word_wrap = True

                        p_header = tf.paragraphs[0]
                        p_header.text = sec_title
                        p_header.font.name = "Arial"
                        p_header.font.size = Pt(15)
                        p_header.font.bold = True
                        p_header.font.color.rgb = PRIMARY if s_i == 0 else ACCENT_GREEN
                        p_header.space_after = Pt(14)

                        for b in bullets:
                            p_b = tf.add_paragraph()
                            p_b.text = f"• {b}"
                            p_b.font.name = "Arial"
                            p_b.font.size = Pt(13)
                            p_b.font.color.rgb = TEXT_WHITE
                            p_b.space_after = Pt(10)
                else:
                    g_w = Inches(5.6)
                    g_h = Inches(2.2)
                    for s_i, (sec_title, bullets) in enumerate(slide_info["bullet_sections"]):
                        row = s_i // 2
                        col = s_i % 2
                        cx = start_x + col * (g_w + Inches(0.4))
                        cy = card_y + row * (g_h + Inches(0.3))

                        c_shape = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, cx, cy, g_w, g_h)
                        c_shape.fill.solid()
                        c_shape.fill.fore_color.rgb = CARD_BG
                        c_shape.line.color.rgb = CARD_BORDER
                        c_shape.line.width = Pt(1.5)

                        c_text = slide.shapes.add_textbox(cx + Inches(0.2), cy + Inches(0.15), g_w - Inches(0.4), g_h - Inches(0.3))
                        tf = c_text.text_frame
                        tf.word_wrap = True

                        p_header = tf.paragraphs[0]
                        p_header.text = sec_title
                        p_header.font.name = "Arial"
                        p_header.font.size = Pt(13)
                        p_header.font.bold = True
                        p_header.font.color.rgb = PRIMARY if s_i == 0 else (ACCENT_GREEN if s_i == 1 else (ACCENT_AMBER if s_i == 2 else SECONDARY))
                        p_header.space_after = Pt(6)

                        for b in bullets:
                            p_b = tf.add_paragraph()
                            p_b.text = f"• {b}"
                            p_b.font.name = "Arial"
                            p_b.font.size = Pt(11)
                            p_b.font.color.rgb = TEXT_WHITE
                            p_b.space_after = Pt(4)
            else:
                c_shape = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(0.8), Inches(2.2), Inches(11.6), Inches(4.7))
                c_shape.fill.solid()
                c_shape.fill.fore_color.rgb = CARD_BG
                c_shape.line.color.rgb = CARD_BORDER

                c_text = slide.shapes.add_textbox(Inches(1.1), Inches(2.4), Inches(11.0), Inches(4.3))
                tf = c_text.text_frame
                tf.word_wrap = True
                first = True
                for sec_title, bullets in slide_info["bullet_sections"]:
                    if first:
                        p_h = tf.paragraphs[0]
                        first = False
                    else:
                        p_h = tf.add_paragraph()
                    p_h.text = sec_title
                    p_h.font.name = "Arial"
                    p_h.font.size = Pt(15)
                    p_h.font.bold = True
                    p_h.font.color.rgb = PRIMARY
                    p_h.space_after = Pt(8)

                    for b in bullets:
                        p_b = tf.add_paragraph()
                        p_b.text = f"• {b}"
                        p_b.font.name = "Arial"
                        p_b.font.size = Pt(13)
                        p_b.font.color.rgb = TEXT_WHITE
                        p_b.space_after = Pt(6)

        # Embedded Speaker Notes for Presenter View
        notes_slide = slide.notes_slide
        tf_notes = notes_slide.notes_text_frame
        tf_notes.text = f"=== SPEAKER TRANSCRIPT (Presenter: {slide_info['speaker_name']} - {slide_info['speaker_id']}) ===\n\n{slide_info['transcript']}"

    output_path = r"c:\Projects\Self - Healing Redis\Self_Healing_Distributed_Cache_Presentation_Updated.pptx"
    prs.save(output_path)
    print(f"Presentation saved successfully to: {output_path}")

    # Also attempt to overwrite the original if not locked
    original_path = r"c:\Projects\Self - Healing Redis\Self_Healing_Distributed_Cache_Presentation.pptx"
    try:
        prs.save(original_path)
        print(f"Also successfully updated original file: {original_path}")
    except Exception as e:
        print(f"Note: Could not overwrite original '{original_path}' because it is currently open in PowerPoint: {e}")


if __name__ == "__main__":
    create_deck()
