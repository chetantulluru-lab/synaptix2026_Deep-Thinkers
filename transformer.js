{
  "name": "neural-viz",
  "version": "1.0.0",
  "description": "3D Neural Visualization System",
  "main": "server.js",
  "scripts": {
    "start": "node server.js",
    "dev": "nodemon server.js"
  },
  "dependencies": {
    "express": "^4.18.2",
    "socket.io": "^4.6.1",
    "uuid": "^9.0.0",
    "qrcode": "^1.5.3",
    "@tensorflow/tfjs-node": "^4.10.0"
  },
  "devDependencies": {
    "nodemon": "^3.0.1"
  }
}