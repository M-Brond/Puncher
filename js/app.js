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
let previousWristPositions = { left: null, right: null };
let wristVelocities = { left: 0, right: 0 };
let lastPunchTime = 0;
let consecutiveFramesAboveThreshold = { left: 0, right: 0 };
let movementDirection = { left: { x: 0, y: 0 }, right: { x: 0, y: 0 } };
let inPunchState = { left: false, right: false };
let punchCooldownActive = { left: false, right: false };
let lastResetTime = { left: 0, right: 0 };

// Constants
const PUNCH_COOLDOWN = 500; // Increased to prevent double counting
const CONFIDENCE_THRESHOLD = 0.25; // Lowered for better detection
const MIN_VELOCITY_THRESHOLD = 3.5; // Lowered for more sensitive detection
const MAX_CONSECUTIVE_FRAMES = 2; // Reduced to detect punches faster
const RESET_COOLDOWN = 1000; // Time before punch state can be reset
const FORWARD_MOVEMENT_THRESHOLD = 0.4; // Lowered for easier forward detection
const PUNCH_THRESHOLD = 0.25; // Decreased back to original value
const AREA_CHANGE_THRESHOLD = 0.08; // Decreased for more sensitive area change detection
const WRIST_AREA_RADIUS = 15; // Radius for calculating wrist area

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
            
            // Use simple motion detection instead of complex pose analysis
            detectPunchByMotion(pose);
            
            updatePunchRate();
            
            // Save current pose data for next comparison
            lastPoseData = pose.keypoints.reduce((map, keypoint) => {
                map[keypoint.name] = keypoint;
                return map;
            }, {});
            
            // Increment frame counter for debugging
            frameCount++;
        }
    } catch (error) {
        console.error('Error detecting pose:', error);
    }

    requestAnimationFrame(detectPose);
}

// Simple motion-based punch detection
function detectPunchByMotion(pose) {
    const now = Date.now();
    
    // Extract wrist keypoints
    const keypoints = pose.keypoints;
    const leftWrist = keypoints.find(kp => kp.name === 'left_wrist');
    const rightWrist = keypoints.find(kp => kp.name === 'right_wrist');
    
    // Check both wrists
    checkWristMotion('left', leftWrist, now);
    checkWristMotion('right', rightWrist, now);
}

// Check wrist motion for punch detection
function checkWristMotion(side, wrist, now) {
    // Skip if wrist not detected with sufficient confidence
    if (!wrist || wrist.score < CONFIDENCE_THRESHOLD) {
        previousWristPositions[side] = null;
        consecutiveFramesAboveThreshold[side] = 0;
        return;
    }
    
    // Calculate velocity if we have previous position
    if (previousWristPositions[side]) {
        const dx = wrist.x - previousWristPositions[side].x;
        const dy = wrist.y - previousWristPositions[side].y;
        const distance = Math.sqrt(dx*dx + dy*dy);
        
        // Calculate velocity (distance per frame)
        wristVelocities[side] = distance;
        
        // Track movement direction
        if (distance > 0) {
            movementDirection[side] = {
                x: dx / distance,
                y: dy / distance
            };
        }
        
        // Check if movement is primarily forward (toward camera/screen)
        // In the y-direction, negative is upward in screen coordinates
        const isForwardMovement = movementDirection[side].y > FORWARD_MOVEMENT_THRESHOLD;
        
        // Detect punch based on velocity and direction
        if (wristVelocities[side] > MIN_VELOCITY_THRESHOLD && isForwardMovement) {
            // Increment consecutive frames counter
            consecutiveFramesAboveThreshold[side]++;
            
            // Only count as punch if not in cooldown and has enough movement
            if (!punchCooldownActive[side] && 
                consecutiveFramesAboveThreshold[side] >= 1) {
                
                // Mark as in punch state and activate cooldown
                inPunchState[side] = true;
                punchCooldownActive[side] = true;
                
                // Count as punch
                punchCount++;
                punchCountElement.textContent = punchCount;
                lastPunchTime = now;
                lastResetTime[side] = now;
                
                // Add to punch history
                punchHistory.push({
                    time: now,
                    side: side,
                    type: 'forward'
                });
                
                // Visual feedback
                document.body.classList.add('punch-detected');
                videoContainer.classList.add('punch-detected');
                punchCountBox.classList.add('highlight');
                punchCountElement.classList.add('highlight');
                
                // Show punch indicator
                punchIndicator.textContent = `${side.charAt(0).toUpperCase() + side.slice(1)} Forward Punch!`;
                punchIndicator.classList.add('visible');
                
                // Log for debugging
                console.log(`Detected ${side} punch with velocity: ${wristVelocities[side].toFixed(2)}, direction: ${movementDirection[side].y.toFixed(2)}`);
                
                // Remove visual feedback after a short delay
                setTimeout(() => {
                    document.body.classList.remove('punch-detected');
                    videoContainer.classList.remove('punch-detected');
                    punchCountBox.classList.remove('highlight');
                    punchCountElement.classList.remove('highlight');
                    punchIndicator.classList.remove('visible');
                }, 200);
                
                // Set timeout to reset cooldown
                setTimeout(() => {
                    punchCooldownActive[side] = false;
                }, PUNCH_COOLDOWN);
            }
        } else {
            // Reset consecutive frames counter if velocity drops below threshold
            consecutiveFramesAboveThreshold[side] = 0;
            
            // Only reset punch state after enough time has passed
            if (wristVelocities[side] < MIN_VELOCITY_THRESHOLD / 2 && 
                now - lastResetTime[side] > RESET_COOLDOWN) {
                inPunchState[side] = false;
                lastResetTime[side] = now;
            }
        }
    }
    
    // Store current position for next frame
    previousWristPositions[side] = { 
        x: wrist.x, 
        y: wrist.y 
    };
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
            
            // Highlight wrists with different color
            if (keypoint.name === 'left_wrist' || keypoint.name === 'right_wrist') {
                ctx.fillStyle = 'yellow';
                
                // Draw velocity indicator if available
                const side = keypoint.name.split('_')[0];
                if (wristVelocities[side] > 0) {
                    // Draw velocity as circle size
                    const velocityRadius = Math.min(20, wristVelocities[side]);
                    ctx.beginPath();
                    ctx.arc(x, y, velocityRadius, 0, 2 * Math.PI);
                    ctx.strokeStyle = 'orange';
                    ctx.lineWidth = 2;
                    ctx.stroke();
                }
            } else {
                ctx.fillStyle = 'red';
            }
            
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
