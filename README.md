# Punch Counter

A TensorFlow.js application that uses pose detection to track and count punches through your webcam.

## Features

- Real-time punch detection and counting
- Punches per minute calculation
- Visual feedback with skeleton visualization
- Works with standard webcams

## How to Use

1. Open the `index.html` file in a modern web browser (Chrome, Firefox, Safari, Edge)
2. Allow camera permissions when prompted
3. Click the "Start Tracking" button to begin punch detection
4. Throw punches and watch the counter increment
5. Use the "Reset Counter" button to zero out the count

## Technical Details

This application uses:
- TensorFlow.js for machine learning in the browser
- MoveNet pose detection model for real-time human pose estimation
- Canvas API for visualization

## Running Locally

You can run this application using any local web server. Here are a few options:

### Using Python

```bash
# Python 3
python -m http.server

# Python 2
python -m SimpleHTTPServer
```

### Using Node.js

```bash
# Install http-server globally if you haven't already
npm install -g http-server

# Run the server
http-server
```

Then open your browser and navigate to `http://localhost:8000` (or whatever port your server is using).

## Privacy

All processing happens locally in your browser. No video data is sent to any server.
