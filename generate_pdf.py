import os
from reportlab.lib.pagesizes import letter
from reportlab.lib import colors
from reportlab.lib.units import inch
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak, KeepTogether, HRFlowable
)
from reportlab.pdfgen import canvas

class NumberedCanvas(canvas.Canvas):
    def __init__(self, *args, **kwargs):
        super(NumberedCanvas, self).__init__(*args, **kwargs)
        self._saved_page_states = []

    def showPage(self):
        self._saved_page_states.append(dict(self.__dict__))
        self._startPage()

    def save(self):
        num_pages = len(self._saved_page_states)
        for state in self._saved_page_states:
            self.__dict__.update(state)
            self.draw_page_decorations(num_pages)
            super(NumberedCanvas, self).showPage()
        super(NumberedCanvas, self).save()

    def draw_page_decorations(self, page_count):
        if self._pageNumber == 1:
            return
        self.saveState()
        self.setFont("Helvetica-Bold", 8)
        self.setFillColor(colors.HexColor("#64748B"))
        
        # Header
        self.drawString(54, 750, "Self-Healing Distributed Cache — 4-Person Presentation Guide (Simple English)")
        self.setStrokeColor(colors.HexColor("#CBD5E1"))
        self.setLineWidth(0.5)
        self.line(54, 744, 558, 744)
        
        # Footer
        self.line(54, 48, 558, 48)
        self.setFont("Helvetica", 8)
        self.drawString(54, 36, "Academic Project Defense — Speaking Transcripts")
        self.drawRightString(558, 36, f"Page {self._pageNumber} of {page_count}")
        self.restoreState()

def build_pdf():
    pdf_filename = r"c:\Projects\Self - Healing Redis\Team_Presentation_Transcripts_and_Defense_Guide.pdf"
    
    doc = SimpleDocTemplate(
        pdf_filename,
        pagesize=letter,
        leftMargin=54,
        rightMargin=54,
        topMargin=54,
        bottomMargin=54
    )

    styles = getSampleStyleSheet()

    title_style = ParagraphStyle(
        'CoverTitle',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=24,
        leading=28,
        textColor=colors.HexColor("#0F172A"),
        spaceAfter=10
    )

    subtitle_style = ParagraphStyle(
        'CoverSubtitle',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=12,
        leading=16,
        textColor=colors.HexColor("#475569"),
        spaceAfter=20
    )

    h1_style = ParagraphStyle(
        'Heading1_Custom',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=15,
        leading=19,
        textColor=colors.HexColor("#1E3A8A"),
        spaceBefore=14,
        spaceAfter=6,
        keepWithNext=True
    )

    h2_style = ParagraphStyle(
        'Heading2_Custom',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=11.5,
        leading=15,
        textColor=colors.HexColor("#0284C7"),
        spaceBefore=10,
        spaceAfter=4,
        keepWithNext=True
    )

    body_style = ParagraphStyle(
        'Body_Custom',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=9.5,
        leading=14,
        textColor=colors.HexColor("#1E293B"),
        spaceAfter=6
    )

    script_style = ParagraphStyle(
        'Script_Custom',
        parent=styles['Normal'],
        fontName='Helvetica-Oblique',
        fontSize=9.5,
        leading=14.5,
        textColor=colors.HexColor("#0F172A"),
        spaceBefore=4,
        spaceAfter=8
    )

    qa_q_style = ParagraphStyle(
        'QA_Q',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=9.5,
        leading=14,
        textColor=colors.HexColor("#B91C1C"),
        spaceBefore=6,
        spaceAfter=2,
        keepWithNext=True
    )

    qa_a_style = ParagraphStyle(
        'QA_A',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=9,
        leading=13.5,
        textColor=colors.HexColor("#334155"),
        spaceAfter=8
    )

    story = []

    # ==================== COVER PAGE ====================
    story.append(Spacer(1, 20))
    story.append(Paragraph("ACADEMIC DEFENSE & SPEAKING SCRIPT (SIMPLE ENGLISH)", ParagraphStyle('Badge', fontName='Helvetica-Bold', fontSize=10, leading=12, textColor=colors.HexColor("#0284C7"))))
    story.append(Spacer(1, 6))
    story.append(Paragraph("Self-Healing Distributed Key-Value Cache Cluster", title_style))
    story.append(Paragraph("A Masterless, Resilient In-Memory Cache Built from Scratch in TypeScript and Node.js", subtitle_style))
    story.append(HRFlowable(width="100%", thickness=2, color=colors.HexColor("#0284C7"), spaceAfter=16))

    # Team Roster Table with new order
    team_data = [
        [Paragraph("<b>Speaker Order & Name</b>", body_style), Paragraph("<b>Student ID</b>", body_style), Paragraph("<b>Assigned Role</b>", body_style), Paragraph("<b>Slides</b>", body_style)],
        [Paragraph("<b>1. Moradiya Zeel Hareshbhai</b>", body_style), Paragraph("202351085", body_style), Paragraph("Speaker 1: Project Lead & Architecture", body_style), Paragraph("Slides 1 – 4", body_style)],
        [Paragraph("<b>2. Praval Hitesh Parikh</b>", body_style), Paragraph("202351110", body_style), Paragraph("Speaker 2: Storage & Distributed Data Lead", body_style), Paragraph("Slides 5 – 7", body_style)],
        [Paragraph("<b>3. Gondaliya Sneh Vipulkumar</b>", body_style), Paragraph("202351174", body_style), Paragraph("Speaker 3: Consensus & Autoscaling Lead", body_style), Paragraph("Slides 8 – 10", body_style)],
        [Paragraph("<b>4. Mangukiya Om Harjibhai</b>", body_style), Paragraph("202351079", body_style), Paragraph("Speaker 4: Rebalancing & Live Demo Lead", body_style), Paragraph("Slides 11 – 16", body_style)],
    ]

    t_roster = Table(team_data, colWidths=[170, 70, 190, 70])
    t_roster.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,0), colors.HexColor("#F1F5F9")),
        ('GRID', (0,0), (-1,-1), 0.5, colors.HexColor("#CBD5E1")),
        ('TOPPADDING', (0,0), (-1,-1), 6),
        ('BOTTOMPADDING', (0,0), (-1,-1), 6),
        ('LEFTPADDING', (0,0), (-1,-1), 8),
        ('RIGHTPADDING', (0,0), (-1,-1), 8),
    ]))
    story.append(t_roster)
    story.append(Spacer(1, 20))

    summary_box_data = [
        [Paragraph("<b>Key Information for the Team:</b><br/>"
                   "• <b>Language Style:</b> Transcripts are written in very simple, clear English so you can speak naturally without memorizing complex academic words.<br/>"
                   "• <b>Presenter Order:</b> Zeel (Slides 1-4) &rarr; Praval (Slides 5-7) &rarr; Sneh (Slides 8-10) &rarr; Om (Slides 11-16 + Demo).<br/>"
                   "• <b>PowerPoint Presenter View:</b> The exact speaking scripts are also saved directly in the Notes section of <b>Self_Healing_Distributed_Cache_Presentation_Updated.pptx</b>.<br/>"
                   "• <b>Verbal Transitions:</b> At the end of your section, use the simple transition line to introduce your teammate.", body_style)]
    ]
    t_sum = Table(summary_box_data, colWidths=[500])
    t_sum.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,-1), colors.HexColor("#EFF6FF")),
        ('BOX', (0,0), (-1,-1), 1, colors.HexColor("#3B82F6")),
        ('TOPPADDING', (0,0), (-1,-1), 10),
        ('BOTTOMPADDING', (0,0), (-1,-1), 10),
        ('LEFTPADDING', (0,0), (-1,-1), 12),
        ('RIGHTPADDING', (0,0), (-1,-1), 12),
    ]))
    story.append(t_sum)

    story.append(PageBreak())

    # ==================== SPEAKER 1: ZEEL ====================
    story.append(Paragraph("SPEAKER 1: Moradiya Zeel Hareshbhai (202351085)", h1_style))
    story.append(Paragraph("Role: Project Lead & Architecture | Slides Owned: 1, 2, 3, 4", subtitle_style))
    story.append(HRFlowable(width="100%", thickness=1, color=colors.HexColor("#CBD5E1"), spaceAfter=10))

    story.append(Paragraph("Slide 1: Title & Welcome", h2_style))
    story.append(Paragraph(
        "\"Good morning, Professor and everyone. Today, our team is presenting our project: "
        "a <b>Self-Healing Distributed Key-Value Cache Cluster</b>. We built this project from scratch using TypeScript and Node.js.<br/><br/>"
        "In simple words, it works like a resilient Redis cluster. It spreads data across multiple servers, "
        "makes sure data is never lost if a server crashes, and automatically adds new servers when the load increases.<br/><br/>"
        "Here is our team order for today's presentation:<br/>"
        "1. I am Moradiya Zeel, and I will explain the problem, our architecture, and why we chose this tech stack.<br/>"
        "2. Next, Praval will explain how data is stored, consistent hashing, and how read and write operations work.<br/>"
        "3. Then, Sneh will explain how nodes check each other using gossip, how self-healing works, and our autoscaling rules.<br/>"
        "4. Finally, Om will explain data rebalancing, give a live demo on our dashboard, and conclude our presentation.<br/><br/>"
        "Let us start with the core problem we are solving.\"",
        script_style
    ))

    story.append(Paragraph("Slide 2: The Core Problem & Why We Need Distributed Caches", h2_style))
    story.append(Paragraph(
        "\"Let us understand why we need this project. In any busy application like Amazon or Instagram, the database is the slowest part. "
        "To make things fast, developers place a cache — like Redis — in front of the database to store frequent data in RAM.<br/><br/>"
        "But using just one cache server creates three big problems:<br/>"
        "First, <b>Single Point of Failure</b>. If that one cache server crashes, thousands of queries hit the database at the exact same second. "
        "This is called a <i>cache stampede</i>, and it can crash the whole database.<br/>"
        "Second, <b>Memory Limit</b>. One computer only has so much RAM. When your website grows, one machine is not enough.<br/>"
        "Third, <b>No Auto-Recovery</b>. When a server fails, developers have to manually fix it.<br/><br/>"
        "Our project solves this by splitting data across multiple nodes, replicating every piece of data, and automatically fixing issues when servers fail.\"",
        script_style
    ))

    story.append(Paragraph("Slide 3: High-Level System Architecture", h2_style))
    story.append(Paragraph(
        "\"On Slide 3, you can see how our system is organized. We use a masterless peer-to-peer design, inspired by Amazon Dynamo.<br/><br/>"
        "In traditional systems, you have one master node and multiple worker nodes. But if the master node dies, the whole system stops working. "
        "In our cluster, every node is equal. There is no single master.<br/><br/>"
        "The system has two main parts:<br/>"
        "1. The <b>Client Proxy Gateway</b> running on port 8000. When a client wants to read or write a key, it sends a simple HTTP request to the proxy. "
        "The proxy checks the hash ring, finds which nodes are responsible, and forwards the request. If the primary node is dead, the proxy automatically retries on the backup replica.<br/>"
        "2. The <b>Cache Nodes</b> running on ports 8001, 8002, 8003, and so on. They store the data, talk to each other to check health, and move data when needed.\"",
        script_style
    ))

    story.append(Paragraph("Slide 4: Tech Stack & Engineering Choices", h2_style))
    story.append(Paragraph(
        "\"On Slide 4, here is why we picked this tech stack:<br/><br/>"
        "We chose <b>Node.js</b> because a distributed cache spends most of its time waiting for network calls — nodes pinging each other, sending keys, and responding to clients. "
        "Node.js handles this non-blocking I/O very well without needing complex multi-threading.<br/><br/>"
        "We used <b>TypeScript</b> because in distributed systems, nodes send data packets across the network. "
        "TypeScript gives us strict types, so if any node sends the wrong data format, the compiler catches it right away.<br/><br/>"
        "<b>Express</b> gives us clean REST APIs, and <b>WebSockets</b> let us stream live metrics to our dashboard in real time.<br/><br/>"
        "Most importantly, we did not use any ready-made tools like ZooKeeper or an external database. We wrote the storage, the hashing ring, and the gossip protocol completely ourselves.<br/><br/>"
        "<i>[Handoff]:</i> Now, I will pass the microphone to Praval, who will explain how our storage engine and consistent hashing work.\"",
        script_style
    ))

    story.append(Spacer(1, 6))
    story.append(Paragraph("Simple Q&A Prep for Moradiya Zeel Hareshbhai:", h2_style))
    story.append(Paragraph("Q: 'Why did you use a Client Proxy instead of smart clients like Redis Cluster?'", qa_q_style))
    story.append(Paragraph("<b>Simple Answer:</b> \"In Redis Cluster, clients must be 'smart clients' that know about every node. If they ask the wrong node, they get an error and have to retry themselves. We used a Client Proxy because it makes things much simpler: any normal website or app can talk to port 8000 using standard HTTP without needing special client libraries, and the proxy handles retrying backups automatically.\"", qa_a_style))

    story.append(Paragraph("Q: 'Isn't the Client Proxy a Single Point of Failure?'", qa_q_style))
    story.append(Paragraph("<b>Simple Answer:</b> \"For our project demo, we run one proxy. But in a real company, the proxy is completely stateless — it does not save any keys in its own memory. That means you can easily run 3 or 4 proxies behind a standard cloud load balancer like AWS, so there is no single point of failure.\"", qa_a_style))

    story.append(PageBreak())

    # ==================== SPEAKER 2: PRAVAL ====================
    story.append(Paragraph("SPEAKER 2: Praval Hitesh Parikh (202351110)", h1_style))
    story.append(Paragraph("Role: Storage & Distributed Data Lead | Slides Owned: 5, 6, 7", subtitle_style))
    story.append(HRFlowable(width="100%", thickness=1, color=colors.HexColor("#CBD5E1"), spaceAfter=10))

    story.append(Paragraph("Slide 5: The In-Memory Storage Engine", h2_style))
    story.append(Paragraph(
        "\"Thank you, Zeel. Hello everyone, I am Praval. On Slide 5, let us look inside a single cache node.<br/><br/>"
        "Each node stores its data in memory using a fast Map. For every key, we save four things:<br/>"
        "1. The value itself.<br/>"
        "2. An expiry time, which is the TTL.<br/>"
        "3. A write timestamp, so we know when it was saved.<br/>"
        "4. A version number.<br/><br/>"
        "To clean up expired keys without slowing down the server, we use two methods:<br/>"
        "First is <b>Passive cleanup</b>. When someone asks to read a key, we check if it is expired. If it is, we delete it immediately.<br/>"
        "Second is <b>Active cleanup</b>. Every second, a background worker scans keys and removes expired ones that nobody is reading.<br/><br/>"
        "And if a node reaches its memory limit, it protects itself using either <b>LRU</b> — deleting the oldest unused keys — or <b>LFU</b> — deleting the least popular keys.\"",
        script_style
    ))

    story.append(Paragraph("Slide 6: Consistent Hashing & Virtual Nodes", h2_style))
    story.append(Paragraph(
        "\"On Slide 6, we discuss Consistent Hashing. This is the heart of how data is distributed.<br/><br/>"
        "In simple hashing, you take <i>hash(key) % N</i>, where N is the number of servers. But if one server crashes, N changes from 3 to 2. "
        "Suddenly, almost every key hashes to a different machine! Your entire cache becomes empty and useless.<br/><br/>"
        "Consistent hashing fixes this. Imagine a giant clock or circle numbered from 0 to 4 billion. "
        "We hash each node and place it on the circle. When a key arrives, we hash it to a number on the circle and walk clockwise until we hit a node. That node owns the key.<br/><br/>"
        "Now, what happens if two nodes land close together? One node would get too many keys — this is called a <b>hotspot</b>. "
        "To prevent this, we give each physical server <b>40 virtual nodes</b> scattered all around the circle. "
        "Because of these 40 virtual nodes, keys spread out very evenly across all servers, with less than 5% difference between nodes.\"",
        script_style
    ))

    story.append(Paragraph("Slide 7: How Reads & Writes Work (Quorum Consensus)", h2_style))
    story.append(Paragraph(
        "\"On Slide 7, let us see how writing and reading works.<br/><br/>"
        "We use a replication factor of 2. That means every key is written to 2 nodes: the primary node and the next clockwise node as a replica.<br/><br/>"
        "When a client saves data, they can pick how strict they want the confirmation to be:<br/>"
        "- <b>Consistency ONE:</b> Very fast. As soon as one node saves it, we return success.<br/>"
        "- <b>Consistency QUORUM:</b> This is the default. It requires a majority of replicas to confirm the write before telling the client OK.<br/>"
        "- <b>Consistency ALL:</b> Requires all replicas to confirm.<br/><br/>"
        "If two writes happen at the same time, we use <b>Last-Write-Wins</b>. We compare the timestamps on both nodes, and the latest write wins.<br/><br/>"
        "<i>[Handoff]:</i> Now, how do nodes talk to each other and detect when a server crashes? "
        "I will hand over to Sneh to explain our Gossip Protocol, self-healing, and autoscaling.\"",
        script_style
    ))

    story.append(Spacer(1, 6))
    story.append(Paragraph("Simple Q&A Prep for Praval Hitesh Parikh:", h2_style))
    story.append(Paragraph("Q: 'Why 40 virtual nodes? What happens if you only use 1?'", qa_q_style))
    story.append(Paragraph("<b>Simple Answer:</b> \"If you use only 1 point per node on the circle, random chance makes points land unevenly. In our test, one server got 60% of keys and another got only 10%. By giving each server 40 virtual points spread around the circle, the keys distribute almost perfectly evenly with under 5% difference.\"", qa_a_style))

    story.append(Paragraph("Q: 'What happens if a node crashes during a write?'", qa_q_style))
    story.append(Paragraph("<b>Simple Answer:</b> \"If the primary node is dead when writing, the proxy automatically moves clockwise to the replica node and completes the write. The user still gets a success response.\"", qa_a_style))

    story.append(PageBreak())

    # ==================== SPEAKER 3: SNEH ====================
    story.append(Paragraph("SPEAKER 3: Gondaliya Sneh Vipulkumar (202351174)", h1_style))
    story.append(Paragraph("Role: Consensus & Autoscaling Lead | Slides Owned: 8, 9, 10", subtitle_style))
    story.append(HRFlowable(width="100%", thickness=1, color=colors.HexColor("#CBD5E1"), spaceAfter=10))

    story.append(Paragraph("Slide 8: Gossip Protocol & Failure Detection", h2_style))
    story.append(Paragraph(
        "\"Thank you, Praval. Hello Professor and friends, I am Sneh. On Slide 8, let us look at how nodes monitor each other.<br/><br/>"
        "Instead of having a central boss server that checks everyone, our nodes use a <b>Gossip Protocol</b> inspired by the SWIM protocol.<br/>"
        "Every second, each node picks a random peer and sends its status. It works just like spreading a rumor — within a few seconds, "
        "every node knows the health of every other node in the cluster.<br/><br/>"
        "A big problem in distributed systems is false alarms. If a network packet gets delayed for half a second, you should not assume the server is dead.<br/>"
        "So we built a three-step state machine:<br/>"
        "1. If a ping fails, the node goes from ALIVE to <b>SUSPECT</b>. It gets a 10-second grace period.<br/>"
        "2. If the suspected node is actually alive, it hears about the suspicion through gossip and refutes it by saying 'I am alive!'<br/>"
        "3. Only if 10 full seconds pass with no answer does the cluster mark it <b>DEAD</b> and remove it from the ring.\"",
        script_style
    ))

    story.append(Paragraph("Slide 9: Self-Healing: Failover & Read-Repair", h2_style))
    story.append(Paragraph(
        "\"On Slide 9, we show how our cluster heals itself in two important ways:<br/><br/>"
        "First, <b>Failover Routing</b>. If a primary server crashes right when a user requests data, the proxy gateway catches the failure and immediately routes the request to the backup replica. "
        "The user never sees an error screen — they get their data with zero interruption.<br/><br/>"
        "Second, <b>Read-Repair</b>. Imagine Node B was offline for 10 seconds while a key was updated on Node A. Node B now has old data. "
        "When a client performs a QUORUM read, our coordinator compares the timestamps on both nodes. It hands the newest value to the client immediately. "
        "Then, in the background, it sends the fresh data to Node B to heal it. Over time, all data inconsistencies fix themselves without slowing down users.<br/><br/>"
        "Now, what happens if our website gets a sudden surge of traffic? Let us look at autoscaling.\"",
        script_style
    ))

    story.append(Paragraph("Slide 10: Dynamic Autoscaling Engine", h2_style))
    story.append(Paragraph(
        "\"Slide 10 explains our <b>Dynamic Autoscaling Engine</b>. Every 5 seconds, the proxy gateway monitors the cluster health.<br/><br/>"
        "It triggers a Scale-Up if any of these things happen:<br/>"
        "1. <b>Key Skew:</b> If one node holds more than 120% of the average keys in the cluster. This means keys are getting unbalanced.<br/>"
        "2. <b>High Traffic:</b> If requests per second exceed 5,000.<br/>"
        "3. <b>High CPU or Memory:</b> If CPU passes 75% or memory passes 80%.<br/><br/>"
        "When triggered, the proxy automatically starts a new cache node on the next port — like 8004 — gives it 40 virtual nodes, and adds it to the hash ring.<br/><br/>"
        "And when traffic drops, the autoscaler cleanly scales down to save resources, but it always protects our 3 baseline seed nodes.<br/><br/>"
        "<i>[Handoff]:</i> Now, I hand over to Om, who will show how data moves to the new node, run our live demo, and conclude our presentation.\"",
        script_style
    ))

    story.append(Spacer(1, 6))
    story.append(Paragraph("Simple Q&A Prep for Gondaliya Sneh Vipulkumar:", h2_style))
    story.append(Paragraph("Q: 'Why do you check Key Skew for autoscaling instead of just CPU?'", qa_q_style))
    story.append(Paragraph("<b>Simple Answer:</b> \"Because in a cache, you can have a situation where CPU is low, but one server has way too many keys while others are almost empty. If you wait for CPU to reach 80%, the server might run out of memory or crash. By checking if any node has over 120% of average keys, we catch data imbalances early and scale up proactively.\"", qa_a_style))

    story.append(Paragraph("Q: 'What is Read-Repair and why does it run in the background?'", qa_q_style))
    story.append(Paragraph("<b>Simple Answer:</b> \"When a client reads data, we compare the versions on the replicas. If one replica is outdated, we give the user the fresh data right away so they don't wait. Then we update the outdated replica in the background so the user gets zero lag.\"", qa_a_style))

    story.append(PageBreak())

    # ==================== SPEAKER 4: OM ====================
    story.append(Paragraph("SPEAKER 4: Mangukiya Om Harjibhai (202351079)", h1_style))
    story.append(Paragraph("Role: Rebalancing & Live Demo Lead | Slides Owned: 11, 12, 13, 14, 15, 16", subtitle_style))
    story.append(HRFlowable(width="100%", thickness=1, color=colors.HexColor("#CBD5E1"), spaceAfter=10))

    story.append(Paragraph("Slide 11: Zero-Downtime Data Rebalancing", h2_style))
    story.append(Paragraph(
        "\"Thank you, Sneh. Hello everyone, I am Om. On Slide 11, we explain how data moves when a new node joins.<br/><br/>"
        "When Node 8004 starts, the existing nodes check their stored keys against the new ring. "
        "Any keys that now belong to Node 8004 must be moved.<br/><br/>"
        "If you try to move thousands of keys all at once, you will choke the network and freeze the server. "
        "To prevent this, our rebalancer sends keys in small batches of <b>50 keys</b>, with a <b>50-millisecond rest</b> between batches. "
        "This keeps the server fast and responsive to normal user requests.<br/><br/>"
        "Once the new node confirms it received the batch, the old node deletes its local copy. "
        "Everything happens in the background without dropping a single request.\"",
        script_style
    ))

    story.append(Paragraph("Slide 12: Real-Time Telemetry Dashboard", h2_style))
    story.append(Paragraph(
        "\"Slide 12 shows our live monitoring dashboard. We built this to make distributed system concepts visual and easy to understand.<br/><br/>"
        "- On the left, we have a canvas drawing the <b>Consistent Hash Ring</b>. You can see the nodes and virtual nodes positioned on the circle.<br/>"
        "- In the middle, <b>Node Health Cards</b> show live stats: memory usage, active status, and key counts, updated through WebSockets.<br/>"
        "- On the right, our <b>Operations Console</b> streams live logs showing gossip messages, migrations, and reads/writes.<br/><br/>"
        "Let us now switch to our live demo to see all of this working in real time.\"",
        script_style
    ))

    story.append(Paragraph("Slide 13: Live Demonstration & Chaos Testing (During Demo)", h2_style))
    story.append(Paragraph(
        "<i>(Switching screen to browser and terminal)</i><br/><br/>"
        "\"As you can see on the screen, our cluster is running with 3 nodes on ports 8001, 8002, and 8003. "
        "The dashboard shows all three nodes are ALIVE.<br/><br/>"
        "Now, in the terminal, I will run our stress script: <b>npm run seed:stress</b>. This writes 2,000 keys.<br/>"
        "Notice the dashboard: keys are being stored and replicated. Now watch the terminal logs:<br/>"
        "<code>[Autoscaler] SCALE UP TRIGGERED: Key skew detected!</code><br/><br/>"
        "The proxy immediately spawns Node 8004. Look at the dashboard — a 4th card appears, and the rebalance log shows:<br/>"
        "<code>[Node 8001] Migrating keys to http://localhost:8004...</code><br/>"
        "Within seconds, the keys balance evenly across all 4 servers.<br/><br/>"
        "Now let us simulate a crash. I will click <b>Kill Node</b> on Node 8002.<br/>"
        "Node 8002 turns red. But when we fetch keys from it, the proxy instantly routes to the replica on 8003. "
        "Zero errors, zero lost data.<br/><br/>"
        "Let us switch back to the slides to wrap up.\"",
        script_style
    ))

    story.append(Paragraph("Slide 14: Engineering Challenges We Solved", h2_style))
    story.append(Paragraph(
        "\"On Slide 14, here are the main engineering challenges we faced and solved:<br/><br/>"
        "1. <b>Hotspots:</b> In our first version, one server got way more keys than the others. We fixed this by introducing 40 virtual nodes per server.<br/>"
        "2. <b>False Alarms:</b> Sometimes a tiny network delay made the system think a node died. We added the SUSPECT state and self-refutation to stop false alarms.<br/>"
        "3. <b>Event Loop Freezing:</b> Moving all keys at once slowed down Node.js. We fixed this with batched migrations of 50 keys with small 50ms pauses.<br/>"
        "4. <b>Stale Data:</b> When nodes rejoined, they had old values. We fixed this using Last-Write-Wins timestamps and background Read-Repair.\"",
        script_style
    ))

    story.append(Paragraph("Slide 15: Limitations & What We Would Add Next", h2_style))
    story.append(Paragraph(
        "\"On Slide 15, we look honestly at current limitations and what we would improve next:<br/><br/>"
        "First, <b>Durability</b>. Right now, data is only in RAM. If power goes out completely, data is lost. In the future, we would add a Write-Ahead Log (WAL) on disk so data survives a full restart.<br/>"
        "Second, <b>Process Isolation</b>. Right now, nodes run in one Node.js process for easy testing. In production, each node would run in its own Docker container.<br/>"
        "Third, <b>Vector Clocks</b>. Replacing physical timestamps with vector clocks would solve clock drift issues.<br/>"
        "Fourth, <b>Security</b>. Adding TLS encryption and API keys to protect endpoints.\"",
        script_style
    ))

    story.append(Paragraph("Slide 16: Conclusion & Summary", h2_style))
    story.append(Paragraph(
        "\"To conclude, our team built a working distributed cache cluster from first principles. "
        "We proved that you can achieve high availability, automatic crash recovery, and dynamic autoscaling without relying on heavy third-party tools.<br/><br/>"
        "On behalf of Zeel, Praval, Sneh, and myself, thank you very much for your time and guidance, Professor. "
        "We are now happy to answer your questions!\"",
        script_style
    ))

    story.append(Spacer(1, 6))
    story.append(Paragraph("Simple Q&A Prep for Mangukiya Om Harjibhai:", h2_style))
    story.append(Paragraph("Q: 'Why do you wait 50ms between migration batches?'", qa_q_style))
    story.append(Paragraph("<b>Simple Answer:</b> \"Because Node.js runs on a single thread. If you move 10,000 keys in one big loop, the CPU is completely busy and normal client requests have to wait. By taking a tiny 50ms pause between batches, we let normal user requests go through without any lag.\"", qa_a_style))

    story.append(Paragraph("Q: 'What happens to keys on a node if it is killed suddenly?'", qa_q_style))
    story.append(Paragraph("<b>Simple Answer:</b> \"Because our replication factor is 2, every key was already copied to a backup node at write time. So when a node dies, the backup replica serves the keys. There is zero data loss.\"", qa_a_style))

    # Output path handling
    try:
        doc.build(story, canvasmaker=NumberedCanvas)
        print(f"PDF successfully generated: {pdf_filename}")
    except Exception as e:
        alt_filename = r"c:\Projects\Self - Healing Redis\Team_Presentation_Transcripts_and_Defense_Guide_Updated.pdf"
        doc2 = SimpleDocTemplate(alt_filename, pagesize=letter, leftMargin=54, rightMargin=54, topMargin=54, bottomMargin=54)
        doc2.build(story, canvasmaker=NumberedCanvas)
        print(f"PDF saved to alternate path due to lock: {alt_filename}")

if __name__ == "__main__":
    build_pdf()
