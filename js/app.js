// DOM Elements
const video = document.getElementById('video');
const canvas = document.getElementById('output');
const ctx = canvas.getContext('2d');
const punchCountElement = document.getElementById('punch-count');
const punchRateElement = document.getElementById('punch-rate');
const startBtn = document.getElementById('start-btn');
const resetBtn = document.getElementById('reset-btn');
const punchIndicator = document.getElementById('punch-indicator');
const videoContainer = document.querySelector('.video-container');
const punchCountBox = document.querySelector('.stat-box:first-child');

// Application state
let model;
let detector;
let isTracking = false;
let punchCount = 0;
let punchHistory = [];
let lastPoseData = null;
let armExtendedState = { left: false, right: false };
let previousWristZ = { left: 0, right: 0 };
let wristZVelocity = { left: 0, right: 0 };
let previousWristArea = { left: 0, right: 0 };
let wristAreaChange = { left: 0, right: 0 };
let frameCount = 0;

// Constants
const PUNCH_THRESHOLD = 0.25; // Decreased back to original value
const PUNCH_COOLDOWN = 300; // Decreased to make detection more responsive
const CONFIDENCE_THRESHOLD = 0.5; // Decreased back to original value
const FORWARD_PUNCH_THRESHOLD = 0.04; // Adjusted for better forward punch detection
const AREA_CHANGE_THRESHOLD = 0.08; // Decreased for more sensitive area change detection
const WRIST_AREA_RADIUS = 15; // Radius for calculating wrist area
const MIN_VELOCITY_THRESHOLD = 0.02; // Decreased for more sensitive movement detection

// Initialize the application
async function init() {
    try {
        // Load the MoveNet model
        model = poseDetection.SupportedModels.MoveNet;
        const detectorConfig = {
            modelType: poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING,
            enableSmoothing: true,
            minPoseScore: 0.25
        };
        detector = await poseDetection.createDetector(model, detectorConfig);
        
        console.log('Model loaded successfully');
        startBtn.disabled = false;
    } catch (error) {
        console.error('Failed to load model:', error);
    }
}

// Set up webcam
async function setupCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Browser API navigator.mediaDevices.getUserMedia not available');
    }

    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: { width: 640, height: 480 },
            audio: false
        });
        video.srcObject = stream;

        return new Promise((resolve) => {
            video.onloadedmetadata = () => {
                resolve(video);
            };
        });
    } catch (error) {
        console.error('Error accessing webcam:', error);
        throw error;
    }
}

// Detect poses in the video stream
async function detectPose() {
    if (!isTracking) return;

    try {
        const poses = await detector.estimatePoses(video);
        
        if (poses.length > 0) {
            const pose = poses[0];
            drawPose(pose);
            detectPunch(pose);
            updatePunchRate();
            
            // Increment frame counter for debugging
            frameCount++;
        }
    } catch (error) {
        console.error('Error detecting pose:', error);
    }

    requestAnimationFrame(detectPose);
}

// Draw the detected pose on the canvas
function drawPose(pose) {
    // Clear the canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Set canvas dimensions to match video
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    
    // Draw keypoints
    const keypoints = pose.keypoints;
    for (let i = 0; i < keypoints.length; i++) {
        const keypoint = keypoints[i];
        
        if (keypoint.score > CONFIDENCE_THRESHOLD) {
            const { x, y } = keypoint;
            
            // Draw keypoint
            ctx.beginPath();
            ctx.arc(x, y, 5, 0, 2 * Math.PI);
            ctx.fillStyle = 'red';
            ctx.fill();
            
            // Draw keypoint name
            ctx.fillStyle = 'white';
            ctx.strokeStyle = 'black';
            ctx.lineWidth = 0.5;
            ctx.font = '12px Arial';
            ctx.fillText(keypoint.name, x + 8, y);
            ctx.strokeText(keypoint.name, x + 8, y);
        }
    }
    
    // Draw connections between keypoints (skeleton)
    drawSkeleton(keypoints);
}

// Draw lines connecting keypoints to form a skeleton
function drawSkeleton(keypoints) {
    // Define connections (pairs of keypoints that should be connected)
    const connections = [
        ['nose', 'left_eye'], ['nose', 'right_eye'],
        ['left_eye', 'left_ear'], ['right_eye', 'right_ear'],
        ['nose', 'left_shoulder'], ['nose', 'right_shoulder'],
        ['left_shoulder', 'left_elbow'], ['right_shoulder', 'right_elbow'],
        ['left_elbow', 'left_wrist'], ['right_elbow', 'right_wrist'],
        ['left_shoulder', 'right_shoulder'],
        ['left_shoulder', 'left_hip'], ['right_shoulder', 'right_hip'],
        ['left_hip', 'right_hip'],
        ['left_hip', 'left_knee'], ['right_hip', 'right_knee'],
        ['left_knee', 'left_ankle'], ['right_knee', 'right_ankle']
    ];
    
    // Create a map of keypoint name to keypoint
    const keypointMap = {};
    keypoints.forEach(keypoint => {
        keypointMap[keypoint.name] = keypoint;
    });
    
    // Draw lines
    ctx.strokeStyle = 'aqua';
    ctx.lineWidth = 2;
    
    connections.forEach(connection => {
        const [p1Name, p2Name] = connection;
        const p1 = keypointMap[p1Name];
        const p2 = keypointMap[p2Name];
        
        if (p1 && p2 && p1.score > CONFIDENCE_THRESHOLD && p2.score > CONFIDENCE_THRESHOLD) {
            ctx.beginPath();
            ctx.moveTo(p1.x, p1.y);
            ctx.lineTo(p2.x, p2.y);
            ctx.stroke();
        }
    });
}

// Detect if a punch has been thrown
function detectPunch(pose) {
    const keypoints = pose.keypoints;
    
    // Create a map of keypoint name to keypoint
    const keypointMap = {};
    keypoints.forEach(keypoint => {
        keypointMap[keypoint.name] = keypoint;
    });
    
    // Check for left and right punches
    checkArmPunch('left', keypointMap);
    checkArmPunch('right', keypointMap);
    
    // Save current pose data for next comparison
    lastPoseData = keypointMap;
}

// Check if an arm has performed a punch
function checkArmPunch(side, keypointMap) {
    const shoulderKey = `${side}_shoulder`;
    const elbowKey = `${side}_elbow`;
    const wristKey = `${side}_wrist`;
    
    const shoulder = keypointMap[shoulderKey];
    const elbow = keypointMap[elbowKey];
    const wrist = keypointMap[wristKey];
    
    // Ensure all required keypoints are detected with sufficient confidence
    if (!shoulder || !elbow || !wrist || 
        shoulder.score < CONFIDENCE_THRESHOLD || 
        elbow.score < CONFIDENCE_THRESHOLD || 
        wrist.score < CONFIDENCE_THRESHOLD) {
        return;
    }
    
    // Calculate the arm extension (distance from shoulder to wrist)
    const shoulderToWristDistance = Math.sqrt(
        Math.pow(wrist.x - shoulder.x, 2) + 
        Math.pow(wrist.y - shoulder.y, 2)
    );
    
    // Calculate the arm length (shoulder to elbow + elbow to wrist)
    const shoulderToElbowDistance = Math.sqrt(
        Math.pow(elbow.x - shoulder.x, 2) + 
        Math.pow(elbow.y - shoulder.y, 2)
    );
    
    const elbowToWristDistance = Math.sqrt(
        Math.pow(wrist.x - elbow.x, 2) + 
        Math.pow(wrist.y - elbow.y, 2)
    );
    
    const armLength = shoulderToElbowDistance + elbowToWristDistance;
    
    // Calculate extension ratio (how straight the arm is)
    const extensionRatio = shoulderToWristDistance / armLength;
    
    // Check if arm is extended (punch thrown)
    const isExtended = extensionRatio > (1 - PUNCH_THRESHOLD);
    
    // Detect forward punch (toward camera) using multiple approaches
    
    // 1. Estimate z-position based on the relative position of wrist to shoulder
    const currentWristZ = calculateRelativeDepth(shoulder, wrist);
    
    // Calculate z-velocity (negative means moving toward camera)
    let zVelocity = 0;
    if (previousWristZ[side] !== 0) {
        zVelocity = currentWristZ - previousWristZ[side];
        wristZVelocity[side] = zVelocity;
    }
    
    // Store current z for next frame comparison
    previousWristZ[side] = currentWristZ;
    
    // 2. Track wrist area changes (when moving toward camera, the area appears to grow)
    // Calculate current wrist area (simplified as a circle)
    const currentWristArea = Math.PI * Math.pow(WRIST_AREA_RADIUS * (1 + wrist.score), 2);
    
    // Calculate area change rate
    let areaChange = 0;
    if (previousWristArea[side] > 0) {
        areaChange = (currentWristArea - previousWristArea[side]) / previousWristArea[side];
        wristAreaChange[side] = areaChange;
    }
    
    // Store current area for next frame
    previousWristArea[side] = currentWristArea;
    
    // 3. Check if elbow is bent (common in forward punches)
    const elbowAngle = calculateElbowAngle(shoulder, elbow, wrist);
    const isElbowBent = elbowAngle < 160; // less than 160 degrees means bent elbow
    
    // Calculate the velocity of the wrist (for detecting quick movements)
    let wristVelocity = 0;
    if (lastPoseData && lastPoseData[wristKey]) {
        const dx = wrist.x - lastPoseData[wristKey].x;
        const dy = wrist.y - lastPoseData[wristKey].y;
        wristVelocity = Math.sqrt(dx*dx + dy*dy);
    }
    
    // Detect if there's a significant forward motion with additional conditions
    const isSignificantVelocity = Math.abs(wristVelocity) > MIN_VELOCITY_THRESHOLD;
    
    // Prioritize forward punches (toward webcam)
    const isForwardPunch = (zVelocity < -FORWARD_PUNCH_THRESHOLD) || 
                         (areaChange > AREA_CHANGE_THRESHOLD);
    
    // Debug visualization for forward punch detection
    if (frameCount % 30 === 0) { // Only log every 30 frames to avoid console spam
        console.log(`${side} arm - Z velocity: ${zVelocity.toFixed(4)}, Area change: ${areaChange.toFixed(4)}, Elbow angle: ${elbowAngle.toFixed(1)}, Wrist velocity: ${wristVelocity.toFixed(4)}`);
    }
    
    // Detect punch (either extended arm or forward motion)
    // Simplified conditions to make detection more responsive
    const isPunching = isExtended || (isSignificantVelocity && isForwardPunch);
    
    // Detect punch (transition from not punching to punching)
    if (isPunching && !armExtendedState[side]) {
        const now = Date.now();
        
        // Check if enough time has passed since the last punch
        const lastPunchTime = punchHistory.length > 0 ? punchHistory[punchHistory.length - 1].time : 0;
        if (now - lastPunchTime > PUNCH_COOLDOWN) {
            punchCount++;
            punchCountElement.textContent = punchCount;
            
            // Add to punch history
            punchHistory.push({
                time: now,
                side: side,
                type: isForwardPunch ? 'forward' : 'extended'
            });
            
            // Visual feedback
            document.body.classList.add('punch-detected');
            videoContainer.classList.add('punch-detected');
            punchCountBox.classList.add('highlight');
            punchCountElement.classList.add('highlight');
            
            // Show punch indicator with the type of punch
            punchIndicator.textContent = `${side.charAt(0).toUpperCase() + side.slice(1)} ${isForwardPunch ? 'Forward' : 'Extended'} Punch!`;
            punchIndicator.classList.add('visible');
            
            // Remove visual feedback after a short delay
            setTimeout(() => {
                document.body.classList.remove('punch-detected');
                videoContainer.classList.remove('punch-detected');
                punchCountBox.classList.remove('highlight');
                punchCountElement.classList.remove('highlight');
                punchIndicator.classList.remove('visible');
            }, 500); // Reduced from 800ms for faster feedback
            
            // Log punch type for debugging
            console.log(`Detected ${side} ${isForwardPunch ? 'forward' : 'extended'} punch`);
        }
    }
    
    // Update arm state
    armExtendedState[side] = isPunching;
}

// Calculate the relative depth of a point based on its apparent size
function calculateRelativeDepth(referencePoint, targetPoint) {
    // The distance between points in 2D space can be used to estimate relative depth
    // When a point moves closer to the camera, it appears larger and moves away from reference points
    
    // We use the y-coordinate difference as a simple depth estimation
    // (This is a simplified approach - in a real 3D system we would use actual depth data)
    return targetPoint.y - referencePoint.y;
}

// Calculate the angle at the elbow (in degrees)
function calculateElbowAngle(shoulder, elbow, wrist) {
    // Calculate vectors
    const upperArmX = shoulder.x - elbow.x;
    const upperArmY = shoulder.y - elbow.y;
    
    const forearmX = wrist.x - elbow.x;
    const forearmY = wrist.y - elbow.y;
    
    // Calculate dot product
    const dotProduct = upperArmX * forearmX + upperArmY * forearmY;
    
    // Calculate magnitudes
    const upperArmMag = Math.sqrt(upperArmX * upperArmX + upperArmY * upperArmY);
    const forearmMag = Math.sqrt(forearmX * forearmX + forearmY * forearmY);
    
    // Calculate angle in radians
    const angleRad = Math.acos(dotProduct / (upperArmMag * forearmMag));
    
    // Convert to degrees
    return angleRad * (180 / Math.PI);
}

// Update the punches per minute calculation
function updatePunchRate() {
    const now = Date.now();
    const oneMinuteAgo = now - 60000;
    
    // Filter punch history to only include punches from the last minute
    const recentPunches = punchHistory.filter(punch => punch.time > oneMinuteAgo);
    
    // Calculate punches per minute
    const punchesPerMinute = recentPunches.length;
    punchRateElement.textContent = punchesPerMinute;
}

// Start tracking punches
async function startTracking() {
    if (isTracking) return;
    
    try {
        await setupCamera();
        isTracking = true;
        startBtn.textContent = 'Pause Tracking';
        detectPose();
    } catch (error) {
        console.error('Error starting tracking:', error);
    }
}

// Reset the punch counter
function resetCounter() {
    punchCount = 0;
    punchHistory = [];
    punchCountElement.textContent = punchCount;
    punchRateElement.textContent = 0;
}

// Event listeners
startBtn.addEventListener('click', () => {
    if (isTracking) {
        isTracking = false;
        startBtn.textContent = 'Start Tracking';
    } else {
        startTracking();
    }
});

resetBtn.addEventListener('click', resetCounter);

// Initialize the application when the page loads
document.addEventListener('DOMContentLoaded', () => {
    startBtn.disabled = true; // Disable button until model is loaded
    init();
});
