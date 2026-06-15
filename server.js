const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'data', 'db.json');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Helper to read database
function readDB() {
  try {
    const data = fs.readFileSync(DB_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error("Error reading database:", error);
    return { users: [], assets: [], licenses: [], maintenance: [], workflows: [], simulation_logs: [] };
  }
}

// Helper to write database
function writeDB(data) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (error) {
    console.error("Error writing database:", error);
  }
}

// Helper to add simulation log
function addLog(db, type, message) {
  const log = {
    timestamp: new Date().toISOString(),
    type: type,
    message: message
  };
  db.simulation_logs = db.simulation_logs || [];
  db.simulation_logs.unshift(log); // Add to beginning of array
  if (db.simulation_logs.length > 50) {
    db.simulation_logs.pop(); // Keep last 50 logs
  }
}

// API: Get entire database state
app.get('/api/data', (req, res) => {
  res.json(readDB());
});

// API: Get assets
app.get('/api/assets', (req, res) => {
  const db = readDB();
  res.json(db.assets);
});

// API: Register a new physical asset (PostgreSQL RDBMS simulator)
app.post('/api/assets', (req, res) => {
  const { asset_tag, serial, model, type, location } = req.body;

  if (!asset_tag || !serial || !model || !type || !location) {
    return res.status(400).json({ error: "asset_tag, serial, model, type, and location are required." });
  }

  const db = readDB();
  
  // Check duplication
  const duplicate = db.assets.find(a => a.asset_tag === asset_tag || a.serial === serial);
  if (duplicate) {
    return res.status(400).json({ error: "Asset Tag or Serial Number already exists." });
  }

  const newAsset = {
    id: `AST-${1000 + db.assets.length + 1}`,
    asset_tag,
    serial,
    model,
    type,
    status: "Deployable",
    assigned_to: null,
    location,
    sanitization_status: "Verified", // Registered assets default to Verified status
    sanitization_method: "Verified on Registration",
    signature_hash: null,
    date_checked_out: null,
    battery_cycle_count: type === "Laptop" ? Math.floor(10 + Math.random() * 50) : 0,
    cpu_temp: type === "Laptop" ? Math.floor(35 + Math.random() * 15) : 0,
    disk_usage: type === "Laptop" ? Math.floor(10 + Math.random() * 20) : 0,
    last_seen: new Date().toISOString()
  };

  db.assets.push(newAsset);
  addLog(db, "PostgreSQL Store", `Manually registered asset ${asset_tag} (${model}). Written to core Relational tables.`);
  
  writeDB(db);
  res.json({ success: true, asset: newAsset });
});


// API: Get users
app.get('/api/users', (req, res) => {
  const db = readDB();
  res.json(db.users);
});

// API: Get licenses
app.get('/api/licenses', (req, res) => {
  const db = readDB();
  res.json(db.licenses);
});

// API: Get maintenance logs
app.get('/api/maintenance', (req, res) => {
  const db = readDB();
  res.json(db.maintenance);
});

// API: Get workflows
app.get('/api/workflows', (req, res) => {
  const db = readDB();
  res.json(db.workflows);
});

// API: Get finalized disposals
app.get('/api/disposals', (req, res) => {
  const db = readDB();
  res.json(db.disposals || []);
});

// API: Retire an asset (Orphan Prevention Check)
app.post('/api/assets/:id/retire', (req, res) => {
  const { id } = req.params;
  
  const db = readDB();
  const asset = db.assets.find(a => a.id === id);

  if (!asset) {
    return res.status(404).json({ error: "Asset not found." });
  }

  // Enforce Orphan Prevention Business Rule
  if (asset.status === "Assigned" || asset.assigned_to) {
    return res.status(400).json({ error: `Orphan Prevention: Cannot retire asset ${asset.asset_tag} while it is actively assigned to user ${asset.assigned_to}.` });
  }

  asset.status = "Retired";
  asset.sanitization_status = "Pending"; // Set pending for wiping before disposal
  asset.sanitization_method = null;

  addLog(db, "Retirement", `Asset ${asset.asset_tag} (${asset.model}) status changed to RETIRED. Enforcing sanitization before disposal.`);

  writeDB(db);
  res.json({ success: true, asset });
});

// API: Finalize Disposal & Generate Certificate
app.post('/api/assets/:id/dispose', (req, res) => {
  const { id } = req.params;
  const { compliance_officer, signature_data } = req.body;

  if (!compliance_officer || !signature_data) {
    return res.status(400).json({ error: "compliance_officer and signature_data are required." });
  }

  const db = readDB();
  const asset = db.assets.find(a => a.id === id);

  if (!asset) {
    return res.status(404).json({ error: "Asset not found." });
  }

  if (asset.status !== "Retired") {
    return res.status(400).json({ error: "Asset must be retired before it can be finalized for disposal." });
  }

  // Enforce Data Sanitization Compliance Rule
  if (asset.sanitization_status !== "Verified") {
    return res.status(400).json({ error: "Sanitization Compliance: Cannot finalize disposal without a verified data sanitization status." });
  }

  const cleanSignatureData = signature_data.substring(0, 50);
  const hashInput = `${id}-${compliance_officer}-${Date.now()}-${cleanSignatureData}`;
  let mockHash = 0;
  for (let i = 0; i < hashInput.length; i++) {
    mockHash = (mockHash << 5) - mockHash + hashInput.charCodeAt(i);
    mockHash |= 0;
  }
  const signatureHash = `sha256:sig_disp_${Math.abs(mockHash).toString(16).padStart(16, '0')}`;
  
  // Certificate verification hash representation
  const certHash = `sha256:cert_${Math.abs(mockHash * 3).toString(16).padStart(16, '0')}`;

  // Update asset status to Disposed (Archived)
  asset.status = "Disposed";

  const disposalRecord = {
    id: `DISP-${1000 + (db.disposals || []).length + 1}`,
    asset_id: asset.id,
    asset_tag: asset.asset_tag,
    model: asset.model,
    serial: asset.serial,
    type: asset.type,
    sanitize_method: asset.sanitization_method,
    certified_by: compliance_officer,
    disposal_date: new Date().toISOString().split('T')[0],
    signature_hash: signatureHash,
    certificate_hash: certHash
  };

  db.disposals = db.disposals || [];
  db.disposals.push(disposalRecord);

  addLog(db, "Disposal Audit", `FINALIZED DISPOSAL for ${asset.asset_tag}. Audit record created: ${disposalRecord.id}. Cryptographic Cert Hash: ${certHash}`);

  writeDB(db);
  res.json({ success: true, asset, disposalRecord });
});

// API: Check out asset with Digital Signature
app.post('/api/assets/:id/checkout', (req, res) => {
  const { id } = req.params;
  const { user_id, signature_data } = req.body;
  
  if (!user_id || !signature_data) {
    return res.status(400).json({ error: "user_id and signature_data are required." });
  }

  const db = readDB();
  const asset = db.assets.find(a => a.id === id);
  const user = db.users.find(u => u.id === user_id);

  if (!asset) {
    return res.status(404).json({ error: "Asset not found." });
  }
  if (!user) {
    return res.status(404).json({ error: "User not found." });
  }
  if (asset.status === "Assigned") {
    return res.status(400).json({ error: "Asset is already assigned." });
  }

  // Generate simulated digital signature hash
  // Using a mock hashing process
  const cleanSignatureData = signature_data.substring(0, 50); // limit size for message
  const hashInput = `${id}-${user_id}-${Date.now()}-${cleanSignatureData}`;
  // Simple fake hash function since it's just a prototype
  let mockHash = 0;
  for (let i = 0; i < hashInput.length; i++) {
    mockHash = (mockHash << 5) - mockHash + hashInput.charCodeAt(i);
    mockHash |= 0;
  }
  const signatureHash = `sha256:sig_${Math.abs(mockHash).toString(16).padStart(16, '0')}`;

  // Update Asset
  asset.status = "Assigned";
  asset.assigned_to = user_id;
  asset.date_checked_out = new Date().toISOString().split('T')[0];
  asset.signature_hash = signatureHash;
  asset.sanitization_status = "Verified"; // checked out assets are marked verified
  asset.sanitization_method = "N/A - Active Checkout";

  // Log to simulation queue (like a Kafka event)
  addLog(db, "E-Signature", `Asset ${asset.asset_tag} checked out to ${user.name} (${user.id}). Signature verified. Hash: ${signatureHash}`);

  writeDB(db);
  res.json({ success: true, asset, signatureHash });
});

// API: Check in asset
app.post('/api/assets/:id/checkin', (req, res) => {
  const { id } = req.params;
  
  const db = readDB();
  const asset = db.assets.find(a => a.id === id);

  if (!asset) {
    return res.status(404).json({ error: "Asset not found." });
  }
  if (asset.status !== "Assigned") {
    return res.status(400).json({ error: "Asset is not assigned." });
  }

  const prevUserId = asset.assigned_to;
  const user = db.users.find(u => u.id === prevUserId);

  asset.status = "Deployable";
  asset.assigned_to = null;
  asset.date_checked_out = null;
  asset.signature_hash = null;
  asset.sanitization_status = "Pending"; // Needs to be sanitized before next deploy
  asset.sanitization_method = null;

  addLog(db, "Check-in", `Asset ${asset.asset_tag} returned by ${user ? user.name : 'Unknown'}. Sanitization flagged as PENDING.`);

  writeDB(db);
  res.json({ success: true, asset });
});

// API: Sanitize asset (Disposal/Clear checklist)
app.post('/api/assets/:id/sanitize', (req, res) => {
  const { id } = req.params;
  const { method, status } = req.body; // e.g. "NIST 800-88 Clear", "Verified"

  if (!method || !status) {
    return res.status(400).json({ error: "Sanitization method and status are required." });
  }

  const db = readDB();
  const asset = db.assets.find(a => a.id === id);

  if (!asset) {
    return res.status(404).json({ error: "Asset not found." });
  }

  asset.sanitization_status = status;
  asset.sanitization_method = method;

  addLog(db, "Sanitization", `Asset ${asset.asset_tag} sanitized using ${method}. Status: ${status}.`);

  writeDB(db);
  res.json({ success: true, asset });
});

// API: Create new maintenance log (MongoDB document store simulator)
app.post('/api/maintenance', (req, res) => {
  const { asset_tag, issue_type, technician_notes } = req.body;

  if (!asset_tag || !issue_type || !technician_notes) {
    return res.status(400).json({ error: "asset_tag, issue_type, and technician_notes are required." });
  }

  const db = readDB();
  const asset = db.assets.find(a => a.asset_tag === asset_tag);

  const logId = `MNT-${2000 + db.maintenance.length + 1}`;
  const newLog = {
    id: logId,
    asset_tag,
    issue_type,
    status: "Open",
    technician_notes,
    timestamp: new Date().toISOString(),
    resolved_at: null
  };

  db.maintenance.push(newLog);

  if (asset) {
    asset.status = "Under Repair";
    asset.assigned_to = null; // Unassign if sent for repair
    addLog(db, "MongoDB Log Store", `Created maintenance ticket ${logId} for ${asset_tag}. Asset status changed to Under Repair.`);
  } else {
    addLog(db, "MongoDB Log Store", `Created maintenance ticket ${logId} for unregistered asset tag ${asset_tag}.`);
  }

  writeDB(db);
  res.json({ success: true, log: newLog });
});

// API: Resolve maintenance log
app.post('/api/maintenance/:id/resolve', (req, res) => {
  const { id } = req.params;
  const { notes } = req.body;

  const db = readDB();
  const log = db.maintenance.find(l => l.id === id);

  if (!log) {
    return res.status(404).json({ error: "Maintenance log not found." });
  }

  log.status = "Resolved";
  log.resolved_at = new Date().toISOString();
  if (notes) {
    log.technician_notes += ` | Resolution Notes: ${notes}`;
  }

  const asset = db.assets.find(a => a.asset_tag === log.asset_tag);
  if (asset && asset.status === "Under Repair") {
    asset.status = "Deployable";
    asset.sanitization_status = "Verified";
    asset.sanitization_method = "N/A - Standard Repair Complete";
    addLog(db, "MongoDB Log Store", `Resolved ticket ${id}. Asset ${log.asset_tag} is now Deployable.`);
  }

  writeDB(db);
  res.json({ success: true, log });
});

// API: Start Procurement Approval Workflow (Temporal state machine simulator)
app.post('/api/workflows', (req, res) => {
  const { item_name, quantity, cost, requested_by } = req.body;

  if (!item_name || !quantity || !cost || !requested_by) {
    return res.status(400).json({ error: "Missing required procurement fields." });
  }

  const db = readDB();
  const workflowId = `REQ-${10000 + db.workflows.length + 1}`;
  const newWorkflow = {
    id: workflowId,
    item_name,
    quantity: parseInt(quantity),
    cost: parseFloat(cost),
    requested_by,
    current_state: "Manager Approval",
    manager_approved: null,
    date_initiated: new Date().toISOString()
  };

  db.workflows.push(newWorkflow);

  addLog(db, "Temporal Workflow", `Initiated Temporal workflow ${workflowId} for '${item_name}' (Qty: ${quantity}). Current state: Manager Approval`);

  writeDB(db);
  res.json({ success: true, workflow: newWorkflow });
});

// API: Workflow Action (Approve / Transition)
app.post('/api/workflows/:id/approve', (req, res) => {
  const { id } = req.params;
  const { approved } = req.body; // true or false

  const db = readDB();
  const workflow = db.workflows.find(w => w.id === id);

  if (!workflow) {
    return res.status(404).json({ error: "Workflow not found." });
  }

  workflow.manager_approved = approved;
  
  if (approved) {
    workflow.current_state = "Ordered";
    addLog(db, "Temporal Workflow", `Workflow ${id} approved by manager. Transitioning state to ORDERED. Procurement API notified.`);
    
    // Simulate automatic completion of order in background after 5 seconds
    setTimeout(() => {
      const backgroundDb = readDB();
      const bgWorkflow = backgroundDb.workflows.find(w => w.id === id);
      if (bgWorkflow && bgWorkflow.current_state === "Ordered") {
        bgWorkflow.current_state = "Received";
        addLog(backgroundDb, "Procurement API", `Received asset cargo for ${id}. Auto-syncing to Snipe-IT inventory...`);

        // Automatically register assets in database (Snipe-IT)
        const assetCount = bgWorkflow.quantity;
        for (let i = 0; i < assetCount; i++) {
          const newId = `AST-${1000 + backgroundDb.assets.length + 1}`;
          const tagNum = String(100 + backgroundDb.assets.length + 1).padStart(3, '0');
          const newAsset = {
            id: newId,
            asset_tag: `CCT-${bgWorkflow.item_name.substring(0,3).toUpperCase()}-${tagNum}`,
            serial: `SN-INVEN${Math.floor(10000 + Math.random() * 90000)}`,
            model: bgWorkflow.item_name,
            type: bgWorkflow.item_name.toLowerCase().includes('laptop') ? 'Laptop' : 'Accessory',
            status: "Deployable",
            assigned_to: null,
            location: "IT Storage Room",
            sanitization_status: "Verified",
            sanitization_method: "Auto-registered from Procurement Sync",
            signature_hash: null,
            date_checked_out: null,
            battery_cycle_count: 0,
            cpu_temp: 35,
            disk_usage: 0,
            last_seen: new Date().toISOString()
          };
          backgroundDb.assets.push(newAsset);
          addLog(backgroundDb, "Snipe-IT Auto-Intake", `Auto-registered new asset ${newAsset.asset_tag} (${newAsset.model}) into relational inventory.`);
        }

        bgWorkflow.current_state = "Registered";
        addLog(backgroundDb, "Temporal Workflow", `Workflow ${id} finished successfully. All ${assetCount} assets are now in DEPLOYABLE state. State: REGISTERED.`);
        writeDB(backgroundDb);
      }
    }, 5000);
  } else {
    workflow.current_state = "Rejected";
    addLog(db, "Temporal Workflow", `Workflow ${id} rejected by manager. State: REJECTED.`);
  }

  writeDB(db);
  res.json({ success: true, workflow });
});

// SIMULATION API: HRIS Status Change and CDC/Kafka license auto-reclamation
app.post('/api/simulation/hris-sync', (req, res) => {
  const { user_id, new_status } = req.body; // Status: e.g. "Graduated" or "Inactive" / "Terminated"

  if (!user_id || !new_status) {
    return res.status(400).json({ error: "user_id and new_status are required." });
  }

  const db = readDB();
  const user = db.users.find(u => u.id === user_id);

  if (!user) {
    return res.status(404).json({ error: "User not found." });
  }

  const oldStatus = user.status;
  user.status = new_status;

  addLog(db, "CDC - Debezium", `Change Data Capture: postgres.public.users.status updated for user ${user_id} (${oldStatus} -> ${new_status}).`);
  addLog(db, "Kafka Stream", `Published event USER_STATUS_CHANGE (ID: ${user_id}) to topic 'hris-status-updates'`);

  // Auto-Reclamation Logic: Check licenses assigned to this user and unassign them
  let reclaimedCount = 0;
  let licenseDetails = [];

  db.licenses.forEach(lic => {
    if (lic.assigned_users && lic.assigned_users.includes(user_id)) {
      lic.assigned_users = lic.assigned_users.filter(id => id !== user_id);
      lic.seats_assigned = lic.assigned_users.length;
      reclaimedCount++;
      licenseDetails.push(lic.name);
      
      addLog(db, "Auto-Reclamation Engine", `Automated Rule Triggered: Reclaimed license seat for '${lic.name}' from user ${user_id}.`);
    }
  });

  // Also unassign physical assets assigned to the user
  let physicalReclaimedCount = 0;
  db.assets.forEach(asset => {
    if (asset.assigned_to === user_id) {
      asset.status = "Deployable";
      asset.assigned_to = null;
      asset.date_checked_out = null;
      asset.signature_hash = null;
      asset.sanitization_status = "Pending"; // needs sanitization
      asset.sanitization_method = null;
      physicalReclaimedCount++;
      addLog(db, "Auto-Reclamation Engine", `Asset ${asset.asset_tag} unassigned from departed user ${user_id}. Flagged for Sanitization.`);
    }
  });

  if (reclaimedCount > 0 || physicalReclaimedCount > 0) {
    addLog(db, "Kafka Stream", `Finished auto-reclamation process. Total seats reclaimed: ${reclaimedCount} licenses, ${physicalReclaimedCount} hardware assets.`);
  } else {
    addLog(db, "Auto-Reclamation Engine", `No active software licenses or physical assets found for user ${user_id}.`);
  }

  writeDB(db);
  res.json({
    success: true,
    user,
    licensesReclaimed: reclaimedCount,
    reclaimedLicenses: licenseDetails,
    assetsReclaimed: physicalReclaimedCount
  });
});

// SIMULATION API: AI Diagnostics & Predictive Maintenance (AWS SageMaker mockup)
app.post('/api/simulation/predictive-maintenance', (req, res) => {
  const db = readDB();
  addLog(db, "SageMaker ML", "Started batch inference job on device telemetry data...");

  let criticalCount = 0;
  let warningCount = 0;
  const issuesFound = [];

  db.assets.forEach(asset => {
    // Determine risk based on battery cycles or high temperatures
    let riskScore = 0;
    let failureReasons = [];

    // Laptops check
    if (asset.type === "Laptop") {
      if (asset.battery_cycle_count > 500) {
        riskScore += 45;
        failureReasons.push(`High battery cycle count (${asset.battery_cycle_count})`);
      } else if (asset.battery_cycle_count > 400) {
        riskScore += 25;
        failureReasons.push(`Moderate battery cycle count (${asset.battery_cycle_count})`);
      }

      if (asset.cpu_temp > 80) {
        riskScore += 40;
        failureReasons.push(`Extreme thermal throttling (CPU Temp: ${asset.cpu_temp}°C)`);
      } else if (asset.cpu_temp > 70) {
        riskScore += 20;
        failureReasons.push(`Elevated thermal levels (CPU Temp: ${asset.cpu_temp}°C)`);
      }

      if (asset.disk_usage > 90) {
        riskScore += 15;
        failureReasons.push(`Critical disk space depletion (Disk: ${asset.disk_usage}%)`);
      }
    }

    if (riskScore >= 70) {
      criticalCount++;
      issuesFound.push({ asset_tag: asset.asset_tag, score: riskScore, severity: "Critical", reasons: failureReasons });
      
      // Auto-create maintenance log if one doesn't exist
      const existingTicket = db.maintenance.find(m => m.asset_tag === asset.asset_tag && m.status === "Open");
      if (!existingTicket) {
        const logId = `MNT-${2000 + db.maintenance.length + 1}`;
        const newLog = {
          id: logId,
          asset_tag: asset.asset_tag,
          issue_type: "Thermal / Fan",
          status: "Open",
          technician_notes: `AUTOMATED AI ALERT: High Risk Profile Score (${riskScore}%). Triggered by: ${failureReasons.join(', ')}`,
          timestamp: new Date().toISOString(),
          resolved_at: null
        };
        db.maintenance.push(newLog);
        asset.status = "Under Repair";
        asset.assigned_to = null;
        
        addLog(db, "SageMaker ML", `CRITICAL RISK: Asset ${asset.asset_tag} Failure Probability is ${riskScore}%. Auto-created ticket ${logId}.`);
        addLog(db, "Slack Notification", `🚨 [ITAM-ALERT] Asset ${asset.asset_tag} has a ${riskScore}% chance of imminent failure. Auto-ticket created.`);
      }
    } else if (riskScore >= 40) {
      warningCount++;
      issuesFound.push({ asset_tag: asset.asset_tag, score: riskScore, severity: "Warning", reasons: failureReasons });
      addLog(db, "SageMaker ML", `WARNING: Asset ${asset.asset_tag} Failure Probability is ${riskScore}%. Monitoring closely.`);
    }
  });

  addLog(db, "SageMaker ML", `Batch inference completed. Scanned ${db.assets.length} items. Found ${criticalCount} Critical and ${warningCount} Warning conditions.`);

  writeDB(db);
  res.json({
    success: true,
    scannedCount: db.assets.length,
    criticalCount,
    warningCount,
    issues: issuesFound
  });
});

app.listen(PORT, () => {
  console.log(`InvenTech Prototype Server running on http://localhost:${PORT}`);
});
